import { describe, expect, it, vi } from 'vitest'
import MainSource from '../main.tsx?raw'
import { createGlobalErrorReporter } from './global-error-reporter'

describe('createGlobalErrorReporter', () => {
  it('normalizes window errors and rejected non-Error values', () => {
    const report = vi.fn()
    const reporter = createGlobalErrorReporter({ report, now: () => 1_000 })
    const error = new Error('renderer boom')

    reporter.reportError({
      message: 'renderer boom',
      error,
      filename: 'app.js',
      lineno: 12,
      colno: 34
    })
    reporter.reportUnhandledRejection({ reason: 'plain rejection' })

    expect(report).toHaveBeenNthCalledWith(
      1,
      'renderer-crash',
      'Unhandled renderer error',
      expect.objectContaining({
        kind: 'error',
        name: 'Error',
        message: 'renderer boom',
        stack: error.stack,
        source: 'app.js',
        line: 12,
        column: 34,
        signature: expect.any(String)
      })
    )
    expect(report).toHaveBeenNthCalledWith(
      2,
      'renderer-crash',
      'Unhandled renderer rejection',
      expect.objectContaining({
        kind: 'unhandledrejection',
        name: 'Error',
        message: 'plain rejection',
        signature: expect.any(String)
      })
    )
  })

  it('reports the same signature at most once per 60 seconds', () => {
    let clock = 1_000
    const report = vi.fn()
    const reporter = createGlobalErrorReporter({ report, now: () => clock })

    reporter.reportError({ message: 'same failure' })
    clock += 59_999
    reporter.reportError({ message: 'same failure' })
    clock += 1
    reporter.reportError({ message: 'same failure' })

    expect(report).toHaveBeenCalledTimes(2)
  })

  it('evicts the least-recently-reported signature when the cache is full', () => {
    const report = vi.fn()
    const reporter = createGlobalErrorReporter({
      report,
      now: () => 1_000,
      maxSignatures: 2
    })

    reporter.reportError({ message: 'failure-a' })
    reporter.reportError({ message: 'failure-b' })
    reporter.reportError({ message: 'failure-c' })
    reporter.reportError({ message: 'failure-a' })

    expect(report).toHaveBeenCalledTimes(4)
  })

  it('never throws when the logging bridge throws or rejects', async () => {
    const throwing = createGlobalErrorReporter({
      report: () => {
        throw new Error('bridge unavailable')
      }
    })
    const rejecting = createGlobalErrorReporter({
      report: () => Promise.reject(new Error('bridge unavailable'))
    })

    expect(() => throwing.reportError({ message: 'boom' })).not.toThrow()
    expect(() => rejecting.reportUnhandledRejection({ reason: 'boom' })).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('drops malformed source coordinates instead of throwing inside the reporter', () => {
    const report = vi.fn()
    const reporter = createGlobalErrorReporter({ report })

    expect(() => reporter.reportError({
      message: 'bad coordinates',
      lineno: 1.5,
      colno: Number.POSITIVE_INFINITY
    })).not.toThrow()
    expect(report).toHaveBeenCalledWith(
      'renderer-crash',
      'Unhandled renderer error',
      expect.not.objectContaining({ line: expect.anything(), column: expect.anything() })
    )
  })
})

describe('renderer entry wiring', () => {
  it('installs the global reporter before mounting React', () => {
    const install = MainSource.indexOf('installGlobalErrorReporter()')
    const mount = MainSource.indexOf('ReactDOM.createRoot')

    expect(install).toBeGreaterThan(-1)
    expect(mount).toBeGreaterThan(install)
  })
})
