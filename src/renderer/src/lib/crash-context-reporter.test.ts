import { afterEach, describe, expect, it, vi } from 'vitest'
import AppShellSource from '../AppShell.tsx?raw'
import PreloadSource from '../../../preload/index.ts?raw'
import { createCrashContextReporter } from './crash-context-reporter'

const firstContext = {
  route: 'chat',
  workspaceRoot: '/home/alice/project-a',
  activeThreadId: 'thread-1',
  currentTurnId: 'turn-1',
  busy: false,
  task: null
}

describe('createCrashContextReporter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends only the latest context once per 250ms window', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const reporter = createCrashContextReporter({ send })
    const latestContext = {
      ...firstContext,
      workspaceRoot: '/home/alice/project-b',
      activeThreadId: 'thread-2',
      busy: true
    }

    reporter.update(firstContext)
    vi.advanceTimersByTime(200)
    reporter.update(latestContext)
    // Trailing throttle: the window opened by the FIRST update closes at
    // t=250 and delivers the latest snapshot; later updates do not push the
    // deadline out (that debounce behaviour starved delivery under bursts).
    vi.advanceTimersByTime(49)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(latestContext)
  })

  it('keeps delivering under continuous updates instead of starving', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const reporter = createCrashContextReporter({ send })

    for (let tick = 0; tick < 10; tick += 1) {
      reporter.update({ ...firstContext, activeThreadId: `thread-${tick}` })
      vi.advanceTimersByTime(100)
    }

    // Windows close at t=250/550/850 with the latest snapshot each time; a
    // timer-resetting debounce would still be waiting with zero deliveries.
    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeThreadId: 'thread-8' })
    )
  })

  it('flushes pending context on dispose and isolates bridge failures', () => {
    vi.useFakeTimers()
    const send = vi.fn(() => {
      throw new Error('bridge unavailable')
    })
    const reporter = createCrashContextReporter({ send })

    reporter.update(firstContext)
    expect(() => vi.advanceTimersByTime(250)).not.toThrow()
    expect(send).toHaveBeenCalledTimes(1)

    reporter.update(firstContext)
    expect(() => reporter.dispose()).not.toThrow()
    // dispose delivers the pending snapshot immediately: the payload-keyed
    // effect recreates the reporter on every context change, and dropping
    // the snapshot would leave main holding stale crash context.
    expect(send).toHaveBeenCalledTimes(2)

    reporter.update(firstContext)
    vi.advanceTimersByTime(250)
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('crash context wiring', () => {
  it('connects AppShell state to the preload one-way channel', () => {
    expect(AppShellSource).toContain('const crashContext = useMemo(')
    expect(AppShellSource).toContain('useCrashContextReporter(crashContext)')
    expect(AppShellSource).toContain('workspaceRoot')
    expect(AppShellSource).toContain('activeThreadId')
    expect(AppShellSource).toContain('currentTurnId')
    expect(AppShellSource).toContain('busy')
    expect(PreloadSource).toContain('reportCrashContext: (payload) =>')
    expect(PreloadSource).toContain('CRASH_CONTEXT_UPDATE_CHANNEL')
  })
})
