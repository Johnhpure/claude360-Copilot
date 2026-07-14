/**
 * Trailing-edge throttle for streaming work (07-14-timeline-performance R3).
 *
 * Unlike a classic debounce (which resets its timer on every call and would
 * starve forever under a continuous 60Hz stream), this fires at most once per
 * `delayMs` window and always runs the LATEST scheduled function at the end
 * of the window — bounded frequency with guaranteed progress.
 */
export type TrailingThrottle = {
  /** Replaces any pending work; starts a window if none is open. */
  schedule: (fn: () => void) => void
  /** Drops pending work and closes the window (unmount / mode switch). */
  cancel: () => void
}

export function createTrailingThrottle(delayMs: number): TrailingThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: (() => void) | null = null

  return {
    schedule(fn: () => void): void {
      pending = fn
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        const run = pending
        pending = null
        run?.()
      }, delayMs)
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
