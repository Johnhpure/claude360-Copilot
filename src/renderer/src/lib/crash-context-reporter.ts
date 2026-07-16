import { useEffect } from 'react'
import type { RendererCrashContextPayload } from '@shared/crash-types'

const CRASH_CONTEXT_REPORT_DELAY_MS = 250

export interface CrashContextReporter {
  update(payload: RendererCrashContextPayload): void
  dispose(): void
}

export interface CrashContextReporterOptions {
  send: (payload: RendererCrashContextPayload) => void
  delayMs?: number
}

export function createCrashContextReporter(
  options: CrashContextReporterOptions
): CrashContextReporter {
  const delayMs = Math.max(0, options.delayMs ?? CRASH_CONTEXT_REPORT_DELAY_MS)
  let timer: ReturnType<typeof setTimeout> | null = null
  let latest: RendererCrashContextPayload | null = null
  let isDisposed = false

  return {
    update(payload) {
      if (isDisposed) return
      latest = payload
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const pending = latest
        latest = null
        if (!pending || isDisposed) return
        try {
          options.send(pending)
        } catch {
          // Diagnostic reporting must never affect the active renderer flow.
        }
      }, delayMs)
    },
    dispose() {
      isDisposed = true
      latest = null
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

export function useCrashContextReporter(payload: RendererCrashContextPayload): void {
  useEffect(() => {
    const reporter = createCrashContextReporter({
      send: (next) => {
        if (typeof window.kunGui?.reportCrashContext === 'function') {
          window.kunGui.reportCrashContext(next)
        }
      }
    })
    reporter.update(payload)
    return () => reporter.dispose()
  }, [payload])
}
