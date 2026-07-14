import { describe, expect, it } from 'vitest'
import {
  nextTypewriterDirectMode,
  nextVisibleLength,
  TYPEWRITER_MAX_CHARS
} from './StreamdownAssistant'

describe('nextVisibleLength', () => {
  it('stays put when caught up', () => {
    expect(nextVisibleLength(120, 120)).toBe(120)
  })

  it('snaps down instantly when the live text resets', () => {
    expect(nextVisibleLength(120, 40)).toBe(40)
    expect(nextVisibleLength(120, 0)).toBe(0)
  })

  it('advances at least one char per frame on a small backlog', () => {
    expect(nextVisibleLength(100, 101)).toBe(101)
    expect(nextVisibleLength(100, 104)).toBe(101)
  })

  it('accelerates with backlog but caps the per-frame step so bursts stay readable', () => {
    expect(nextVisibleLength(0, 80)).toBe(10)
    expect(nextVisibleLength(0, 100_000)).toBe(32)
  })

  it('never overshoots the target', () => {
    let current = 0
    const target = 1234
    for (let i = 0; i < 10_000 && current < target; i += 1) {
      current = nextVisibleLength(current, target)
      expect(current).toBeLessThanOrEqual(target)
    }
    expect(current).toBe(target)
  })
})

describe('nextTypewriterDirectMode（超长直更，07-14-timeline-performance R4/AC4）', () => {
  it('threshold is 32k chars', () => {
    expect(TYPEWRITER_MAX_CHARS).toBe(32_000)
  })

  it('stays in per-frame typewriter mode below the threshold（阈值内路径零改动）', () => {
    expect(nextTypewriterDirectMode(0, 100, false)).toBe(false)
    expect(nextTypewriterDirectMode(100, TYPEWRITER_MAX_CHARS, false)).toBe(false)
  })

  it('switches to direct rendering when the growing reply crosses the threshold', () => {
    expect(nextTypewriterDirectMode(TYPEWRITER_MAX_CHARS, TYPEWRITER_MAX_CHARS + 1, false)).toBe(
      true
    )
  })

  it('is one-way while the reply keeps growing（不回退防抖动）', () => {
    let direct = false
    let length = TYPEWRITER_MAX_CHARS - 10
    for (let batch = 0; batch < 10; batch += 1) {
      const next = length + 5_000
      direct = nextTypewriterDirectMode(length, next, direct)
      length = next
    }
    expect(direct).toBe(true)
    // 继续增长仍保持直更
    expect(nextTypewriterDirectMode(length, length + 1, direct)).toBe(true)
  })

  it('re-arms the typewriter when live text resets for a new turn', () => {
    // 上一回复超长（direct=true），新 turn 的 live 文本从 0 重新增长
    expect(nextTypewriterDirectMode(80_000, 0, true)).toBe(false)
    expect(nextTypewriterDirectMode(80_000, 120, true)).toBe(false)
  })

  it('a reset that itself exceeds the threshold (thread resume) starts direct', () => {
    expect(nextTypewriterDirectMode(200_000, 50_000, true)).toBe(true)
  })
})
