import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Transport-layer fetch failures: undici reports them all as a bare
// `TypeError: fetch failed` with the actionable errno buried in `cause`.
// The client unwraps + classifies them, and retries only the
// connection-establishment class — those provably never reached the server,
// so re-POSTing cannot duplicate work. See streamInner's transient-retry loop.

function request(signal?: AbortSignal): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model: 'glm-5.1',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: signal ?? new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function okJson(): Response {
  return new Response(
    JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { content: 'ok' } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function client(fetchImpl: typeof fetch): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://provider.example/v1',
    apiKey: 'sk-test',
    model: 'glm-5.1',
    endpointFormat: 'chat_completions',
    nonStreaming: true,
    fetchImpl
  })
}

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe('CompatModelClient transport fetch failures', () => {
  it('retries DNS failures until the budget is exhausted and yields a classified error', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      throw new TypeError('fetch failed', {
        cause: withCode('getaddrinfo ENOTFOUND api.example.test', 'ENOTFOUND')
      })
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    // 1 initial request + MAX_TRANSIENT_RETRIES re-POSTs.
    expect(calls).toBe(3)
    expect(chunks).toEqual([
      {
        kind: 'error',
        message: 'model request failed: fetch failed: getaddrinfo ENOTFOUND api.example.test',
        code: 'model_fetch_dns_failed'
      }
    ])
  })

  it('retries refused connections reported through AggregateError', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      throw new TypeError('fetch failed', {
        cause: new AggregateError([withCode('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED')], '')
      })
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(3)
    const error = chunks.find((c) => c.kind === 'error')
    expect(error).toMatchObject({ kind: 'error', code: 'model_fetch_connect_failed' })
    expect(error?.kind === 'error' && error.message).toContain('ECONNREFUSED')
  })

  it('recovers without surfacing an error when the network heals within the retry window', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls < 3) {
        throw new TypeError('fetch failed', {
          cause: withCode('connect ETIMEDOUT 203.0.113.7:443', 'ETIMEDOUT')
        })
      }
      return okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(3)
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
  })

  it('fails fast on TLS certificate failures without retrying', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      throw new TypeError('fetch failed', {
        cause: withCode('self-signed certificate in certificate chain', 'SELF_SIGNED_CERT_IN_CHAIN')
      })
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(1)
    expect(chunks).toEqual([
      {
        kind: 'error',
        message:
          'model request failed: fetch failed: self-signed certificate in certificate chain (SELF_SIGNED_CERT_IN_CHAIN)',
        code: 'model_fetch_tls_failed'
      }
    ])
  })

  it('fails fast on connection resets that may have already delivered the request', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      throw new TypeError('fetch failed', { cause: withCode('read ECONNRESET', 'ECONNRESET') })
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(1)
    expect(chunks).toEqual([
      {
        kind: 'error',
        message: 'model request failed: fetch failed: read ECONNRESET',
        code: 'model_fetch_failed'
      }
    ])
  })
})
