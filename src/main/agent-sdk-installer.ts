/**
 * On-demand provisioning for the Agent SDK's platform Claude binary.
 * Platform packages stay outside the application bundle and are installed into
 * a versioned userData directory only after archive and executable validation.
 */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, lstatSync, readFileSync } from 'node:fs'
import { chmod, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  AgentSdkInstalledManifestSchema,
  type AgentSdkDownloadErrorCode,
  type AgentSdkDownloadState,
  type AgentSdkInstalledManifest
} from '../shared/agent-sdk-download'
import {
  AgentSdkDownloadFailure,
  downloadAgentSdkArchive,
  type AgentSdkArchiveDownload,
  type DownloadAgentSdkArchiveOptions
} from './agent-sdk-download'
import {
  AgentSdkStateStore,
  agentSdkInstalledManifestPath,
  agentSdkRootDir
} from './agent-sdk-state-store'
import { logInfo, logWarn } from './logger'

// Keep in sync with kun/package.json's @anthropic-ai/claude-agent-sdk version.
export const AGENT_SDK_VERSION = '0.3.193'
const DEFAULT_MIN_BINARY_BYTES = 1024 * 1024
const MAX_BINARY_BYTES = 512 * 1024 * 1024
const HEALTH_CHECK_TIMEOUT_MS = 10_000
// Extracting the ~222MB archive on an HDD or under antivirus scanning easily
// exceeds the health-check budget; give tar its own generous ceiling.
const EXTRACT_TIMEOUT_MS = 5 * 60_000
const PROCESS_OUTPUT_LIMIT = 64 * 1024
const LOG_PROGRESS_BYTE_THRESHOLD = 8 * 1024 * 1024
const LOG_PROGRESS_INTERVAL_MS = 10_000

export type AgentSdkDownloadLogRecord = {
  packageName: string
  sdkVersion: string
  platform: string
  arch: string
  phase: AgentSdkDownloadState['status']
  attempt: number
  receivedBytes: number
  totalBytes: number | null
  errorCode?: AgentSdkDownloadErrorCode
}

export function agentSdkDownloadLogRecord(
  state: AgentSdkDownloadState
): AgentSdkDownloadLogRecord {
  return {
    packageName: state.packageName,
    sdkVersion: state.sdkVersion,
    platform: state.platform,
    arch: state.arch,
    phase: state.status,
    attempt: state.attempt,
    receivedBytes: state.receivedBytes,
    totalBytes: state.totalBytes,
    ...(state.error ? { errorCode: state.error.code } : {})
  }
}

export function claudeBinaryName(platform: string = process.platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude'
}

export function platformBinaryPackage(
  platform: string = process.platform,
  arch: string = process.arch
): string | undefined {
  const normalizedArch = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : undefined
  const normalizedPlatform = platform === 'darwin'
    ? 'darwin'
    : platform === 'win32'
      ? 'win32'
      : platform === 'linux'
        ? 'linux'
        : undefined
  if (!normalizedArch || !normalizedPlatform) return undefined
  return `@anthropic-ai/claude-agent-sdk-${normalizedPlatform}-${normalizedArch}`
}

export function isAgentSdkPlatformSupported(
  platform: string = process.platform,
  arch: string = process.arch
): boolean {
  return platformBinaryPackage(platform, arch) !== undefined
}

export function agentSdkBinaryPath(
  userDataDir: string,
  platform: string = process.platform
): string {
  return join(agentSdkRootDir(userDataDir), claudeBinaryName(platform))
}

export type ResolveClaudeBinaryOptions = {
  platform?: string
  arch?: string
  version?: string
}

/**
 * Synchronous launch-path resolver. UserData binaries require a matching
 * installed manifest; bare legacy binaries are validated by ensureAgentSdkBinary.
 */
export function resolveClaudeBinary(
  userDataDir: string,
  kunDirs: readonly string[],
  options: ResolveClaudeBinaryOptions = {}
): string | undefined {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const version = options.version ?? AGENT_SDK_VERSION
  const packageName = platformBinaryPackage(platform, arch)
  if (!packageName) return undefined
  const root = agentSdkRootDir(userDataDir)
  try {
    const parsed = AgentSdkInstalledManifestSchema.safeParse(
      JSON.parse(readFileSync(agentSdkInstalledManifestPath(userDataDir), 'utf8')) as unknown
    )
    if (parsed.success) {
      const manifest = parsed.data
      const expectedRelativePath = installedBinaryRelativePath(version, platform, arch)
      const candidate = resolve(root, manifest.relativePath)
      if (manifest.packageName === packageName
        && manifest.sdkVersion === version
        && manifest.platform === platform
        && manifest.arch === arch
        && manifest.relativePath === expectedRelativePath
        && isPathInside(root, candidate)) {
        const info = lstatSync(candidate)
        if (info.isFile() && info.size === manifest.binarySize) return candidate
      }
    }
  } catch {
    // Missing, corrupt, or stale manifest: continue to the dev fallback.
  }

  for (const dir of kunDirs) {
    for (const pkg of platformPackageCandidates(platform, arch)) {
      const candidate = join(dir, 'node_modules', pkg, claudeBinaryName(platform))
      try {
        if (lstatSync(candidate).isFile()) return candidate
      } catch {
        // Keep searching.
      }
    }
  }
  return undefined
}

export function agentSdkStatus(
  userDataDir: string,
  kunDirs: readonly string[]
): { installed: boolean; path?: string } {
  const path = resolveClaudeBinary(userDataDir, kunDirs)
  if (path) return { installed: true, path }
  // A bare legacy binary (pre-manifest release) is a working install; report
  // it instead of prompting the user to re-download ~222MB.
  const legacy = agentSdkBinaryPath(userDataDir)
  try {
    if (lstatSync(legacy).isFile()) return { installed: true, path: legacy }
  } catch {
    // Not installed.
  }
  return { installed: false }
}

export type AgentSdkInstallResult =
  | { ok: true; path: string }
  | { ok: false; code: AgentSdkDownloadErrorCode; message: string }

export type InstallAgentSdkArchiveOptions = {
  userDataDir: string
  platform: string
  arch: string
  download: AgentSdkArchiveDownload
  stateStore: AgentSdkStateStore
  nowIso?: () => string
  minBinaryBytes?: number
  extractArchive?: (archivePath: string, stagingDir: string, binaryName: string) => Promise<void>
  healthCheck?: (binaryPath: string) => Promise<string | void>
}

export async function installAgentSdkArchive(
  options: InstallAgentSdkArchiveOptions
): Promise<{ path: string; manifest: AgentSdkInstalledManifest }> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const root = agentSdkRootDir(options.userDataDir)
  const binaryName = claudeBinaryName(options.platform)
  const stagingDir = join(root, `staging-${randomUUID()}`)
  const stagingBinary = join(stagingDir, binaryName)
  const targetRelativeDir = join(
    'versions',
    options.download.metadata.version,
    `${options.platform}-${options.arch}`
  )
  const targetDir = join(root, targetRelativeDir)
  const targetBinary = join(targetDir, binaryName)
  const backupDir = `${targetDir}.backup-${randomUUID()}`
  const minBinaryBytes = Math.max(1, options.minBinaryBytes ?? DEFAULT_MIN_BINARY_BYTES)
  const extractArchive = options.extractArchive ?? extractExpectedBinary
  const healthCheck = options.healthCheck ?? checkBinaryHealth

  await mkdir(stagingDir, { recursive: true })
  try {
    try {
      await extractArchive(options.download.archivePath, stagingDir, binaryName)
    } catch (error) {
      throw new AgentSdkDownloadFailure('extract_failed', 'failed to extract agent SDK binary', {
        cause: error
      })
    }
    const info = await lstat(stagingBinary).catch((error) => {
      throw new AgentSdkDownloadFailure('binary_invalid', 'agent SDK binary is missing', {
        cause: error
      })
    })
    if (!info.isFile() || info.size < minBinaryBytes || info.size > MAX_BINARY_BYTES) {
      throw new AgentSdkDownloadFailure('binary_invalid', 'agent SDK binary has an invalid size')
    }
    if (options.platform !== 'win32') await chmod(stagingBinary, 0o755)
    try {
      await healthCheck(stagingBinary)
    } catch (error) {
      throw new AgentSdkDownloadFailure('binary_invalid', 'agent SDK binary health check failed', {
        cause: error
      })
    }
    const binarySha256 = await hashFile(stagingBinary, 'sha256')
    const manifest: AgentSdkInstalledManifest = {
      schemaVersion: 1,
      packageName: options.download.metadata.packageName,
      sdkVersion: options.download.metadata.version,
      platform: options.platform,
      arch: options.arch,
      relativePath: installedBinaryRelativePath(
        options.download.metadata.version,
        options.platform,
        options.arch
      ),
      binarySize: info.size,
      binarySha256,
      tarballIntegrity: options.download.metadata.integrity,
      installedAt: nowIso()
    }

    await mkdir(dirname(targetDir), { recursive: true })
    let movedPreviousTarget = false
    let publishedReplacement = false
    try {
      try {
        await rename(targetDir, backupDir)
        movedPreviousTarget = true
      } catch (error) {
        if (!isMissingPathError(error)) throw error
      }
      await rename(stagingDir, targetDir)
      publishedReplacement = true
      await options.stateStore.writeInstalledManifest(manifest)
    } catch (error) {
      if (publishedReplacement) {
        await rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
      }
      if (movedPreviousTarget) await rename(backupDir, targetDir)
      throw error
    }
    if (movedPreviousTarget) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => undefined)
    }
    return { path: targetBinary, manifest }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export type EnsureAgentSdkBinaryDependencies = {
  stateStore?: AgentSdkStateStore
  downloadArchive?: (
    options: DownloadAgentSdkArchiveOptions
  ) => Promise<AgentSdkArchiveDownload>
  installArchive?: (
    options: InstallAgentSdkArchiveOptions
  ) => Promise<{ path: string; manifest?: AgentSdkInstalledManifest }>
  healthCheck?: (binaryPath: string) => Promise<string | void>
  nowIso?: () => string
}

export type EnsureAgentSdkBinaryOptions = {
  userDataDir: string
  kunDirs: readonly string[]
  proxyUrl?: string
  version?: string
  platform?: string
  arch?: string
  signal?: AbortSignal
  onState?: (state: AgentSdkDownloadState) => void
  dependencies?: EnsureAgentSdkBinaryDependencies
}

type ActiveAgentSdkEnsure = {
  promise: Promise<AgentSdkInstallResult>
  observers: Set<(state: AgentSdkDownloadState) => void>
}

const activeEnsures = new Map<string, ActiveAgentSdkEnsure>()
const sharedStateStores = new Map<string, AgentSdkStateStore>()

function ensureKey(
  userDataDir: string,
  platform: string,
  arch: string,
  version: string
): string {
  return `${userDataDir}\u0000${platform}\u0000${arch}\u0000${version}`
}

export function ensureAgentSdkBinary(
  options: EnsureAgentSdkBinaryOptions
): Promise<AgentSdkInstallResult> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const version = options.version ?? AGENT_SDK_VERSION
  const key = ensureKey(options.userDataDir, platform, arch, version)
  const active = activeEnsures.get(key)
  if (active) {
    if (options.onState) active.observers.add(options.onState)
    return active.promise
  }

  const observers = new Set<(state: AgentSdkDownloadState) => void>()
  if (options.onState) observers.add(options.onState)
  const notify = createAgentSdkStateObserver(observers)
  const operation = runEnsureAgentSdkBinary({
    ...options,
    platform,
    arch,
    version,
    onState: notify
  }).catch((error: unknown): AgentSdkInstallResult => {
    const failure = installerFailure(error)
    logAgentSdkRecord({
      packageName: platformBinaryPackage(platform, arch) ?? 'unsupported',
      sdkVersion: version,
      platform,
      arch,
      phase: 'failed',
      attempt: 0,
      receivedBytes: 0,
      totalBytes: null,
      errorCode: failure.code
    }, true)
    return { ok: false, code: failure.code, message: failure.message }
  })
  let entry: ActiveAgentSdkEnsure
  const tracked = operation.finally(() => {
    if (activeEnsures.get(key) === entry) activeEnsures.delete(key)
  })
  entry = { promise: tracked, observers }
  activeEnsures.set(key, entry)
  return tracked
}

async function runEnsureAgentSdkBinary(
  options: EnsureAgentSdkBinaryOptions & { platform: string; arch: string; version: string }
): Promise<AgentSdkInstallResult> {
  const packageName = platformBinaryPackage(options.platform, options.arch)
  const nowIso = options.dependencies?.nowIso ?? (() => new Date().toISOString())
  const stateStore = options.dependencies?.stateStore ?? stateStoreFor(options.userDataDir, nowIso)
  if (!packageName) {
    const message = `unsupported platform: ${options.platform}/${options.arch}`
    await saveAndEmit(stateStore, createDownloadState({
      status: 'failed',
      packageName: 'unsupported',
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      updatedAt: nowIso(),
      error: { code: 'unsupported', message, retriable: false }
    }), options.onState)
    return { ok: false, code: 'unsupported', message }
  }

  // Status transitions spread the current state when one exists so progress
  // metadata (bytes, attempt, etag) survives, and reset retry/error fields.
  const emitStatus = (
    status: AgentSdkDownloadState['status'],
    error?: AgentSdkDownloadState['error']
  ): Promise<AgentSdkDownloadState> => saveAndEmit(stateStore, {
    ...(stateStore.state ?? createDownloadState({
      status,
      packageName,
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      updatedAt: nowIso()
    })),
    status,
    nextRetryAt: undefined,
    error,
    updatedAt: nowIso()
  }, options.onState)

  const existing = resolveClaudeBinary(options.userDataDir, options.kunDirs, {
    platform: options.platform,
    arch: options.arch,
    version: options.version
  })
  if (existing) {
    await saveAndEmit(stateStore, createDownloadState({
      status: 'ready',
      packageName,
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      updatedAt: nowIso()
    }), options.onState)
    return { ok: true, path: existing }
  }

  const healthCheck = options.dependencies?.healthCheck ?? checkBinaryHealth
  const legacy = agentSdkBinaryPath(options.userDataDir, options.platform)
  let legacyHealthOutput: string | undefined
  try {
    if ((await lstat(legacy)).isFile()) {
      legacyHealthOutput = (await healthCheck(legacy)) ?? ''
    }
  } catch (error) {
    if (shouldQuarantineLegacyBinary(error)) {
      // The binary ran and failed (or is not executable): it is genuinely
      // broken, so move it aside and fall through to a fresh download.
      await rename(legacy, `${legacy}.invalid-${Date.now()}`).catch(() => undefined)
      logWarn('agent-sdk-download', `legacy binary failed health check; quarantined: ${String(error)}`)
    } else if (!isMissingPathError(error)) {
      // Transient failure (timeout under AV scan, EBUSY, ...): keep the file.
      // Destroying a possibly working install would force a ~222MB re-download
      // and brick offline machines; the next attempt re-checks it.
      logWarn('agent-sdk-download', `legacy binary health check inconclusive; keeping file: ${String(error)}`)
    }
  }
  if (legacyHealthOutput !== undefined) {
    // Migrate a version-matching legacy binary into the manifest layout so
    // later launches take the fast manifest path instead of re-running the
    // health check. Best-effort: on any failure keep using the legacy path.
    const migrated = await migrateLegacyBinary({
      userDataDir: options.userDataDir,
      platform: options.platform,
      arch: options.arch,
      version: options.version,
      packageName,
      legacyPath: legacy,
      healthOutput: legacyHealthOutput,
      stateStore,
      nowIso
    }).catch((error: unknown) => {
      logWarn('agent-sdk-download', `legacy binary migration failed; keeping flat layout: ${String(error)}`)
      return undefined
    })
    await saveAndEmit(stateStore, createDownloadState({
      status: 'ready',
      packageName,
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      updatedAt: nowIso()
    }), options.onState)
    return { ok: true, path: migrated ?? legacy }
  }

  try {
    const downloadArchive = options.dependencies?.downloadArchive ?? downloadAgentSdkArchive
    const download = await downloadArchive({
      userDataDir: options.userDataDir,
      packageName,
      version: options.version,
      platform: options.platform,
      arch: options.arch,
      stateStore,
      proxyUrl: options.proxyUrl,
      signal: options.signal,
      nowIso,
      onState: options.onState
    })
    await emitStatus('installing')
    const installArchive = options.dependencies?.installArchive ?? installAgentSdkArchive
    const installed = await installArchive({
      userDataDir: options.userDataDir,
      platform: options.platform,
      arch: options.arch,
      download,
      stateStore,
      nowIso
    })
    await emitStatus('ready')
    await rm(download.archivePath, { force: true }).catch(() => undefined)
    return { ok: true, path: installed.path }
  } catch (error) {
    const failure = installerFailure(error)
    if (stateStore.state?.status !== 'failed' && stateStore.state?.status !== 'interrupted') {
      await emitStatus('failed', {
        code: failure.code,
        message: failure.message,
        retriable: failure.retriable
      })
    }
    return { ok: false, code: failure.code, message: failure.message }
  }
}

export async function agentSdkDownloadState(
  userDataDir: string
): Promise<AgentSdkDownloadState | null> {
  const store = stateStoreFor(userDataDir, () => new Date().toISOString())
  const existing = store.state
  if (existing) return existing
  const packageName = platformBinaryPackage()
  if (!packageName) return null
  return store.loadState(createDownloadState({
    status: 'idle',
    packageName,
    version: AGENT_SDK_VERSION,
    platform: process.platform,
    arch: process.arch,
    updatedAt: new Date().toISOString()
  }))
}

export async function startAgentSdkInstall(
  options: { userDataDir: string; proxyUrl?: string; version?: string; kunDirs?: readonly string[] },
  onState?: (state: AgentSdkDownloadState) => void
): Promise<AgentSdkDownloadState> {
  const store = stateStoreFor(options.userDataDir, () => new Date().toISOString())
  const packageName = platformBinaryPackage() ?? 'unsupported'
  const version = options.version ?? AGENT_SDK_VERSION
  // While an ensure is live in this process, its in-memory state is the source
  // of truth. loadState would re-read the disk snapshot and flip the running
  // 'downloading'/'installing' status to 'interrupted' out from under it.
  const activeKey = ensureKey(options.userDataDir, process.platform, process.arch, version)
  const initial = activeEnsures.has(activeKey) && store.state
    ? store.state
    : await store.loadState(createDownloadState({
      status: 'idle',
      packageName,
      version,
      platform: process.platform,
      arch: process.arch,
      updatedAt: new Date().toISOString()
    }))
  void ensureAgentSdkBinary({
    userDataDir: options.userDataDir,
    kunDirs: options.kunDirs ?? [],
    proxyUrl: options.proxyUrl,
    version: options.version,
    onState
  })
  return store.state ?? initial
}

function stateStoreFor(userDataDir: string, nowIso: () => string): AgentSdkStateStore {
  const key = resolve(userDataDir)
  const existing = sharedStateStores.get(key)
  if (existing) return existing
  const store = new AgentSdkStateStore({ userDataDir, nowIso })
  sharedStateStores.set(key, store)
  return store
}

function createAgentSdkStateObserver(
  observers: Set<(state: AgentSdkDownloadState) => void>
): (state: AgentSdkDownloadState) => void {
  let lastLoggedStatus: AgentSdkDownloadState['status'] | null = null
  let lastLoggedBytes = 0
  let lastLoggedAt = 0
  return (state) => {
    for (const observer of observers) {
      try {
        observer(structuredClone(state))
      } catch {
        // Progress observers must never break the shared install operation.
      }
    }

    const now = Date.now()
    const shouldLog = state.status !== lastLoggedStatus
      || (state.status === 'downloading'
        && (state.receivedBytes - lastLoggedBytes >= LOG_PROGRESS_BYTE_THRESHOLD
          || now - lastLoggedAt >= LOG_PROGRESS_INTERVAL_MS))
    if (!shouldLog) return
    lastLoggedStatus = state.status
    lastLoggedBytes = state.receivedBytes
    lastLoggedAt = now
    logAgentSdkRecord(
      agentSdkDownloadLogRecord(state),
      state.status === 'retrying' || state.status === 'failed' || state.status === 'interrupted'
    )
  }
}

function logAgentSdkRecord(record: AgentSdkDownloadLogRecord, warn: boolean): void {
  const message = JSON.stringify(record)
  if (warn) logWarn('agent-sdk-download', message)
  else logInfo('agent-sdk-download', message)
}

function createDownloadState(input: {
  status: AgentSdkDownloadState['status']
  packageName: string
  version: string
  platform: string
  arch: string
  updatedAt: string
  error?: AgentSdkDownloadState['error']
}): AgentSdkDownloadState {
  return {
    schemaVersion: 1,
    status: input.status,
    packageName: input.packageName,
    sdkVersion: input.version,
    platform: input.platform,
    arch: input.arch,
    attempt: 0,
    receivedBytes: 0,
    totalBytes: null,
    ...(input.error ? { error: input.error } : {}),
    updatedAt: input.updatedAt
  }
}

async function saveAndEmit(
  store: AgentSdkStateStore,
  state: AgentSdkDownloadState,
  onState: ((state: AgentSdkDownloadState) => void) | undefined
): Promise<AgentSdkDownloadState> {
  const saved = await store.saveState(state)
  onState?.(saved)
  return saved
}

function installedBinaryRelativePath(version: string, platform: string, arch: string): string {
  return join('versions', version, `${platform}-${arch}`, claudeBinaryName(platform))
    .replaceAll('\\', '/')
}

function platformPackageCandidates(platform: string, arch: string): string[] {
  const primary = platformBinaryPackage(platform, arch)
  if (!primary) return []
  return platform === 'linux' ? [primary, `${primary}-musl`] : [primary]
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !rel.startsWith('\\'))
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function extractExpectedBinary(
  archivePath: string,
  stagingDir: string,
  binaryName: string
): Promise<void> {
  const expected = `package/${binaryName}`
  const listing = await runProcess('tar', ['-tzf', archivePath], {
    timeoutMs: EXTRACT_TIMEOUT_MS,
    maxOutputBytes: PROCESS_OUTPUT_LIMIT
  })
  const entries = listing.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
  if (!entries.includes(expected)) throw new Error(`archive does not contain ${expected}`)
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('archive contains an unsafe path')
    }
  }
  await runProcess(
    'tar',
    ['-xzf', archivePath, '-C', stagingDir, '--strip-components=1', expected],
    { timeoutMs: EXTRACT_TIMEOUT_MS, maxOutputBytes: PROCESS_OUTPUT_LIMIT }
  )
}

async function checkBinaryHealth(binaryPath: string): Promise<string> {
  const { stdout } = await runProcess(binaryPath, ['--version'], {
    timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    maxOutputBytes: PROCESS_OUTPUT_LIMIT
  })
  return stdout
}

/**
 * Quarantine only on definitive evidence the binary itself is broken: it ran
 * and exited non-zero, or the OS refused to execute it. Timeouts, output
 * overflows, and transient FS/permission errors keep the file in place.
 */
export function shouldQuarantineLegacyBinary(error: unknown): boolean {
  if (error instanceof RunProcessError) return error.kind === 'exit'
  return (error as NodeJS.ErrnoException)?.code === 'ENOEXEC'
}

/**
 * Move a healthy legacy flat binary into the versioned manifest layout when
 * its reported version matches the pinned SDK version, so later launches use
 * the fast manifest resolution path. Returns the new path, or undefined when
 * the version differs or cannot be parsed.
 */
async function migrateLegacyBinary(input: {
  userDataDir: string
  platform: string
  arch: string
  version: string
  packageName: string
  legacyPath: string
  healthOutput: string
  stateStore: AgentSdkStateStore
  nowIso: () => string
}): Promise<string | undefined> {
  const reported = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(input.healthOutput)?.[1]
  if (reported !== input.version) return undefined
  const info = await lstat(input.legacyPath)
  if (!info.isFile()) return undefined
  const relativePath = installedBinaryRelativePath(input.version, input.platform, input.arch)
  const target = join(agentSdkRootDir(input.userDataDir), relativePath)
  const binarySha256 = await hashFile(input.legacyPath, 'sha256')
  await mkdir(dirname(target), { recursive: true })
  await rm(target, { force: true }).catch(() => undefined)
  await rename(input.legacyPath, target)
  try {
    await input.stateStore.writeInstalledManifest({
      schemaVersion: 1,
      packageName: input.packageName,
      sdkVersion: input.version,
      platform: input.platform,
      arch: input.arch,
      relativePath,
      binarySize: info.size,
      binarySha256,
      installedAt: input.nowIso()
    })
  } catch (error) {
    // Restore the flat layout so the binary keeps working without a manifest.
    await rename(target, input.legacyPath).catch(() => undefined)
    throw error
  }
  return target
}

async function hashFile(path: string, algorithm: 'sha256'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export type RunProcessErrorKind = 'timeout' | 'exit' | 'output-limit'

export class RunProcessError extends Error {
  readonly kind: RunProcessErrorKind
  readonly exitCode: number | null

  constructor(message: string, kind: RunProcessErrorKind, exitCode: number | null = null) {
    super(message)
    this.name = 'RunProcessError'
    this.kind = kind
    this.exitCode = exitCode
  }
}

function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; maxOutputBytes: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      finish(new RunProcessError(`${command} timed out`, 'timeout'))
    }, options.timeoutMs)
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise({ stdout: stdout.toString(), stderr: stderr.toString() })
    }
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (settled) return
      const next = target === 'stdout'
        ? Buffer.concat([stdout, chunk])
        : Buffer.concat([stderr, chunk])
      if (next.byteLength > options.maxOutputBytes) {
        child.kill()
        finish(new RunProcessError(`${command} output exceeded limit`, 'output-limit'))
        return
      }
      if (target === 'stdout') stdout = next
      else stderr = next
    }
    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.on('error', (error) => finish(error))
    child.on('exit', (code) => {
      finish(code === 0 ? undefined : new RunProcessError(`${command} exited ${code}`, 'exit', code))
    })
  })
}

function installerFailure(error: unknown): AgentSdkDownloadFailure {
  if (error instanceof AgentSdkDownloadFailure) return error
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
  return new AgentSdkDownloadFailure('binary_invalid', 'agent SDK installation failed', {
    cause: error
  })
}
