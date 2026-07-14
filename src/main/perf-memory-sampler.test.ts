import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMemorySampler, type MemorySampleSnapshot } from './perf-memory-sampler'

function snapshot(): MemorySampleSnapshot {
  return {
    mainRssBytes: 123_456,
    processes: [
      { type: 'Browser', pid: 100, workingSetKb: 2_048 },
      { type: 'Tab', pid: 101, workingSetKb: 4_096 }
    ]
  }
}

describe('startMemorySampler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('waits out the initial delay, then samples on the configured cadence', () => {
    const lines: string[] = []
    const sampler = startMemorySampler({
      intervalMs: 1_000,
      initialDelayMs: 500,
      log: (message) => lines.push(message),
      getMetrics: snapshot
    })

    vi.advanceTimersByTime(499)
    expect(lines).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('memory sample')
    expect(lines[0]).toContain('"mainRssBytes":123456')
    expect(lines[0]).toContain('"workingSetKb":4096')

    vi.advanceTimersByTime(2_000)
    expect(lines).toHaveLength(3)

    sampler.stop()
    vi.advanceTimersByTime(10_000)
    expect(lines).toHaveLength(3)
  })

  it('stop before the first sample cancels everything', () => {
    const lines: string[] = []
    const sampler = startMemorySampler({
      intervalMs: 1_000,
      initialDelayMs: 500,
      log: (message) => lines.push(message),
      getMetrics: snapshot
    })

    sampler.stop()
    vi.advanceTimersByTime(60_000)
    expect(lines).toHaveLength(0)
  })

  it('keeps sampling after getMetrics throws once', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lines: string[] = []
    let calls = 0
    startMemorySampler({
      intervalMs: 1_000,
      initialDelayMs: 0,
      log: (message) => lines.push(message),
      getMetrics: () => {
        calls += 1
        if (calls === 1) throw new Error('metrics unavailable')
        return snapshot()
      }
    })

    vi.advanceTimersByTime(0)
    expect(lines).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1_000)
    expect(lines).toHaveLength(1)
  })

  it('defaults the initial delay to 60s', () => {
    const lines: string[] = []
    startMemorySampler({
      intervalMs: 1_000,
      log: (message) => lines.push(message),
      getMetrics: snapshot
    })

    vi.advanceTimersByTime(59_999)
    expect(lines).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(lines).toHaveLength(1)
  })
})
