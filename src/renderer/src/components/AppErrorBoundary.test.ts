import { createElement } from 'react'
import type { ErrorInfo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installGlobalErrorReporter } from '../lib/global-error-reporter'
import { AppErrorBoundary } from './AppErrorBoundary'

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      createElement(AppErrorBoundary, null, createElement('div', { 'data-testid': 'child' }, 'hello'))
    )
    expect(html).toContain('hello')
    expect(html).not.toContain('appErrorTitle')
  })

  it('renders without throwing when given no children', () => {
    const result = renderToStaticMarkup(createElement(AppErrorBoundary, null, null))
    expect(typeof result).toBe('string')
  })

  it('writes render errors to the app log API when available', () => {
    const logError = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: { logError } })
    const boundary = new AppErrorBoundary({ children: null })
    const error = new Error('boom')

    boundary.componentDidCatch(error, { componentStack: '\n    at Child' } as ErrorInfo)

    expect(logError).toHaveBeenCalledWith(
      'renderer-crash',
      'Uncaught render error',
      expect.objectContaining({
        kind: 'error',
        name: 'Error',
        message: 'boom',
        stack: expect.stringContaining('at Child'),
        signature: expect.any(String)
      })
    )
  })

  it('shares global reporter deduplication with the React error boundary', () => {
    const logError = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { kunGui: { logError } })
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type)
    } as unknown as Window
    const dispose = installGlobalErrorReporter({
      target,
      report: logError,
      now: () => 1_000
    })
    const error = new Error('same render failure')
    const boundary = new AppErrorBoundary({ children: null })

    listeners.get('error')?.({ error, message: error.message } as ErrorEvent)
    boundary.componentDidCatch(error, { componentStack: '\n    at Child' } as ErrorInfo)

    expect(logError).toHaveBeenCalledTimes(1)
    dispose()
  })
})
