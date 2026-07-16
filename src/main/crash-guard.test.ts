import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CrashRecordV1 } from '../shared/crash-types'
import {
  createMainCrashHandlers,
  initializeLocalCrashReporter,
  installMainCrashGuard
} from './crash-guard'

const testDirectories: string[] = []

function makeUserDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude360-crash-guard-'))
  testDirectories.push(directory)
  return directory
}

function record(kind: CrashRecordV1['kind'], severity: CrashRecordV1['severity']): CrashRecordV1 {
  return {
    schemaVersion: 1,
    id: `${kind}-1`,
    kind,
    severity,
    occurredAt: '2026-07-15T08:00:00.000Z',
    process: { pid: 123, type: 'browser', uptimeMs: 1_000 },
    versions: { app: '0.1.0', electron: '34.2.0', node: '22.14.0' },
    system: { platform: 'linux', arch: 'x64', packaged: false },
    memory: { rss: 1, heapUsed: 2, heapTotal: 3, external: 4 },
    error: { name: 'Error', message: 'redacted failure' },
    context: { startupPhases: {}, runtime: null, renderer: null, recentIpc: [] }
  }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('initializeLocalCrashReporter', () => {
  it('creates the native dump directory before configuring and starting local mode', () => {
    const userDataPath = makeUserDataDirectory()
    const calls: string[] = []
    const setCrashDumpsPath = vi.fn((path: string) => {
      expect(existsSync(path)).toBe(true)
      calls.push('set-path')
    })
    const startCrashReporter = vi.fn((options: { uploadToServer: boolean; compress: boolean }) => {
      calls.push('start')
      expect(options).toEqual({ uploadToServer: false, compress: false })
    })

    const result = initializeLocalCrashReporter({
      userDataPath,
      setCrashDumpsPath,
      startCrashReporter
    })

    expect(result.crashDirectory).toBe(join(userDataPath, 'logs', 'crash'))
    expect(result.nativeDirectory).toBe(join(userDataPath, 'logs', 'crash', 'native'))
    expect(result.pathConfigured).toBe(true)
    expect(result.reporterStarted).toBe(true)
    expect(calls).toEqual(['set-path', 'start'])
  })
})

describe('main crash handlers', () => {
  it('writes an uncaught exception synchronously before exiting with code 1', () => {
    const calls: string[] = []
    const createRecord = vi.fn(() => record('uncaught-exception', 'fatal'))
    const handlers = createMainCrashHandlers({
      createRecord,
      writeFatal: () => {
        calls.push('write')
        return 'crash.json'
      },
      enqueue: async () => 'crash.json',
      exit: (code) => {
        calls.push(`exit:${code}`)
      },
      writeStderr: () => calls.push('stderr')
    })

    handlers.uncaughtException(new Error('boom'))

    expect(createRecord).toHaveBeenCalledWith({
      kind: 'uncaught-exception',
      severity: 'fatal',
      error: expect.any(Error)
    })
    expect(calls.indexOf('write')).toBeLessThan(calls.indexOf('exit:1'))
    expect(calls.at(-1)).toBe('exit:1')
  })

  it('still exits when fatal record creation or writing fails', () => {
    const exit = vi.fn()
    const handlers = createMainCrashHandlers({
      createRecord: () => record('uncaught-exception', 'fatal'),
      writeFatal: () => {
        throw new Error('disk unavailable')
      },
      enqueue: async () => 'crash.json',
      exit,
      writeStderr: vi.fn()
    })

    handlers.uncaughtException(new Error('boom'))

    expect(exit).toHaveBeenCalledWith(1)
  })

  it('does not recursively create another record when the fatal path re-enters', () => {
    const createRecord = vi.fn(() => record('uncaught-exception', 'fatal'))
    const exit = vi.fn()
    let handlers: ReturnType<typeof createMainCrashHandlers>
    const writeFatal = vi.fn(() => {
      handlers.uncaughtException(new Error('nested failure'))
      return 'crash.json'
    })
    handlers = createMainCrashHandlers({
      createRecord,
      writeFatal,
      enqueue: async () => 'crash.json',
      exit,
      writeStderr: vi.fn()
    })

    handlers.uncaughtException(new Error('first failure'))

    expect(createRecord).toHaveBeenCalledTimes(1)
    expect(writeFatal).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('records an unhandled rejection without exiting the process', async () => {
    const enqueue = vi.fn(async () => 'crash.json')
    const exit = vi.fn()
    const createRecord = vi.fn(() => record('unhandled-rejection', 'error'))
    const handlers = createMainCrashHandlers({
      createRecord,
      writeFatal: () => 'crash.json',
      enqueue,
      exit,
      writeStderr: vi.fn()
    })

    handlers.unhandledRejection('promise failed')
    await Promise.resolve()

    expect(createRecord).toHaveBeenCalledWith({
      kind: 'unhandled-rejection',
      severity: 'error',
      error: 'promise failed'
    })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it('ignores clean renderer exits and records abnormal process loss', async () => {
    const enqueue = vi.fn(async () => 'crash.json')
    const createRecord = vi.fn((input) => record(input.kind, input.severity))
    const handlers = createMainCrashHandlers({
      createRecord,
      writeFatal: () => 'crash.json',
      enqueue,
      exit: vi.fn(),
      writeStderr: vi.fn()
    })

    handlers.renderProcessGone({ reason: 'clean-exit', exitCode: 0 })
    handlers.renderProcessGone({ reason: 'oom', exitCode: 137 })
    handlers.childProcessGone({ type: 'GPU', reason: 'crashed', exitCode: 1 })
    await Promise.resolve()

    expect(createRecord).toHaveBeenCalledTimes(2)
    expect(createRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'render-process-gone',
        severity: 'error',
        details: { reason: 'oom', exitCode: 137 }
      })
    )
    expect(createRecord).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'child-process-gone',
        severity: 'error',
        details: { type: 'GPU', reason: 'crashed', exitCode: 1 }
      })
    )
    expect(enqueue).toHaveBeenCalledTimes(2)
  })
})

describe('installMainCrashGuard', () => {
  it('routes process and Electron process-loss events and removes every listener', () => {
    const processEvents = new EventEmitter()
    const appEvents = new EventEmitter()
    const handlers = {
      uncaughtException: vi.fn(),
      unhandledRejection: vi.fn(),
      renderProcessGone: vi.fn(),
      childProcessGone: vi.fn()
    }
    const dispose = installMainCrashGuard({
      processTarget: processEvents as unknown as NodeJS.Process,
      app: appEvents as unknown as Electron.App,
      handlers
    })
    const uncaught = new Error('boom')

    processEvents.emit('uncaughtException', uncaught)
    processEvents.emit('unhandledRejection', 'rejected', Promise.resolve())
    appEvents.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: 137 })
    appEvents.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 })

    expect(handlers.uncaughtException).toHaveBeenCalledWith(uncaught)
    expect(handlers.unhandledRejection).toHaveBeenCalledWith('rejected')
    expect(handlers.renderProcessGone).toHaveBeenCalledWith({ reason: 'oom', exitCode: 137 })
    expect(handlers.childProcessGone).toHaveBeenCalledWith({
      type: 'GPU',
      reason: 'crashed',
      exitCode: 1
    })

    dispose()
    processEvents.emit('unhandledRejection', 'after-dispose', Promise.resolve())
    expect(handlers.unhandledRejection).toHaveBeenCalledTimes(1)
  })
})
