import { createHash, randomUUID } from 'node:crypto'
import { freemem, totalmem } from 'node:os'
import { basename } from 'node:path'
import {
  CRASH_ERROR_MESSAGE_MAX_LENGTH,
  CRASH_ERROR_STACK_MAX_LENGTH,
  crashContextSnapshotSchema,
  crashRecordV1Schema,
  crashStartupPhasesSchema,
  normalizedRendererCrashContextSchema,
  recentIpcOperationSchema,
  rendererCrashContextPayloadSchema,
  type CrashContextSnapshot,
  type CrashKind,
  type CrashRecordV1,
  type CrashSeverity,
  type NormalizedRendererCrashContext
} from '../shared/crash-types'
import { redactSecrets, redactSecretText } from '../shared/secret-redaction'

const MAX_CONTEXT_DEPTH = 6
const MAX_CONTEXT_ENTRIES = 100
const MAX_CONTEXT_STRING_LENGTH = 2_048

export type CrashContextProviderKey = 'startupPhases' | 'runtime' | 'recentIpc'
export type CrashContextProvider = () => unknown

export interface CrashContextRegistry {
  registerProvider(key: CrashContextProviderKey, provider: CrashContextProvider): () => void
  updateRenderer(payload: unknown): boolean
  snapshot(): CrashContextSnapshot
}

export interface CrashAppMetricInput {
  type: string
  pid: number
  workingSetSizeKb?: number
}

export interface CrashMemoryUsageInput {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
}

export interface CrashRecordFactoryDeps {
  context: CrashContextRegistry
  getAppVersion: () => string
  getElectronVersion?: () => string
  getNodeVersion?: () => string
  getChromeVersion?: () => string | undefined
  getAppMetrics?: () => CrashAppMetricInput[]
  getMemoryUsage?: () => CrashMemoryUsageInput
  getSystemMemory?: () => { totalBytes: number; freeBytes: number }
  now?: () => Date
  randomId?: () => string
  pid?: number
  processType?: string
  getUptimeMs?: () => number
  platform?: string
  arch?: string
  packaged: boolean
}

export interface CreateCrashRecordInput {
  kind: CrashKind
  severity: CrashSeverity
  error: unknown
  details?: Record<string, unknown>
}

function safeString(value: unknown, maxLength: number, fallback = ''): string {
  try {
    return redactSecretText(String(value)).slice(0, maxLength)
  } catch {
    return fallback
  }
}

function sanitizeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_CONTEXT_STRING_LENGTH)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value === 'bigint') return value.toString()
  if (value === undefined) return null
  if (typeof value === 'symbol' || typeof value === 'function') return safeString(value, 256)
  if (depth >= MAX_CONTEXT_DEPTH) return '<truncated>'
  if (typeof value !== 'object') return safeString(value, MAX_CONTEXT_STRING_LENGTH)
  if (seen.has(value)) return '<circular>'
  seen.add(value)

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((entry) => sanitizeValue(entry, depth + 1, seen))
  }

  const output: Record<string, unknown> = {}
  let keys: string[] = []
  try {
    keys = Object.keys(value).slice(0, MAX_CONTEXT_ENTRIES)
  } catch {
    return '<unavailable>'
  }
  for (const key of keys) {
    try {
      output[key.slice(0, 128)] = sanitizeValue(
        (value as Record<string, unknown>)[key],
        depth + 1,
        seen
      )
    } catch {
      output[key.slice(0, 128)] = '<unavailable>'
    }
  }
  return output
}

function sanitizeForCrash(value: unknown): unknown {
  const sanitized = sanitizeValue(value, 0, new WeakSet<object>())
  try {
    return redactSecrets(sanitized)
  } catch {
    return '<unavailable>'
  }
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? redactSecretText(normalized) : undefined
}

function normalizeRendererContext(payload: unknown): NormalizedRendererCrashContext | null {
  const parsed = rendererCrashContextPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  const value = parsed.data
  const route = optionalText(value.route)
  const workspaceRoot = value.workspaceRoot?.trim()
  const threadId = optionalText(value.activeThreadId)
  const turnId = optionalText(value.currentTurnId)
  const workspaceName = workspaceRoot
    ? basename(workspaceRoot.replace(/\\/g, '/')) || 'workspace'
    : undefined
  const context: NormalizedRendererCrashContext = {
    ...(route ? { route } : {}),
    ...(workspaceRoot && workspaceName
      ? {
          workspace: {
            basename: redactSecretText(workspaceName).slice(0, 256),
            hash: createHash('sha256').update(workspaceRoot).digest('hex')
          }
        }
      : {}),
    ...(threadId ? { threadId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(value.busy !== undefined ? { busy: value.busy } : {}),
    ...(value.task !== undefined
      ? {
          task: value.task
            ? {
                id: redactSecretText(value.task.id),
                status: redactSecretText(value.task.status)
              }
            : null
        }
      : {})
  }
  const validated = normalizedRendererCrashContextSchema.safeParse(context)
  return validated.success ? validated.data : null
}

export function createCrashContextRegistry(): CrashContextRegistry {
  const providers = new Map<CrashContextProviderKey, CrashContextProvider>()
  let renderer: NormalizedRendererCrashContext | null = null

  return {
    registerProvider(key, provider) {
      providers.set(key, provider)
      return (): void => {
        if (providers.get(key) === provider) providers.delete(key)
      }
    },
    updateRenderer(payload) {
      const normalized = normalizeRendererContext(payload)
      if (!normalized) return false
      renderer = normalized
      return true
    },
    snapshot() {
      let startupPhases: CrashContextSnapshot['startupPhases'] = {}
      let runtime: unknown = null
      let recentIpc: CrashContextSnapshot['recentIpc'] = []
      const providerErrors: CrashContextProviderKey[] = []

      for (const [key, provider] of providers) {
        try {
          const value = sanitizeForCrash(provider())
          if (key === 'startupPhases') {
            const parsed = crashStartupPhasesSchema.safeParse(value)
            if (parsed.success) startupPhases = parsed.data
            else providerErrors.push(key)
          } else if (key === 'runtime') {
            runtime = value
          } else {
            const parsed = recentIpcOperationSchema.array().max(20).safeParse(value)
            if (parsed.success) recentIpc = parsed.data
            else providerErrors.push(key)
          }
        } catch {
          providerErrors.push(key)
        }
      }

      return crashContextSnapshotSchema.parse({
        startupPhases,
        runtime,
        renderer,
        recentIpc,
        ...(providerErrors.length > 0 ? { details: { providerErrors } } : {})
      })
    }
  }
}

function safeCall<T>(callback: () => T, fallback: T): T {
  try {
    return callback()
  } catch {
    return fallback
  }
}

function normalizeError(error: unknown): CrashRecordV1['error'] {
  let name = 'Error'
  let message = ''
  let stack: string | undefined
  if (error instanceof Error) {
    name = safeString(error.name || 'Error', 256, 'Error')
    message = safeString(error.message, CRASH_ERROR_MESSAGE_MAX_LENGTH)
    const normalizedStack = safeString(error.stack ?? '', CRASH_ERROR_STACK_MAX_LENGTH)
    if (normalizedStack) stack = normalizedStack
  } else {
    message = safeString(error, CRASH_ERROR_MESSAGE_MAX_LENGTH, 'Unknown error')
  }
  return { name: name || 'Error', message, ...(stack ? { stack } : {}) }
}

function normalizeMetric(
  metric: CrashAppMetricInput
): NonNullable<CrashRecordV1['memory']['appMetrics']>[number] {
  return {
    type: safeString(metric.type, 64, 'Unknown') || 'Unknown',
    pid: Number.isInteger(metric.pid) && metric.pid >= 0 ? metric.pid : 0,
    ...(typeof metric.workingSetSizeKb === 'number' &&
    Number.isFinite(metric.workingSetSizeKb) &&
    metric.workingSetSizeKb >= 0
      ? { workingSetSizeKb: metric.workingSetSizeKb }
      : {})
  }
}

export function createCrashRecordFactory(
  deps: CrashRecordFactoryDeps
): (input: CreateCrashRecordInput) => CrashRecordV1 {
  return (input): CrashRecordV1 => {
    const occurredAt = safeCall(deps.now ?? ((): Date => new Date()), new Date())
    const memory = safeCall(
      deps.getMemoryUsage ??
        ((): CrashMemoryUsageInput => {
          const usage = process.memoryUsage()
          return {
            rss: usage.rss,
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external
          }
        }),
      { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }
    )
    const systemMemory = safeCall(
      deps.getSystemMemory ?? (() => ({ totalBytes: totalmem(), freeBytes: freemem() })),
      { totalBytes: 0, freeBytes: 0 }
    )
    const appMetrics = safeCall(deps.getAppMetrics ?? (() => []), [])
      .slice(0, 64)
      .map(normalizeMetric)
    const context = safeCall(deps.context.snapshot, {
      startupPhases: {},
      runtime: null,
      renderer: null,
      recentIpc: [],
      details: { providerErrors: ['context'] }
    })
    const rawId = safeCall(deps.randomId ?? randomUUID, `crash-${Date.now()}`)
    const id = safeString(rawId, 128, `crash-${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, '-')
    const details = input.details ? sanitizeForCrash(input.details) : undefined
    const record: CrashRecordV1 = {
      schemaVersion: 1,
      id: id || `crash-${Date.now()}`,
      kind: input.kind,
      severity: input.severity,
      occurredAt: occurredAt.toISOString(),
      process: {
        pid: deps.pid ?? process.pid,
        type: safeString(deps.processType ?? 'browser', 64, 'browser') || 'browser',
        uptimeMs: Math.max(0, safeCall(deps.getUptimeMs ?? (() => process.uptime() * 1_000), 0))
      },
      versions: {
        app: safeString(safeCall(deps.getAppVersion, ''), 128),
        electron: safeString(
          safeCall(deps.getElectronVersion ?? (() => process.versions.electron ?? ''), ''),
          128
        ),
        node: safeString(
          safeCall(deps.getNodeVersion ?? (() => process.versions.node ?? ''), ''),
          128
        ),
        ...((): { chrome?: string } => {
          const chrome = safeString(
            safeCall(deps.getChromeVersion ?? (() => process.versions.chrome), ''),
            128
          )
          return chrome ? { chrome } : {}
        })()
      },
      system: {
        platform: safeString(deps.platform ?? process.platform, 64, 'unknown') || 'unknown',
        arch: safeString(deps.arch ?? process.arch, 64, 'unknown') || 'unknown',
        packaged: deps.packaged
      },
      memory: {
        rss: Math.max(0, memory.rss),
        heapUsed: Math.max(0, memory.heapUsed),
        heapTotal: Math.max(0, memory.heapTotal),
        external: Math.max(0, memory.external),
        systemTotalKb: Math.max(0, Math.round(systemMemory.totalBytes / 1_024)),
        systemFreeKb: Math.max(0, Math.round(systemMemory.freeBytes / 1_024)),
        appMetrics
      },
      error: normalizeError(input.error),
      context: {
        ...context,
        ...(details && typeof details === 'object' && !Array.isArray(details)
          ? {
              details: {
                ...(context.details ?? {}),
                ...(details as Record<string, unknown>)
              }
            }
          : {})
      }
    }
    return crashRecordV1Schema.parse(record)
  }
}
