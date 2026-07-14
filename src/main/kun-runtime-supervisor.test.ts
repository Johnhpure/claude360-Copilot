import { describe, expect, it } from 'vitest'
import { MAX_RESTART_DELAY_MS, RestartBudget } from './kun-runtime-supervisor'

function budgetAt(times: { value: number }): RestartBudget {
  return new RestartBudget({
    windowMs: 60_000,
    maxRestarts: 3,
    baseDelayMs: 1_000,
    delayFactor: 3,
    now: () => times.value
  })
}

describe('RestartBudget', () => {
  it('allows up to maxRestarts attempts with exponential backoff delays', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)

    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    clock.value += 1_000
    expect(budget.note()).toEqual({ allowed: true, attempt: 2, delayMs: 3_000 })
    clock.value += 1_000
    expect(budget.note()).toEqual({ allowed: true, attempt: 3, delayMs: 9_000 })
  })

  it('circuit-breaks once the window is saturated', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.note()

    const verdict = budget.note()
    expect(verdict.allowed).toBe(false)
    expect(verdict.delayMs).toBe(0)
  })

  it('frees attempts as they age out of the sliding window', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.note()
    expect(budget.note().allowed).toBe(false)

    clock.value = 60_001
    const verdict = budget.note()
    expect(verdict.allowed).toBe(true)
    expect(verdict.attempt).toBe(1)
    expect(verdict.delayMs).toBe(1_000)
  })

  it('reset() clears the window so the next crash starts fresh', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.reset()

    const verdict = budget.note()
    expect(verdict).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
  })

  it('clamps restart delays to the maximum timer delay', () => {
    const budget = new RestartBudget({
      windowMs: 60_000,
      maxRestarts: 3,
      baseDelayMs: Number.MAX_SAFE_INTEGER,
      delayFactor: Number.MAX_SAFE_INTEGER,
      now: () => 0
    })

    expect(budget.note()).toEqual({
      allowed: true,
      attempt: 1,
      delayMs: MAX_RESTART_DELAY_MS
    })
  })

  it('falls back from non-finite numeric options', () => {
    const budget = new RestartBudget({
      windowMs: Number.NaN,
      maxRestarts: Number.NaN,
      baseDelayMs: Number.NaN,
      delayFactor: Number.NaN,
      now: () => 0
    })

    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
  })

  it('peek() reports window usage without recording an attempt', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)

    expect(budget.peek()).toEqual({ used: 0, exhausted: false })
    budget.note()
    budget.note()
    expect(budget.peek()).toEqual({ used: 2, exhausted: false })
    // peek 不记账：紧接着的 note() 仍是第 3 次尝试（窗口未被 peek 占用）。
    expect(budget.note()).toEqual({ allowed: true, attempt: 3, delayMs: 9_000 })
    expect(budget.peek()).toEqual({ used: 3, exhausted: true })

    // 滑出窗口后 peek 归零。
    clock.value = 60_001
    expect(budget.peek()).toEqual({ used: 0, exhausted: false })
  })
})
