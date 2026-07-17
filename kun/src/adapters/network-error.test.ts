import { describe, expect, it } from 'vitest'
import { classifyModelFetchError, describeNetworkError } from './network-error.js'

// The describeNetworkError expansion itself is covered by
// image-gen-network-error.test.ts (which consumes the re-export). These tests
// pin the errno -> classification matrix used by the model client.

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('classifyModelFetchError', () => {
  it('classifies DNS resolution failures as retriable', () => {
    const wrapped = new TypeError('fetch failed', {
      cause: withCode('getaddrinfo ENOTFOUND api.example.test', 'ENOTFOUND')
    })
    expect(classifyModelFetchError(wrapped)).toEqual({
      code: 'model_fetch_dns_failed',
      detail: 'fetch failed: getaddrinfo ENOTFOUND api.example.test',
      retriable: true
    })
    expect(classifyModelFetchError(wrapped).detail).toBe(describeNetworkError(wrapped))
  })

  it('classifies EAI_AGAIN as a retriable DNS failure', () => {
    const wrapped = new TypeError('fetch failed', {
      cause: withCode('getaddrinfo EAI_AGAIN api.example.test', 'EAI_AGAIN')
    })
    expect(classifyModelFetchError(wrapped)).toMatchObject({
      code: 'model_fetch_dns_failed',
      retriable: true
    })
  })

  it('classifies refused connections inside AggregateError as retriable connect failures', () => {
    const refused = withCode('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED')
    const unreachable = withCode('connect ENETUNREACH ::1:443', 'ENETUNREACH')
    const wrapped = new TypeError('fetch failed', {
      cause: new AggregateError([refused, unreachable], '')
    })
    const result = classifyModelFetchError(wrapped)
    expect(result.code).toBe('model_fetch_connect_failed')
    expect(result.retriable).toBe(true)
    expect(result.detail).toContain('ECONNREFUSED')
  })

  it('classifies connect timeouts (errno and undici) as retriable connect failures', () => {
    const etimedout = new TypeError('fetch failed', {
      cause: withCode('connect ETIMEDOUT 203.0.113.7:443', 'ETIMEDOUT')
    })
    expect(classifyModelFetchError(etimedout)).toMatchObject({
      code: 'model_fetch_connect_failed',
      retriable: true
    })
    const undiciTimeout = new TypeError('fetch failed', {
      cause: withCode(
        'Connect Timeout Error (attempted address: api.example.test:443, timeout: 10000ms)',
        'UND_ERR_CONNECT_TIMEOUT'
      )
    })
    expect(classifyModelFetchError(undiciTimeout)).toMatchObject({
      code: 'model_fetch_connect_failed',
      retriable: true
    })
  })

  it('classifies certificate failures as non-retriable TLS errors', () => {
    const codes = [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'CERT_HAS_EXPIRED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'EPROTO'
    ]
    for (const code of codes) {
      const wrapped = new TypeError('fetch failed', { cause: withCode('handshake failed', code) })
      expect(classifyModelFetchError(wrapped)).toMatchObject({
        code: 'model_fetch_tls_failed',
        retriable: false
      })
    }
  })

  it('falls back to a non-retriable generic classification for resets and unknown failures', () => {
    const reset = new TypeError('fetch failed', { cause: withCode('read ECONNRESET', 'ECONNRESET') })
    expect(classifyModelFetchError(reset)).toEqual({
      code: 'model_fetch_failed',
      detail: 'fetch failed: read ECONNRESET',
      retriable: false
    })
    const socket = new TypeError('fetch failed', { cause: withCode('other side closed', 'UND_ERR_SOCKET') })
    expect(classifyModelFetchError(socket)).toMatchObject({ code: 'model_fetch_failed', retriable: false })
    const headersTimeout = new TypeError('fetch failed', {
      cause: withCode('Headers Timeout Error', 'UND_ERR_HEADERS_TIMEOUT')
    })
    expect(classifyModelFetchError(headersTimeout)).toMatchObject({ code: 'model_fetch_failed', retriable: false })
    expect(classifyModelFetchError(new Error('boom'))).toMatchObject({ code: 'model_fetch_failed', retriable: false })
    expect(classifyModelFetchError('boom')).toMatchObject({ code: 'model_fetch_failed', retriable: false })
  })

  it('matches codes case-insensitively and deep in the cause chain', () => {
    const deep = new Error('outer', {
      cause: new Error('middle', { cause: withCode('getaddrinfo failure', 'enotfound') })
    })
    expect(classifyModelFetchError(deep)).toMatchObject({
      code: 'model_fetch_dns_failed',
      retriable: true
    })
  })

  it('does not misread ECONNRESET as a refused connection', () => {
    const reset = new TypeError('fetch failed', { cause: withCode('read ECONNRESET', 'ECONNRESET') })
    expect(classifyModelFetchError(reset).code).not.toBe('model_fetch_connect_failed')
  })
})
