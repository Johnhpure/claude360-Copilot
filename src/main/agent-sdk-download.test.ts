import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSdkDownloadState } from '../shared/agent-sdk-download'
import {
  AgentSdkDownloadFailure,
  agentSdkPartPath,
  downloadAgentSdkArchive,
  fingerprintAgentSdkTarball
} from './agent-sdk-download'
import { AgentSdkStateStore } from './agent-sdk-state-store'

const PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk-linux-x64'
const VERSION = '0.3.193'
const NOW = '2026-07-16T03:00:00.000Z'
const roots: string[] = []

async function makeUserData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-sdk-download-'))
  roots.push(root)
  return root
}

function sri(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function metadataResponse(bytes: Uint8Array, tarballUrl = 'https://cdn.example/sdk.tgz'): Response {
  return Response.json({
    name: PACKAGE_NAME,
    version: VERSION,
    dist: {
      tarball: tarballUrl,
      integrity: sri(bytes),
      unpackedSize: 240_000_000
    }
  })
}

function bytesResponse(
  bytes: Uint8Array,
  init: { status?: number; headers?: HeadersInit } = {}
): Response {
  const body = new Uint8Array(bytes.byteLength)
  body.set(bytes)
  return new Response(body.buffer, {
    status: init.status ?? 200,
    headers: {
      'content-length': String(bytes.byteLength),
      ...Object.fromEntries(new Headers(init.headers).entries())
    }
  })
}

function stateFixture(options: {
  integrity: string
  fingerprint: string
  receivedBytes: number
  etag?: string
}): AgentSdkDownloadState {
  return {
    schemaVersion: 1,
    status: 'interrupted',
    packageName: PACKAGE_NAME,
    sdkVersion: VERSION,
    platform: 'linux',
    arch: 'x64',
    attempt: 1,
    receivedBytes: options.receivedBytes,
    totalBytes: null,
    integrity: options.integrity,
    tarballFingerprint: options.fingerprint,
    ...(options.etag ? { etag: options.etag } : {}),
    updatedAt: NOW
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('downloadAgentSdkArchive', () => {
  it('rejects a non-HTTPS tarball before issuing the download request', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('archive')
    let tarballRequests = 0
    const fetcher = async (input: string | URL): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) {
        return metadataResponse(archive, 'http://cdn.example/sdk.tgz')
      }
      tarballRequests += 1
      return bytesResponse(archive)
    }

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: new AgentSdkStateStore({ userDataDir, nowIso: () => NOW }),
      fetcher,
      nowIso: () => NOW
    })).rejects.toMatchObject({ code: 'metadata_invalid' })
    expect(tarballRequests).toBe(0)
  })

  it('does not retry a non-retriable HTTP status', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('archive')
    let tarballRequests = 0
    const fetcher = async (input: string | URL): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) return metadataResponse(archive)
      tarballRequests += 1
      return new Response('not found', { status: 404 })
    }

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: new AgentSdkStateStore({ userDataDir, nowIso: () => NOW }),
      fetcher,
      maxAttempts: 3,
      sleep: async () => undefined,
      nowIso: () => NOW
    })).rejects.toMatchObject({ code: 'http_status', retriable: false })
    expect(tarballRequests).toBe(1)
  })

  it('verifies SHA-512 and allows only one clean retry after checksum mismatch', async () => {
    const userDataDir = await makeUserData()
    const expected = new TextEncoder().encode('trusted archive body')
    const tampered = new TextEncoder().encode('tampered archive body')
    let tarballRequests = 0
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    const fetcher = async (input: string | URL): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) return metadataResponse(expected)
      tarballRequests += 1
      return bytesResponse(tampered)
    }

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher,
      maxAttempts: 3,
      sleep: async () => undefined,
      nowIso: () => NOW,
      random: () => 0
    })).rejects.toMatchObject({ code: 'checksum_mismatch' satisfies AgentSdkDownloadFailure['code'] })

    expect(tarballRequests).toBe(2)
    await expect(readFile(agentSdkPartPath(userDataDir, PACKAGE_NAME, VERSION)))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(store.state).toMatchObject({ status: 'failed', error: { code: 'checksum_mismatch' } })
  })

  it('retries retriable HTTP status and honors Retry-After', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('valid archive')
    const sleeps: number[] = []
    let tarballRequests = 0
    const fetcher = async (input: string | URL): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) return metadataResponse(archive)
      tarballRequests += 1
      if (tarballRequests === 1) {
        return new Response('busy', { status: 503, headers: { 'retry-after': '2' } })
      }
      return bytesResponse(archive)
    }

    const result = await downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: new AgentSdkStateStore({ userDataDir, nowIso: () => NOW }),
      fetcher,
      sleep: async (ms) => { sleeps.push(ms) },
      nowIso: () => NOW,
      random: () => 0
    })

    expect(await readFile(result.archivePath)).toEqual(Buffer.from(archive))
    expect(tarballRequests).toBe(2)
    expect(sleeps).toEqual([2_000])
  })

  it('resumes a persisted part with Range and validates the 206 start offset', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('0123456789abcdef')
    const tarballUrl = 'https://cdn.example/sdk.tgz'
    const integrity = sri(archive)
    const fingerprint = fingerprintAgentSdkTarball({
      packageName: PACKAGE_NAME,
      version: VERSION,
      tarballUrl,
      integrity
    })
    const partPath = agentSdkPartPath(userDataDir, PACKAGE_NAME, VERSION)
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    await store.saveState(stateFixture({ integrity, fingerprint, receivedBytes: 8, etag: '"v1"' }))
    await mkdir(join(userDataDir, 'agent-sdk', 'downloads'), { recursive: true })
    await writeFile(partPath, archive.slice(0, 8))
    const rangeHeaders: Headers[] = []
    const fetcher = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) return metadataResponse(archive, tarballUrl)
      rangeHeaders.push(new Headers(init?.headers))
      return bytesResponse(archive.slice(8), {
        status: 206,
        headers: {
          'content-range': `bytes 8-15/${archive.byteLength}`,
          etag: '"v1"'
        }
      })
    }

    const result = await downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher,
      nowIso: () => NOW
    })

    expect(rangeHeaders[0]?.get('range')).toBe('bytes=8-')
    expect(rangeHeaders[0]?.get('if-range')).toBe('"v1"')
    expect(await readFile(result.archivePath)).toEqual(Buffer.from(archive))
  })

  it('truncates a persisted part when the server ignores Range with 200', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('complete archive')
    const tarballUrl = 'https://cdn.example/sdk.tgz'
    const integrity = sri(archive)
    const fingerprint = fingerprintAgentSdkTarball({
      packageName: PACKAGE_NAME,
      version: VERSION,
      tarballUrl,
      integrity
    })
    const partPath = agentSdkPartPath(userDataDir, PACKAGE_NAME, VERSION)
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    await store.saveState(stateFixture({ integrity, fingerprint, receivedBytes: 4 }))
    await mkdir(join(userDataDir, 'agent-sdk', 'downloads'), { recursive: true })
    await writeFile(partPath, archive.slice(0, 4))
    const fetcher = async (input: string | URL): Promise<Response> =>
      String(input).includes('registry.npmjs.org')
        ? metadataResponse(archive, tarballUrl)
        : bytesResponse(archive)

    const result = await downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher,
      nowIso: () => NOW
    })

    expect(await readFile(result.archivePath)).toEqual(Buffer.from(archive))
  })

  it('aborts a connection that never returns headers', async () => {
    const userDataDir = await makeUserData()
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher: async () => new Promise<Response>(() => undefined),
      connectTimeoutMs: 5,
      maxAttempts: 1,
      nowIso: () => NOW
    })).rejects.toMatchObject({ code: 'timeout_connect' })

    expect(store.state).toMatchObject({ status: 'failed', error: { code: 'timeout_connect' } })
  })

  it('uses an independent connect timeout for the tarball request', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('expected archive')
    const controller = new AbortController()
    const fetcher = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) return metadataResponse(archive)
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'))
        }, { once: true })
      })
    }
    const operation = downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: new AgentSdkStateStore({ userDataDir, nowIso: () => NOW }),
      fetcher,
      metadataConnectTimeoutMs: 1_000,
      downloadConnectTimeoutMs: 5,
      maxAttempts: 1,
      signal: controller.signal,
      nowIso: () => NOW
    })
    const watchdog = setTimeout(() => controller.abort(new Error('test watchdog')), 250)

    try {
      await expect(operation).rejects.toMatchObject({
        code: 'timeout_connect',
        message: 'download connection timed out'
      })
    } finally {
      clearTimeout(watchdog)
    }
  })

  it('aborts a response body that stops producing chunks', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('expected archive')
    const fetcher = async (input: string | URL): Promise<Response> => {
      if (String(input).includes('registry.npmjs.org')) return metadataResponse(archive)
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
    }
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher,
      stallTimeoutMs: 5,
      maxAttempts: 1,
      nowIso: () => NOW
    })).rejects.toMatchObject({ code: 'timeout_stall' })

    expect(store.state).toMatchObject({ status: 'failed', error: { code: 'timeout_stall' } })
  })

  it('accepts 416 only when the persisted part already has the remote total', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('already complete')
    const tarballUrl = 'https://cdn.example/sdk.tgz'
    const integrity = sri(archive)
    const fingerprint = fingerprintAgentSdkTarball({
      packageName: PACKAGE_NAME,
      version: VERSION,
      tarballUrl,
      integrity
    })
    const partPath = agentSdkPartPath(userDataDir, PACKAGE_NAME, VERSION)
    await mkdir(join(userDataDir, 'agent-sdk', 'downloads'), { recursive: true })
    await writeFile(partPath, archive)
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    await store.saveState(stateFixture({
      integrity,
      fingerprint,
      receivedBytes: archive.byteLength
    }))
    const fetcher = async (input: string | URL): Promise<Response> =>
      String(input).includes('registry.npmjs.org')
        ? metadataResponse(archive, tarballUrl)
        : new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${archive.byteLength}` }
          })

    const result = await downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher,
      nowIso: () => NOW
    })

    expect(result.archivePath).toBe(partPath)
  })

  it('rejects an invalid resumed range and removes the unsafe part', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('0123456789abcdef')
    const tarballUrl = 'https://cdn.example/sdk.tgz'
    const integrity = sri(archive)
    const fingerprint = fingerprintAgentSdkTarball({
      packageName: PACKAGE_NAME,
      version: VERSION,
      tarballUrl,
      integrity
    })
    const partPath = agentSdkPartPath(userDataDir, PACKAGE_NAME, VERSION)
    await mkdir(join(userDataDir, 'agent-sdk', 'downloads'), { recursive: true })
    await writeFile(partPath, archive.slice(0, 8))
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    await store.saveState(stateFixture({ integrity, fingerprint, receivedBytes: 8 }))
    const fetcher = async (input: string | URL): Promise<Response> =>
      String(input).includes('registry.npmjs.org')
        ? metadataResponse(archive, tarballUrl)
        : bytesResponse(archive.slice(8), {
            status: 206,
            headers: { 'content-range': `bytes 7-15/${archive.byteLength}` }
          })

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: store,
      fetcher,
      maxAttempts: 1,
      nowIso: () => NOW
    })).rejects.toMatchObject({ code: 'range_invalid' })
    await expect(readFile(partPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects oversized archives from headers before writing a body', async () => {
    const userDataDir = await makeUserData()
    const archive = new TextEncoder().encode('small fixture')
    const fetcher = async (input: string | URL): Promise<Response> =>
      String(input).includes('registry.npmjs.org')
        ? metadataResponse(archive)
        : bytesResponse(archive, { headers: { 'content-length': '9999' } })

    await expect(downloadAgentSdkArchive({
      userDataDir,
      packageName: PACKAGE_NAME,
      version: VERSION,
      platform: 'linux',
      arch: 'x64',
      stateStore: new AgentSdkStateStore({ userDataDir, nowIso: () => NOW }),
      fetcher,
      maxArchiveBytes: 100,
      maxAttempts: 1,
      nowIso: () => NOW
    })).rejects.toMatchObject({ code: 'size_limit' })
  })
})
