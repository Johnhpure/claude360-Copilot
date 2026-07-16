import { useEffect } from 'react'
import type { RendererCrashContextPayload } from '@shared/crash-types'
import { createTrailingThrottle } from './trailing-throttle'

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
  // Trailing throttle, NOT debounce: bursts of context changes (busy flips,
  // turn transitions) must still deliver the latest snapshot once per window.
  // A timer-resetting debounce starves exactly during the busy periods
  // crashes correlate with, leaving main holding stale context.
  const throttle = createTrailingThrottle(delayMs)
  let latest: RendererCrashContextPayload | null = null
  let isDisposed = false

  const deliver = (payload: RendererCrashContextPayload): void => {
    try {
      options.send(payload)
    } catch {
      // Diagnostic reporting must never affect the active renderer flow.
    }
  }

  return {
    update(payload) {
      if (isDisposed) return
      latest = payload
      throttle.schedule(() => {
        const pending = latest
        latest = null
        if (!pending || isDisposed) return
        deliver(pending)
      })
    },
    dispose() {
      if (isDisposed) return
      isDisposed = true
      throttle.cancel()
      // Flush instead of dropping: the payload-keyed effect below recreates
      // the reporter on every context change, and a dropped snapshot would
      // leave the main process without the context it needs if we crash now.
      const pending = latest
      latest = null
      if (pending) deliver(pending)
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
