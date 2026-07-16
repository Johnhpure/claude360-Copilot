import {
  CRASH_ERROR_MESSAGE_MAX_LENGTH,
  CRASH_ERROR_STACK_MAX_LENGTH,
  rendererCrashEventPayloadSchema,
  type RendererCrashEventPayload
} from '@shared/crash-types'

const DEFAULT_DEDUPE_WINDOW_MS = 60_000
const DEFAULT_MAX_SIGNATURES = 100

export interface RendererErrorEventLike {
  message?: string
  error?: unknown
  filename?: string
  lineno?: number
  colno?: number
}

export interface RendererRejectionEventLike {
  reason?: unknown
}

export interface RendererErrorReportOptions {
  /**
   * Bypass the dedupe window. Error-boundary reports carry the only copy of
   * the React componentStack, so a repeat of the same error within the window
   * must still reach the crash store.
   */
  force?: boolean
}

export interface GlobalErrorReporter {
  reportError(
    event: RendererErrorEventLike,
    message?: string,
    reportOptions?: RendererErrorReportOptions
  ): void
  reportUnhandledRejection(event: RendererRejectionEventLike): void
}

export interface GlobalErrorReporterOptions {
  report: (
    category: string,
    message: string,
    detail: RendererCrashEventPayload
  ) => Promise<void> | void
  now?: () => number
  dedupeWindowMs?: number
  maxSignatures?: number
}

export interface InstallGlobalErrorReporterOptions {
  target?: Window
  report?: GlobalErrorReporterOptions['report']
  now?: () => number
}

export type RendererCrashLocation = Partial<
  Pick<RendererCrashEventPayload, 'source' | 'line' | 'column'>
>

function safeText(value: unknown, maxLength: number, fallback = ''): string {
  try {
    return String(value).slice(0, maxLength)
  } catch {
    return fallback
  }
}

function readStringProperty(value: object, key: string): string | undefined {
  try {
    const property = (value as Record<string, unknown>)[key]
    return typeof property === 'string' ? property : undefined
  } catch {
    return undefined
  }
}

function normalizeReason(value: unknown): Pick<RendererCrashEventPayload, 'name' | 'message' | 'stack'> {
  if (value instanceof Error) {
    const stack = safeText(value.stack ?? '', CRASH_ERROR_STACK_MAX_LENGTH)
    return {
      name: safeText(value.name || 'Error', 256, 'Error') || 'Error',
      message: safeText(value.message, CRASH_ERROR_MESSAGE_MAX_LENGTH),
      ...(stack ? { stack } : {})
    }
  }
  if (value && typeof value === 'object') {
    const name = readStringProperty(value, 'name') ?? 'Error'
    const message = readStringProperty(value, 'message') ?? safeText(value, CRASH_ERROR_MESSAGE_MAX_LENGTH)
    const stack = readStringProperty(value, 'stack')
    return {
      name: safeText(name, 256, 'Error') || 'Error',
      message: safeText(message, CRASH_ERROR_MESSAGE_MAX_LENGTH),
      ...(stack ? { stack: safeText(stack, CRASH_ERROR_STACK_MAX_LENGTH) } : {})
    }
  }
  return {
    name: 'Error',
    message: safeText(value, CRASH_ERROR_MESSAGE_MAX_LENGTH, 'Unknown renderer error')
  }
}

function stableSignature(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createRendererCrashEventPayload(
  kind: RendererCrashEventPayload['kind'],
  reason: unknown,
  location: RendererCrashLocation = {}
): RendererCrashEventPayload {
  const normalized = normalizeReason(reason)
  const signature = stableSignature(
    `${kind}|${normalized.name}|${normalized.message.slice(0, 200)}`
  )
  return rendererCrashEventPayloadSchema.parse({
    kind,
    ...normalized,
    signature,
    ...location
  })
}

export function createGlobalErrorReporter(
  options: GlobalErrorReporterOptions
): GlobalErrorReporter {
  const now = options.now ?? Date.now
  const dedupeWindowMs = Math.max(0, options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS)
  const maxSignatures = Math.max(1, options.maxSignatures ?? DEFAULT_MAX_SIGNATURES)
  const reportedAtBySignature = new Map<string, number>()

  const report = (
    kind: RendererCrashEventPayload['kind'],
    reason: unknown,
    location: RendererCrashLocation = {},
    message?: string,
    force = false
  ): void => {
    const detail = createRendererCrashEventPayload(kind, reason, location)
    const signature = detail.signature
    const currentTime = now()
    const previousTime = reportedAtBySignature.get(signature)
    if (!force && previousTime !== undefined && currentTime - previousTime < dedupeWindowMs) return

    reportedAtBySignature.delete(signature)
    reportedAtBySignature.set(signature, currentTime)
    while (reportedAtBySignature.size > maxSignatures) {
      const oldest = reportedAtBySignature.keys().next().value
      if (typeof oldest !== 'string') break
      reportedAtBySignature.delete(oldest)
    }

    try {
      const pending = options.report(
        'renderer-crash',
        message ?? (kind === 'error' ? 'Unhandled renderer error' : 'Unhandled renderer rejection'),
        detail
      )
      if (pending instanceof Promise) void pending.catch(() => undefined)
    } catch {
      // The reporter must not recursively report failures from the logging bridge.
    }
  }

  return {
    reportError(event, message, reportOptions) {
      const reason = event.error ?? event.message ?? 'Unknown renderer error'
      report('error', reason, {
        ...(event.filename ? { source: safeText(event.filename, 2_048) } : {}),
        ...(Number.isSafeInteger(event.lineno) && (event.lineno ?? -1) >= 0
          ? { line: event.lineno }
          : {}),
        ...(Number.isSafeInteger(event.colno) && (event.colno ?? -1) >= 0
          ? { column: event.colno }
          : {})
      }, message, reportOptions?.force === true)
    },
    reportUnhandledRejection(event) {
      report('unhandledrejection', event.reason ?? 'Unknown renderer rejection')
    }
  }
}

const reportThroughPreload: GlobalErrorReporterOptions['report'] = (category, message, detail) => {
  if (typeof window.kunGui?.logError !== 'function') return
  return window.kunGui.logError(category, message, detail)
}

const fallbackGlobalErrorReporter = createGlobalErrorReporter({ report: reportThroughPreload })
let activeGlobalErrorReporter = fallbackGlobalErrorReporter

export function reportRendererError(
  event: RendererErrorEventLike,
  message?: string,
  reportOptions?: RendererErrorReportOptions
): void {
  activeGlobalErrorReporter.reportError(event, message, reportOptions)
}

export function installGlobalErrorReporter(
  options: InstallGlobalErrorReporterOptions = {}
): () => void {
  const target = options.target ?? window
  const report = options.report ?? reportThroughPreload
  const reporter = createGlobalErrorReporter({ report, now: options.now })
  activeGlobalErrorReporter = reporter
  const onError = (event: ErrorEvent): void => reporter.reportError(event)
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    reporter.reportUnhandledRejection(event)
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onUnhandledRejection)
  return (): void => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onUnhandledRejection)
    if (activeGlobalErrorReporter === reporter) {
      activeGlobalErrorReporter = fallbackGlobalErrorReporter
    }
  }
}
