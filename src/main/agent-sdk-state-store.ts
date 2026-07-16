import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AgentSdkDownloadStateSchema,
  AgentSdkInstalledManifestSchema,
  type AgentSdkDownloadState,
  type AgentSdkInstalledManifest
} from '../shared/agent-sdk-download'

const DEFAULT_PROGRESS_BYTE_THRESHOLD = 1024 * 1024
const DEFAULT_PROGRESS_INTERVAL_MS = 1_000
const INTERRUPTED_STATUSES = new Set([
  'resolving',
  'downloading',
  'retrying',
  'verifying',
  'installing'
])

export function agentSdkRootDir(userDataDir: string): string {
  return join(userDataDir, 'agent-sdk')
}

export function agentSdkStatePath(userDataDir: string): string {
  return join(agentSdkRootDir(userDataDir), 'download-state.json')
}

export function agentSdkInstalledManifestPath(userDataDir: string): string {
  return join(agentSdkRootDir(userDataDir), 'installed.json')
}

export type AgentSdkStateStoreOptions = {
  userDataDir: string
  nowIso?: () => string
  nowMs?: () => number
  progressByteThreshold?: number
  progressIntervalMs?: number
  writeAtomic?: (path: string, contents: string) => Promise<void>
}

export class AgentSdkStateStore {
  private readonly userDataDir: string
  private readonly nowIso: () => string
  private readonly nowMs: () => number
  private readonly progressByteThreshold: number
  private readonly progressIntervalMs: number
  private readonly writeAtomic: (path: string, contents: string) => Promise<void>
  private currentState: AgentSdkDownloadState | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private lastQueuedStatus: AgentSdkDownloadState['status'] | null = null
  private lastQueuedBytes = 0
  private lastQueuedAtMs = 0

  constructor(options: AgentSdkStateStoreOptions) {
    this.userDataDir = options.userDataDir
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nowMs = options.nowMs ?? Date.now
    this.progressByteThreshold = Math.max(
      1,
      Math.floor(options.progressByteThreshold ?? DEFAULT_PROGRESS_BYTE_THRESHOLD)
    )
    this.progressIntervalMs = Math.max(
      1,
      Math.floor(options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS)
    )
    this.writeAtomic = options.writeAtomic ?? atomicWriteText
  }

  get state(): AgentSdkDownloadState | null {
    return this.currentState ? structuredClone(this.currentState) : null
  }

  async loadState(fallback: AgentSdkDownloadState): Promise<AgentSdkDownloadState> {
    const validatedFallback = AgentSdkDownloadStateSchema.parse(fallback)
    let loaded: AgentSdkDownloadState | null = null
    try {
      const parsed = JSON.parse(await readFile(agentSdkStatePath(this.userDataDir), 'utf8')) as unknown
      const result = AgentSdkDownloadStateSchema.safeParse(parsed)
      if (result.success) loaded = result.data
    } catch {
      loaded = null
    }

    let state = validatedFallback
    let isMatchingState = false
    if (loaded !== null
      && loaded.packageName === validatedFallback.packageName
      && loaded.sdkVersion === validatedFallback.sdkVersion
      && loaded.platform === validatedFallback.platform
      && loaded.arch === validatedFallback.arch) {
      state = loaded
      isMatchingState = true
    }
    this.currentState = state
    this.noteQueued(state)
    if (!isMatchingState) return this.saveState(state)
    if (!INTERRUPTED_STATUSES.has(state.status)) return structuredClone(state)
    return this.saveState({
      ...state,
      status: 'interrupted',
      nextRetryAt: undefined,
      updatedAt: this.nowIso()
    })
  }

  async saveState(
    input: AgentSdkDownloadState,
    options: { throttled?: boolean } = {}
  ): Promise<AgentSdkDownloadState> {
    const state = AgentSdkDownloadStateSchema.parse({
      ...input,
      updatedAt: this.nowIso()
    })
    this.currentState = state
    const shouldPersist = !options.throttled
      || this.lastQueuedStatus !== state.status
      || state.receivedBytes - this.lastQueuedBytes >= this.progressByteThreshold
      || this.nowMs() - this.lastQueuedAtMs >= this.progressIntervalMs
    if (!shouldPersist) return structuredClone(state)

    this.noteQueued(state)
    const contents = `${JSON.stringify(state, null, 2)}\n`
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(agentSdkRootDir(this.userDataDir), { recursive: true })
        await this.writeAtomic(agentSdkStatePath(this.userDataDir), contents)
      })
    this.writeQueue = operation
    await operation
    return structuredClone(state)
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  async readInstalledManifest(): Promise<AgentSdkInstalledManifest | null> {
    try {
      const parsed = JSON.parse(
        await readFile(agentSdkInstalledManifestPath(this.userDataDir), 'utf8')
      ) as unknown
      const result = AgentSdkInstalledManifestSchema.safeParse(parsed)
      return result.success ? result.data : null
    } catch {
      return null
    }
  }

  async writeInstalledManifest(manifest: AgentSdkInstalledManifest): Promise<void> {
    const validated = AgentSdkInstalledManifestSchema.parse(manifest)
    await mkdir(agentSdkRootDir(this.userDataDir), { recursive: true })
    await this.writeAtomic(
      agentSdkInstalledManifestPath(this.userDataDir),
      `${JSON.stringify(validated, null, 2)}\n`
    )
  }

  private noteQueued(state: AgentSdkDownloadState): void {
    this.lastQueuedStatus = state.status
    this.lastQueuedBytes = state.receivedBytes
    this.lastQueuedAtMs = this.nowMs()
  }
}

async function atomicWriteText(path: string, contents: string): Promise<void> {
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tmpPath, contents, 'utf8')
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}
