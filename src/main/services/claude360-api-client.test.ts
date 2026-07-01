import { describe, expect, it, vi } from 'vitest'
import {
  Claude360ApiClient,
  sanitizeClaude360Message
} from './claude360-api-client'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response
}

describe('Claude360ApiClient', () => {
  it('returns data from a success envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { hello: 'world' } }))
    const client = new Claude360ApiClient({ baseUrl: 'https://x.test', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await client.get('/api/cli/me')).toEqual({ hello: 'world' })
  })

  it('strips trailing slash and sets bearer auth + json content-type', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: 1 }))
    const client = new Claude360ApiClient({ baseUrl: 'https://x.test/', fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.post('/api/cli/auth/password', { username: 'a' }, 'tok-123')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://x.test/api/cli/auth/password')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ username: 'a' }))
  })

  it('throws a typed error from a failure envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, message: '密码错误' }))
    const client = new Claude360ApiClient({ baseUrl: 'https://x.test', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.get('/x')).rejects.toMatchObject({ name: 'Claude360ApiError', message: '密码错误' })
  })

  it('maps HTTP errors without envelope to a displayable error carrying the status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse('nope', 401))
    const client = new Claude360ApiClient({ baseUrl: 'https://x.test', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 })
  })

  it('converts network failures into a neutral message (no url/header leak)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 1.2.3.4:443')
    })
    const client = new Claude360ApiClient({ baseUrl: 'https://x.test', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.get('/x')).rejects.toThrow('网络请求失败，请检查网络连接')
  })

  it('sanitizes sensitive substrings in messages', () => {
    expect(sanitizeClaude360Message('failed Bearer sk-abc123 token=xyz password=hunter2')).toBe(
      'failed Bearer [redacted] token=[redacted] password=[redacted]'
    )
  })

  it('sanitizes backend failure messages that leak credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, message: 'bad token=secretvalue' }))
    const client = new Claude360ApiClient({ baseUrl: 'https://x.test', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.get('/x')).rejects.toThrow('bad token=[redacted]')
  })
})
