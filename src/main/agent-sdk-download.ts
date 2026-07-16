import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type {
  AgentSdkDownloadErrorCode,
  AgentSdkDownloadState
} from '../shared/agent-sdk-download'
import { fetchWithOptionalProxy } from './proxy-fetch'
import { AgentSdkStateStore, agentSdkRootDir } from './agent-sdk-state-store'

const REGISTRY = 'https://registry.npmjs.org'
const DEFAULT_METADATA_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_DOWNLOAD_CONNECT_TIMEOUT_MS = 20_000
const DEFAULT_STALL_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_METADATA_BYTES = 2 * 1024 * 1024
const MAX_RETRY_AFTER_MS = 60_000

const NpmPackageMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  dist: z.object({
    tarball: z.string().url(),
    integrity: z.string().min(1),
    unpackedSize: z.number().int().positive().optional()
  })
})

export type AgentSdkArchiveMetadata = {
  packageName: string
  version: string
  tarballUrl: string
  integrity: string
  integrityDigest: Buffer
  tarballFingerprint: string
  unpackedSize?: number
}

export type AgentSdkArchiveDownload = {
  archivePath: string
  metadata: AgentSdkArchiveMetadata
}

export type AgentSdkFetch = (
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
) => Promise<Response>

export class AgentSdkDownloadFailure extends Error {
  readonly code: AgentSdkDownloadErrorCode
  readonly retriable: boolean
  readonly retryAfterMs?: number

  constructor(
    code: AgentSdkDownloadErrorCode,
    message: string,
    options: { retriable?: boolean; retryAfterMs?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'AgentSdkDownloadFailure'
    this.code = code
    this.retriable = options.retriable ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

export type DownloadAgentSdkArchiveOptions = {
  userDataDir: string
  packageName: string
  version: string
  platform: string
  arch: string
  stateStore: AgentSdkStateStore
  proxyUrl?: string
  signal?: AbortSignal
  fetcher?: AgentSdkFetch
  /** Compatibility override applied to both request phases. */
  connectTimeoutMs?: number
  metadataConnectTimeoutMs?: number
  downloadConnectTimeoutMs?: number
  stallTimeoutMs?: number
  maxAttempts?: number
  maxArchiveBytes?: number
  nowIso?: () => string
  nowMs?: () => number
  random?: () => number
  sleep?: (ms: number) => Promise<void>
  onState?: (state: AgentSdkDownloadState) => void
}

export function agentSdkPartPath(
  userDataDir: string,
  packageName: string,
  version: string
): string {
  const key = createHash('sha256').update(`${packageName}@${version}`).digest('hex').slice(0, 24)
  return join(agentSdkRootDir(userDataDir), 'downloads', `${key}.tgz.part`)
}

export function fingerprintAgentSdkTarball(input: {
  packageName: string
  version: string
  tarballUrl: string
  integrity: string
}): string {
  return createHash('sha256')
    .update(`${input.packageName}\n${input.version}\n${input.tarballUrl}\n${input.integrity}`)
    .digest('hex')
}

export function parseSha512Integrity(value: string): { integrity: string; digest: Buffer } {
  for (const token of value.trim().split(/\s+/)) {
    const match = token.match(/^sha512-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/)
    if (!match?.[1]) continue
    const digest = Buffer.from(match[1], 'base64')
    if (digest.byteLength === 64 && digest.toString('base64') === match[1]) {
      return { integrity: `sha512-${match[1]}`, digest }
    }
  }
  throw new AgentSdkDownloadFailure(
    'metadata_invalid',
    'registry metadata does not contain a valid SHA-512 integrity token'
  )
}

export async function downloadAgentSdkArchive(
  options: DownloadAgentSdkArchiveOptions
): Promise<AgentSdkArchiveDownload> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const nowMs = options.nowMs ?? Date.now
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS))
  const maxArchiveBytes = Math.max(1, Math.floor(
    options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES
  ))
  const partPath = agentSdkPartPath(options.userDataDir, options.packageName, options.version)
  const fallbackState = createBaseState(options, nowIso())
  let state = await options.stateStore.loadState(fallbackState)
  let checksumRetryUsed = false
  let lastFailure: AgentSdkDownloadFailure | null = null

  const emit = async (
    next: AgentSdkDownloadState,
    saveOptions: { throttled?: boolean } = {}
  ): Promise<AgentSdkDownloadState> => {
    const saved = await options.stateStore.saveState(next, saveOptions)
    state = saved
    options.onState?.(saved)
    return saved
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      assertNotAborted(options.signal)
      await emit({
        ...state,
        status: 'resolving',
        attempt,
        nextRetryAt: undefined,
        error: undefined,
        updatedAt: nowIso()
      })
      const metadata = await resolveArchiveMetadata(options)
      const offset = await reconcilePart(partPath, state, metadata, maxArchiveBytes)
      await emit({
        ...state,
        status: 'downloading',
        attempt,
        receivedBytes: offset,
        totalBytes: null,
        integrity: metadata.integrity,
        tarballFingerprint: metadata.tarballFingerprint,
        nextRetryAt: undefined,
        error: undefined,
        updatedAt: nowIso()
      })

      await downloadArchiveOnce({
        options,
        metadata,
        partPath,
        offset,
        maxArchiveBytes,
        onProgress: async (progress) => {
          await emit({
            ...state,
            status: 'downloading',
            attempt,
            receivedBytes: progress.receivedBytes,
            totalBytes: progress.totalBytes,
            integrity: metadata.integrity,
            tarballFingerprint: metadata.tarballFingerprint,
            ...(progress.etag ? { etag: progress.etag } : {}),
            ...(progress.lastModified ? { lastModified: progress.lastModified } : {}),
            updatedAt: nowIso()
          }, { throttled: true })
        }
      })

      await emit({
        ...state,
        status: 'verifying',
        attempt,
        nextRetryAt: undefined,
        error: undefined,
        updatedAt: nowIso()
      })
      await verifyArchiveIntegrity(partPath, metadata.integrityDigest)
      await options.stateStore.flush()
      return { archivePath: partPath, metadata }
    } catch (error) {
      if (options.signal?.aborted) {
        await emit({
          ...state,
          status: 'interrupted',
          nextRetryAt: undefined,
          updatedAt: nowIso()
        })
        throw asDownloadFailure(error, false)
      }

      const failure = asDownloadFailure(error)
      lastFailure = failure
      let canRetry = failure.retriable && attempt < maxAttempts
      let retryDelayMs = failure.retryAfterMs ?? backoffDelayMs(attempt, options.random ?? Math.random)
      if (failure.code === 'checksum_mismatch') {
        await rm(partPath, { force: true }).catch(() => undefined)
        canRetry = !checksumRetryUsed && attempt < maxAttempts
        checksumRetryUsed = true
        retryDelayMs = 0
      }

      if (!canRetry) {
        await emit({
          ...state,
          status: 'failed',
          nextRetryAt: undefined,
          error: {
            code: failure.code,
            message: failure.message,
            retriable: failure.retriable
          },
          updatedAt: nowIso()
        })
        throw failure
      }

      const nextRetryAt = new Date(nowMs() + retryDelayMs).toISOString()
      await emit({
        ...state,
        status: 'retrying',
        attempt,
        nextRetryAt,
        error: {
          code: failure.code,
          message: failure.message,
          retriable: true
        },
        updatedAt: nowIso()
      })
      await sleepWithSignal(retryDelayMs, options.sleep ?? delay, options.signal)
    }
  }

  throw lastFailure ?? new AgentSdkDownloadFailure('network', 'agent SDK download failed')
}

function createBaseState(
  options: Pick<DownloadAgentSdkArchiveOptions, 'packageName' | 'version' | 'platform' | 'arch'>,
  updatedAt: string
): AgentSdkDownloadState {
  return {
    schemaVersion: 1,
    status: 'idle',
    packageName: options.packageName,
    sdkVersion: options.version,
    platform: options.platform,
    arch: options.arch,
    attempt: 0,
    receivedBytes: 0,
    totalBytes: null,
    updatedAt
  }
}

async function resolveArchiveMetadata(
  options: DownloadAgentSdkArchiveOptions
): Promise<AgentSdkArchiveMetadata> {
  const encodedPackage = options.packageName.replace('/', '%2F')
  const request = await fetchWithConnectTimeout(
    `${REGISTRY}/${encodedPackage}/${encodeURIComponent(options.version)}`,
    {},
    options,
    'metadata'
  )
  try {
    if (!request.response.ok) throw httpFailure(request.response, options.nowMs ?? Date.now)
    const raw = await readResponseBytes(
      request.response,
      request.controller,
      options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
      MAX_METADATA_BYTES
    )
    let json: unknown
    try {
      json = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown
    } catch (error) {
      throw new AgentSdkDownloadFailure('metadata_invalid', 'registry metadata is invalid JSON', {
        cause: error
      })
    }
    const parsed = NpmPackageMetadataSchema.safeParse(json)
    if (!parsed.success
      || parsed.data.name !== options.packageName
      || parsed.data.version !== options.version) {
      throw new AgentSdkDownloadFailure('metadata_invalid', 'registry metadata does not match package')
    }
    const tarball = new URL(parsed.data.dist.tarball)
    if (tarball.protocol !== 'https:') {
      throw new AgentSdkDownloadFailure('metadata_invalid', 'registry tarball URL must use HTTPS')
    }
    const sri = parseSha512Integrity(parsed.data.dist.integrity)
    const metadata: AgentSdkArchiveMetadata = {
      packageName: options.packageName,
      version: options.version,
      tarballUrl: tarball.toString(),
      integrity: sri.integrity,
      integrityDigest: sri.digest,
      tarballFingerprint: fingerprintAgentSdkTarball({
        packageName: options.packageName,
        version: options.version,
        tarballUrl: tarball.toString(),
        integrity: sri.integrity
      }),
      ...(parsed.data.dist.unpackedSize
        ? { unpackedSize: parsed.data.dist.unpackedSize }
        : {})
    }
    return metadata
  } finally {
    request.dispose()
  }
}

async function reconcilePart(
  partPath: string,
  state: AgentSdkDownloadState,
  metadata: AgentSdkArchiveMetadata,
  maxArchiveBytes: number
): Promise<number> {
  const matches = state.packageName === metadata.packageName
    && state.sdkVersion === metadata.version
    && state.integrity === metadata.integrity
    && state.tarballFingerprint === metadata.tarballFingerprint
  if (!matches) await rm(partPath, { force: true }).catch(() => undefined)
  const info = await stat(partPath).catch(() => null)
  if (!info) return 0
  if (!info.isFile() || info.size > maxArchiveBytes) {
    await rm(partPath, { force: true }).catch(() => undefined)
    if (info.size > maxArchiveBytes) {
      throw new AgentSdkDownloadFailure('size_limit', 'agent SDK archive exceeds size limit')
    }
    return 0
  }
  return info.size
}

async function downloadArchiveOnce(input: {
  options: DownloadAgentSdkArchiveOptions
  metadata: AgentSdkArchiveMetadata
  partPath: string
  offset: number
  maxArchiveBytes: number
  onProgress: (progress: {
    receivedBytes: number
    totalBytes: number | null
    etag?: string
    lastModified?: string
  }) => Promise<void>
}): Promise<void> {
  await mkdir(join(agentSdkRootDir(input.options.userDataDir), 'downloads'), { recursive: true })
  const headers = new Headers()
  if (input.offset > 0) {
    headers.set('range', `bytes=${input.offset}-`)
    const validator = strongEtag(input.options.stateStore.state?.etag)
      ?? input.options.stateStore.state?.lastModified
    if (validator) headers.set('if-range', validator)
  }
  const request = await fetchWithConnectTimeout(
    input.metadata.tarballUrl,
    { headers },
    input.options,
    'download'
  )
  let offset = input.offset
  let totalBytes: number | null = null
  try {
    const response = request.response
    if (response.status === 416) {
      const total = parseUnsatisfiedRangeTotal(response.headers.get('content-range'))
      if (total !== null && total === offset) return
      await rm(input.partPath, { force: true }).catch(() => undefined)
      throw new AgentSdkDownloadFailure('range_invalid', 'range is not satisfiable', {
        retriable: true
      })
    }
    if (response.status === 206) {
      const range = parseContentRange(response.headers.get('content-range'))
      if (!range || range.start !== offset || range.total > input.maxArchiveBytes) {
        await rm(input.partPath, { force: true }).catch(() => undefined)
        throw new AgentSdkDownloadFailure('range_invalid', 'server returned an invalid range', {
          retriable: true
        })
      }
      totalBytes = range.total
    } else if (response.status === 200) {
      offset = 0
      totalBytes = parseContentLength(response.headers.get('content-length'))
    } else {
      throw httpFailure(response, input.options.nowMs ?? Date.now)
    }
    if (totalBytes !== null && totalBytes > input.maxArchiveBytes) {
      throw new AgentSdkDownloadFailure('size_limit', 'agent SDK archive exceeds size limit')
    }

    const etag = response.headers.get('etag')?.trim() || undefined
    const lastModified = response.headers.get('last-modified')?.trim() || undefined
    await input.onProgress({ receivedBytes: offset, totalBytes, etag, lastModified })
    const handle = await open(input.partPath, offset > 0 ? 'a' : 'w')
    let receivedBytes = offset
    try {
      const reader = response.body?.getReader()
      if (!reader) throw new AgentSdkDownloadFailure('network', 'download response has no body', {
        retriable: true
      })
      try {
        while (true) {
          const chunk = await readWithStallTimeout(
            reader,
            request.controller,
            input.options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
          )
          if (chunk.done) break
          const value = chunk.value
          if (!value) continue
          receivedBytes += value.byteLength
          if (receivedBytes > input.maxArchiveBytes) {
            request.controller.abort()
            throw new AgentSdkDownloadFailure('size_limit', 'agent SDK archive exceeds size limit')
          }
          await handle.write(Buffer.from(value))
          await input.onProgress({ receivedBytes, totalBytes, etag, lastModified })
        }
      } finally {
        reader.releaseLock()
      }
    } finally {
      await handle.close()
    }
    if (totalBytes !== null && receivedBytes !== totalBytes) {
      throw new AgentSdkDownloadFailure('network', 'download ended before the expected size', {
        retriable: true
      })
    }
  } finally {
    request.dispose()
  }
}

async function verifyArchiveIntegrity(path: string, expected: Buffer): Promise<void> {
  const hash = createHash('sha512')
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  } catch (error) {
    throw fileFailure(error)
  }
  const actual = hash.digest()
  if (!timingSafeEqual(actual, expected)) {
    throw new AgentSdkDownloadFailure(
      'checksum_mismatch',
      'agent SDK archive checksum does not match registry metadata',
      { retriable: true }
    )
  }
}

type ActiveRequest = {
  response: Response
  controller: AbortController
  dispose: () => void
}

async function fetchWithConnectTimeout(
  url: string,
  init: RequestInit,
  options: DownloadAgentSdkArchiveOptions,
  phase: 'metadata' | 'download'
): Promise<ActiveRequest> {
  assertNotAborted(options.signal)
  const controller = new AbortController()
  const phaseTimeoutMs = phase === 'metadata'
    ? options.metadataConnectTimeoutMs ?? options.connectTimeoutMs ?? DEFAULT_METADATA_CONNECT_TIMEOUT_MS
    : options.downloadConnectTimeoutMs ?? options.connectTimeoutMs ?? DEFAULT_DOWNLOAD_CONNECT_TIMEOUT_MS
  const timeoutMs = Math.max(1, phaseTimeoutMs)
  let didTimeout = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const abortFromParent = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortFromParent, { once: true })
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        didTimeout = true
        controller.abort()
        reject(new AgentSdkDownloadFailure(
          'timeout_connect',
          `${phase} connection timed out`,
          { retriable: true }
        ))
      }, timeoutMs)
    })
    const fetcher = options.fetcher ?? fetchWithOptionalProxy
    const response = await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }, options.proxyUrl ?? ''),
      timeout
    ])
    if (timer) clearTimeout(timer)
    return {
      response,
      controller,
      dispose: () => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', abortFromParent)
      }
    }
  } catch (error) {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromParent)
    if (error instanceof AgentSdkDownloadFailure) throw error
    if (options.signal?.aborted) throw error
    if (didTimeout) {
      throw new AgentSdkDownloadFailure('timeout_connect', `${phase} connection timed out`, {
        retriable: true,
        cause: error
      })
    }
    throw new AgentSdkDownloadFailure('network', `${phase} request failed`, {
      retriable: true,
      cause: error
    })
  }
}

async function readResponseBytes(
  response: Response,
  controller: AbortController,
  stallTimeoutMs: number,
  maxBytes: number
): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new AgentSdkDownloadFailure('network', 'response has no body', {
    retriable: true
  })
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await readWithStallTimeout(reader, controller, stallTimeoutMs)
      if (chunk.done) break
      if (!chunk.value) continue
      total += chunk.value.byteLength
      if (total > maxBytes) {
        controller.abort()
        throw new AgentSdkDownloadFailure('size_limit', 'response exceeds size limit')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function readWithStallTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: AbortController,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new AgentSdkDownloadFailure('timeout_stall', 'download stream stalled', {
            retriable: true
          }))
        }, Math.max(1, timeoutMs))
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function parseContentRange(value: string | null): {
  start: number
  end: number
  total: number
} | null {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) return null
  return { start, end, total }
}

function parseUnsatisfiedRangeTotal(value: string | null): number | null {
  const match = value?.match(/^bytes \*\/(\d+)$/)
  if (!match) return null
  const total = Number(match[1])
  return Number.isSafeInteger(total) && total >= 0 ? total : null
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function strongEtag(value: string | undefined): string | undefined {
  if (!value || value.startsWith('W/')) return undefined
  return value
}

function httpFailure(response: Response, nowMs: () => number): AgentSdkDownloadFailure {
  const retriable = response.status === 408
    || response.status === 425
    || response.status === 429
    || response.status >= 500
  return new AgentSdkDownloadFailure(
    'http_status',
    `registry request failed with HTTP ${response.status}`,
    {
      retriable,
      ...(retriable
        ? { retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), nowMs()) }
        : {})
    }
  )
}

function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000))
  }
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return undefined
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - nowMs))
}

function backoffDelayMs(attempt: number, random: () => number): number {
  const base = 1_000 * 2 ** Math.max(0, attempt - 1)
  const jitter = Math.max(0, Math.min(1, random())) * 0.25
  return Math.round(base * (1 + jitter))
}

async function sleepWithSignal(
  ms: number,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined
): Promise<void> {
  assertNotAborted(signal)
  await sleep(ms)
  assertNotAborted(signal)
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('operation aborted')
}

function asDownloadFailure(error: unknown, retriable = true): AgentSdkDownloadFailure {
  if (error instanceof AgentSdkDownloadFailure) return error
  return fileFailure(error, retriable)
}

function fileFailure(error: unknown, defaultRetriable = false): AgentSdkDownloadFailure {
  const code = String((error as NodeJS.ErrnoException)?.code ?? '')
  if (code === 'ENOSPC') {
    return new AgentSdkDownloadFailure('disk_full', 'not enough disk space for agent SDK', {
      cause: error
    })
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new AgentSdkDownloadFailure('permission', 'agent SDK storage is not writable', {
      cause: error
    })
  }
  return new AgentSdkDownloadFailure('network', 'agent SDK download failed', {
    retriable: defaultRetriable,
    cause: error
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
