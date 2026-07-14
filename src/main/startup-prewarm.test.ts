import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrewarmTrigger } from './startup-prewarm'

describe('createPrewarmTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires prewarm via setImmediate after ready-to-show, before the fallback', () => {
    const prewarm = vi.fn()
    let readyListener: (() => void) | undefined
    createPrewarmTrigger({
      prewarm,
      registerReadyToShow: (listener) => {
        readyListener = listener
      },
      fallbackMs: 3000
    })

    expect(prewarm).not.toHaveBeenCalled()
    readyListener?.()
    // ready-to-show 同步回调只排队（setImmediate），当前 tick 不执行。
    expect(prewarm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(prewarm).toHaveBeenCalledTimes(1)

    // 兜底定时器到点后不重复发起（幂等）。
    vi.advanceTimersByTime(3000)
    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('fires prewarm from the fallback timer when ready-to-show never arrives', () => {
    const prewarm = vi.fn()
    createPrewarmTrigger({
      prewarm,
      registerReadyToShow: () => {
        /* window never becomes ready */
      },
      fallbackMs: 3000
    })

    vi.advanceTimersByTime(2999)
    expect(prewarm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('is idempotent across duplicate ready-to-show events, manual fire and fallback', () => {
    const prewarm = vi.fn()
    let readyListener: (() => void) | undefined
    const trigger = createPrewarmTrigger({
      prewarm,
      registerReadyToShow: (listener) => {
        readyListener = listener
      },
      fallbackMs: 3000
    })

    readyListener?.()
    readyListener?.()
    trigger.fire()
    expect(prewarm).toHaveBeenCalledTimes(1)
    expect(trigger.hasFired()).toBe(true)

    vi.runAllTimers()
    expect(prewarm).toHaveBeenCalledTimes(1)
  })
})
