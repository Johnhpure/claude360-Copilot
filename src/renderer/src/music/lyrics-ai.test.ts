// lyrics-ai generateLyrics 编排单测（node 环境，mock 流式 api）。
import { describe, it, expect, vi } from 'vitest'
import type { Claude360ChatStreamStartPayload } from '@shared/kun-gui-api'
import { generateLyrics, type LyricsStreamApi } from './lyrics-ai'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('generateLyrics', () => {
  it('组装 prompt、start、逐 delta 回调并在 end 完成', async () => {
    const cbs: {
      delta?: (p: { streamId: string; delta: string }) => void
      end?: (p: { streamId: string }) => void
    } = {}
    const start = vi.fn((_p: Claude360ChatStreamStartPayload) => Promise.resolve({ streamId: 's1' }))
    const api: LyricsStreamApi = {
      claude360ChatStreamStart: start,
      claude360ChatStreamStop: vi.fn(async () => true),
      onClaude360ChatDelta: (cb) => {
        cbs.delta = cb
        return () => undefined
      },
      onClaude360ChatEnd: (cb) => {
        cbs.end = cb
        return () => undefined
      },
      onClaude360ChatError: () => () => undefined
    }

    const got: string[] = []
    let ended = false
    generateLyrics(
      api,
      { model: 'gpt-4o', theme: '城市夜晚', lang: '中文', mood: '忧郁而热烈', structure: '主歌-副歌' },
      { onDelta: (d) => got.push(d), onEnd: () => (ended = true), onError: () => undefined }
    )
    await flush()

    const payload = start.mock.calls[0][0]
    expect(payload.model).toBe('gpt-4o')
    expect(payload.user).toContain('城市夜晚')
    expect(payload.system).toContain('专业作词人')
    expect(payload.streamId).toMatch(/^lyrics_/)

    cbs.delta?.({ streamId: payload.streamId!, delta: '你好' })
    cbs.delta?.({ streamId: payload.streamId!, delta: '世界' })
    // 其它流的事件被过滤
    cbs.delta?.({ streamId: 'other', delta: 'X' })
    cbs.end?.({ streamId: payload.streamId! })

    expect(got.join('')).toBe('你好世界')
    expect(ended).toBe(true)
  })

  it('cancel 中止并调用 stop', async () => {
    const stop = vi.fn(async () => true)
    const api: LyricsStreamApi = {
      claude360ChatStreamStart: vi.fn(async () => ({ streamId: 's9' })),
      claude360ChatStreamStop: stop,
      onClaude360ChatDelta: () => () => undefined,
      onClaude360ChatEnd: () => () => undefined,
      onClaude360ChatError: () => () => undefined
    }
    const handle = generateLyrics(
      api,
      { model: 'm', theme: 't', lang: '中文', mood: 'm', structure: 's' },
      { onDelta: () => undefined, onEnd: () => undefined, onError: () => undefined }
    )
    await flush()
    handle.cancel()
    const payload = (api.claude360ChatStreamStart as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(stop).toHaveBeenCalledWith(payload.streamId)
  })

  it('先注册监听再 start，避免快速 delta/end 丢失', async () => {
    const cbs: {
      delta?: (p: { streamId: string; delta: string }) => void
      end?: (p: { streamId: string }) => void
    } = {}
    const start = vi.fn(async (p: Claude360ChatStreamStartPayload) => {
      expect(p.streamId).toMatch(/^lyrics_/)
      cbs.delta?.({ streamId: p.streamId!, delta: '首句' })
      cbs.end?.({ streamId: p.streamId! })
      return { streamId: p.streamId! }
    })
    const api: LyricsStreamApi = {
      claude360ChatStreamStart: start,
      claude360ChatStreamStop: vi.fn(async () => true),
      onClaude360ChatDelta: (cb) => {
        cbs.delta = cb
        return () => undefined
      },
      onClaude360ChatEnd: (cb) => {
        cbs.end = cb
        return () => undefined
      },
      onClaude360ChatError: () => () => undefined
    }

    const got: string[] = []
    let ended = false
    generateLyrics(
      api,
      { model: 'm', theme: 't', lang: '中文', mood: 'm', structure: 's' },
      { onDelta: (d) => got.push(d), onEnd: () => (ended = true), onError: () => undefined }
    )
    await flush()

    expect(got.join('')).toBe('首句')
    expect(ended).toBe(true)
  })

  it('start 失败走 onError', async () => {
    const api: LyricsStreamApi = {
      claude360ChatStreamStart: vi.fn(async () => {
        throw new Error('boom')
      }),
      claude360ChatStreamStop: vi.fn(async () => true),
      onClaude360ChatDelta: () => () => undefined,
      onClaude360ChatEnd: () => () => undefined,
      onClaude360ChatError: () => () => undefined
    }
    let err = ''
    generateLyrics(
      api,
      { model: 'm', theme: 't', lang: '中文', mood: 'm', structure: 's' },
      { onDelta: () => undefined, onEnd: () => undefined, onError: (m) => (err = m) }
    )
    await flush()
    expect(err).toBe('boom')
  })
})
