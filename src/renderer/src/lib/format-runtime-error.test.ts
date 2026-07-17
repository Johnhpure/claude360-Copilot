import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { describeRuntimeError, formatRuntimeError, getRuntimeErrorCode } from './format-runtime-error'

describe('format runtime error', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('uses code fields for localized summaries and settings actions', () => {
    const error = new Error(JSON.stringify({
      code: 'runtime_offline',
      message: 'api-key=sk-test is missing',
      details: { Authorization: 'Bearer runtime-token' }
    }))

    const view = describeRuntimeError(error)

    expect(view.summary).toBe(i18n.t('common:runtimeAutoStartDisabled'))
    expect(view.code).toBe('runtime_offline')
    expect(view.settingsAction).toBe('agents')
    expect(view.detail).toContain('<redacted>')
    expect(view.detail).not.toContain('sk-test')
    expect(view.detail).not.toContain('runtime-token')
  })

  it('supports legacy error envelopes and Electron IPC prefixes', () => {
    const error = new Error(
      `Error invoking remote method 'runtime:request': Error: ${JSON.stringify({
        error: 'fetch_failed',
        message: 'fetch failed'
      })}`
    )

    expect(getRuntimeErrorCode(error)).toBe('fetch_failed')
    expect(formatRuntimeError(error)).toBe(i18n.t('common:runtimeFetchFailed'))
  })

  it('classifies upstream model request failures separately from local runtime fetch failures', () => {
    const error = new Error(JSON.stringify({
      message: 'model request failed: fetch failed',
      severity: 'error'
    }))

    expect(getRuntimeErrorCode(error)).toBe('model_request_failed')
    expect(formatRuntimeError(error)).toBe(i18n.t('common:runtimeModelRequestFailed'))
    expect(formatRuntimeError(error)).not.toBe(i18n.t('common:runtimeFetchFailed'))
  })

  it('maps classified model fetch codes to their actionable summaries', () => {
    const cases = [
      ['model_fetch_dns_failed', 'runtimeModelFetchDnsFailed'],
      ['model_fetch_connect_failed', 'runtimeModelFetchConnectFailed'],
      ['model_fetch_tls_failed', 'runtimeModelFetchTlsFailed'],
      ['model_fetch_failed', 'runtimeModelFetchFailed']
    ] as const

    for (const [code, key] of cases) {
      const message = 'model request failed: fetch failed: getaddrinfo ENOTFOUND api.example.test'
      const error = new Error(JSON.stringify({ code, message, severity: 'error' }))
      const view = describeRuntimeError(error)

      expect(getRuntimeErrorCode(error)).toBe(code)
      // The classified code must win over the "model request failed:" prefix
      // inference that serves legacy runtimes without a code.
      expect(view.summary).toBe(i18n.t(`common:${key}`))
      expect(view.summary).not.toBe(i18n.t('common:runtimeModelRequestFailed'))
      expect(view.detail).toContain(`Code: ${code}`)
      expect(view.detail).toContain(`Message:\n${message}`)
    }
  })

  it('keeps raw provider messages visible in details even when the summary is the same text', () => {
    const message = `model request failed with status 400: ${JSON.stringify({
      error: {
        code: '400',
        message: `Not supported model ${'mimo-v2.5-pro-ultraspeed'.repeat(20)}`
      }
    })}`
    const error = new Error(JSON.stringify({
      code: 'http_400',
      message,
      severity: 'error'
    }))

    const view = describeRuntimeError(error)

    expect(view.summary).toBe(message)
    expect(view.detail).toContain('Code: http_400')
    expect(view.detail).toContain('Severity: error')
    expect(view.detail).toContain(`Message:\n${message}`)
  })
})
