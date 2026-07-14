import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrailingThrottle } from './trailing-throttle'

describe('createTrailingThrottle（流式高亮节流，07-14-timeline-performance R3）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('窗口内多次 schedule 只在窗口末尾执行一次，且执行最新的函数', () => {
    const throttle = createTrailingThrottle(150)
    const runs: number[] = []
    // 模拟 typewriter 每 16ms 揭示新字符（每次 schedule 一个更大的前缀）
    for (let frame = 0; frame < 9; frame += 1) {
      throttle.schedule(() => runs.push(frame))
      vi.advanceTimersByTime(16)
    }
    // 9 帧 ≈ 144ms：第一窗口尚未到期
    expect(runs).toEqual([])
    vi.advanceTimersByTime(6) // 到达 150ms
    expect(runs).toEqual([8]) // 只执行一次，且是最新的调度
  })

  it('连续流式下有界频率：300ms 内至多两个窗口', () => {
    const throttle = createTrailingThrottle(150)
    let executions = 0
    for (let frame = 0; frame < 20; frame += 1) {
      throttle.schedule(() => {
        executions += 1
      })
      vi.advanceTimersByTime(16)
    }
    vi.advanceTimersByTime(150)
    expect(executions).toBeGreaterThanOrEqual(2)
    expect(executions).toBeLessThanOrEqual(3)
  })

  it('与纯 debounce 不同：持续调度不会饿死（保证进度）', () => {
    const throttle = createTrailingThrottle(150)
    let executions = 0
    // 每 50ms 调度一次共 1 秒 —— 纯 trailing debounce 会一直重置计时器永不执行
    for (let tick = 0; tick < 20; tick += 1) {
      throttle.schedule(() => {
        executions += 1
      })
      vi.advanceTimersByTime(50)
    }
    expect(executions).toBeGreaterThanOrEqual(6)
  })

  it('cancel 丢弃挂起工作（卸载/切换到完成态）', () => {
    const throttle = createTrailingThrottle(150)
    let executed = false
    throttle.schedule(() => {
      executed = true
    })
    throttle.cancel()
    vi.advanceTimersByTime(300)
    expect(executed).toBe(false)
  })

  it('cancel 后可重新调度', () => {
    const throttle = createTrailingThrottle(150)
    let value = ''
    throttle.schedule(() => {
      value = 'first'
    })
    throttle.cancel()
    throttle.schedule(() => {
      value = 'second'
    })
    vi.advanceTimersByTime(150)
    expect(value).toBe('second')
  })
})
