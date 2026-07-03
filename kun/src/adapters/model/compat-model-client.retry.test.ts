import { describe, expect, it, vi } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Transient upstream gateway failures (502/503/504 from a load balancer) are
// momentary backend hiccups, not request errors. The client retries them a few
// times before failing the turn — see streamInner's transient-retry loop.

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

// Mirrors the real ALB 502 the user hit: HTML body, not JSON.
function gatewayError(status: number): Response {
  return new Response(
    `<html><head><title>${status}</title></head><body><center>${status}</center><center>alb</center></body></html>`,
    { status, headers: { 'content-type': 'text/html' } }
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

describe('CompatModelClient transient gateway retry', () => {
  it('retries a 502 Bad Gateway and then succeeds', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1 ? gatewayError(502) : okJson()
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(2)
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(true)
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'stop' })
    expect(chunks.some((c) => c.kind === 'error')).toBe(false)
  })

  it('does not retry a non-transient 500', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return gatewayError(500)
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request()))

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'error')).toBe(true)
  })

  it('stops retrying when the request is aborted during backoff', async () => {
    const controller = new AbortController()
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      // Abort while the (failed) response is in hand, so the backoff sees it.
      controller.abort()
      return gatewayError(503)
    }) as unknown as typeof fetch

    const chunks = await drain(client(fetchImpl).stream(request(controller.signal)))

    expect(calls).toBe(1)
    expect(chunks.some((c) => c.kind === 'error')).toBe(true)
  })

  it('maps Claude360 401 invalid-token responses to group-key guidance and logs masked diagnostics', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: 'Invalid token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    ) as unknown as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const client = new CompatModelClient({
      providerId: 'claude360-codex',
      baseUrl: 'https://claude360.xyz',
      apiKey: 'sk-claude360-real-secret-123456',
      model: 'gpt-5.5',
      endpointFormat: 'chat_completions',
      nonStreaming: true,
      fetchImpl
    })

    try {
      const chunks = await drain(client.stream({
        ...request(),
        providerId: 'claude360-codex',
        model: 'gpt-5.5'
      }))

      expect(chunks).toContainEqual({
        kind: 'error',
        message: '当前分组 Key 已失效，请重新创建。',
        code: 'claude360_key_invalid'
      })
      expect(warn).toHaveBeenCalledWith(
        '[kun:model] model HTTP request failed',
        expect.objectContaining({
          feature: 'Code',
          providerId: 'claude360-codex',
          groupName: 'codex',
          model: 'gpt-5.5',
          baseUrl: expect.stringContaining('claude360.xyz'),
          authorizationPresent: true,
          keyKind: 'complete',
          keyPreview: 'sk-c...3456',
          responseBody: expect.stringContaining('Invalid token')
        })
      )
      expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-claude360-real-secret-123456')
    } finally {
      warn.mockRestore()
    }
  })
})
