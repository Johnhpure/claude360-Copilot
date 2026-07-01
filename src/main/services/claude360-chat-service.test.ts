// claude360-chat-service 单测（node 环境，mock fetch 返回 SSE 流）。
import { describe, it, expect, vi } from 'vitest'
import { Claude360ChatService } from './claude360-chat-service'
import { defaultClaude360Settings } from '../../shared/app-settings-claude360'

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    }
  })
  return new Response(stream, { status })
}

const settings = () => ({ ...defaultClaude360Settings(), selectedTextGroup: 'vip', baseUrl: 'https://c360.xyz' })

describe('Claude360ChatService.streamChat', () => {
  it('逐 token 回调 onDelta 并在 [DONE] 结束，使用 text 分组 Key', async () => {
    const ensureGroupKey = vi.fn(async (group: string) => `key-${group}`)
    let calledUrl = ''
    let calledInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url)
      calledInit = init
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"世界"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    }) as unknown as typeof fetch

    const service = new Claude360ChatService({ readClaude360: settings, ensureGroupKey, fetchImpl })
    const deltas: string[] = []
    await service.streamChat({
      model: 'gpt-4o',
      system: 's',
      user: 'u',
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d)
    })

    expect(deltas.join('')).toBe('你好世界')
    expect(ensureGroupKey).toHaveBeenCalledWith('vip', 'text')
    expect(calledUrl).toBe('https://c360.xyz/v1/chat/completions')
    // 请求体带 stream:true 与 system/user 消息
    const body = JSON.parse(String(calledInit?.body))
    expect(body).toMatchObject({ model: 'gpt-4o', stream: true })
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' }
    ])
    // 带 Bearer text 分组 Key
    expect((calledInit?.headers as Record<string, string>).Authorization).toBe('Bearer key-vip')
  })

  it('跨块拆分的 SSE 行也能正确拼接解析', async () => {
    const ensureGroupKey = vi.fn(async () => 'k')
    const fetchImpl = vi.fn(async () =>
      sseResponse(['data: {"choices":[{"delta":{"content":"半', '句"}}]}\n\ndata: [DONE]\n\n'])
    ) as unknown as typeof fetch
    const service = new Claude360ChatService({ readClaude360: settings, ensureGroupKey, fetchImpl })
    const deltas: string[] = []
    await service.streamChat({
      model: 'm',
      system: 's',
      user: 'u',
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d)
    })
    expect(deltas.join('')).toBe('半句')
  })

  it('HTTP 非 2xx 抛出脱敏错误', async () => {
    const ensureGroupKey = vi.fn(async () => 'k')
    const fetchImpl = vi.fn(async () => sseResponse([], 401)) as unknown as typeof fetch
    const service = new Claude360ChatService({ readClaude360: settings, ensureGroupKey, fetchImpl })
    await expect(
      service.streamChat({
        model: 'm',
        system: 's',
        user: 'u',
        signal: new AbortController().signal,
        onDelta: () => undefined
      })
    ).rejects.toThrow(/HTTP 401/)
  })
})
