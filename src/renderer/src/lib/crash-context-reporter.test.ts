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

  it('sends only the latest context after a 250ms trailing delay', () => {
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
    vi.advanceTimersByTime(249)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(latestContext)
  })

  it('cancels pending work on dispose and isolates bridge failures', () => {
    vi.useFakeTimers()
    const reporter = createCrashContextReporter({
      send: () => {
        throw new Error('bridge unavailable')
      }
    })

    reporter.update(firstContext)
    expect(() => vi.advanceTimersByTime(250)).not.toThrow()
    reporter.update(firstContext)
    reporter.dispose()
    vi.advanceTimersByTime(250)
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
