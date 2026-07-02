// 音乐工作台纯编排函数测试（Task 6）。
// 覆盖：提交（参数来自 suno-params + mock claude360MusicSubmit + 任务新增）、
// 轮询、下载。全部 node 环境，无 jsdom。
import { describe, it, expect, vi } from 'vitest'
import type {
  Claude360MusicCreateForm,
  Claude360MusicFetchResult,
  Claude360MusicFetchedTask,
  Claude360MusicSubmitPayload,
  Claude360MusicSubmitResult
} from '@shared/claude360-music'
import { emptyForm } from './suno-params'
import {
  submitMusic,
  pollActiveTasksOnce,
  downloadSong,
  isSafeHttpUrl,
  playSongOnAudioElement,
  safeSongFilename
} from './music-workbench-actions'

function storeMock() {
  return {
    addSubmitting: vi.fn((_tempId: string, _title: string, _params: Claude360MusicSubmitPayload): void => undefined),
    markSubmitted: vi.fn((_tempId: string, _taskId: string): void => undefined),
    markFailed: vi.fn((_id: string, _message: string): void => undefined),
    applyFetched: vi.fn((_results: Claude360MusicFetchedTask[]): void => undefined)
  }
}

const simpleForm = (): Claude360MusicCreateForm => ({ ...emptyForm(), mode: 'oneshot', description: '城市夜晚电子乐' })

describe('submitMusic', () => {
  it('提交成功：payload 来自 suno-params，新增任务并 markSubmitted', async () => {
    const store = storeMock()
    let received: Claude360MusicSubmitPayload | null = null
    const claude360MusicSubmit = vi.fn(async (p: Claude360MusicSubmitPayload): Promise<Claude360MusicSubmitResult> => {
      received = p
      return { ok: true, taskId: 'task-1' }
    })
    const result = await submitMusic({ claude360MusicSubmit }, store, simpleForm())
    expect(result).toEqual({ ok: true, taskId: 'task-1' })
    // 参数确实来自 suno-params 构造
    expect(received).toMatchObject({ prompt: '城市夜晚电子乐', model: 'V5_5', custom_mode: false })
    expect(store.addSubmitting).toHaveBeenCalledTimes(1)
    expect(store.markSubmitted).toHaveBeenCalledWith(expect.any(String), 'task-1')
    expect(store.markFailed).not.toHaveBeenCalled()
  })

  it('表单非法：不调用 submit，直接返回错误', async () => {
    const store = storeMock()
    const claude360MusicSubmit = vi.fn()
    const result = await submitMusic({ claude360MusicSubmit }, store, { ...emptyForm(), mode: 'oneshot', description: '' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('请填写一句话描述')
    expect(claude360MusicSubmit).not.toHaveBeenCalled()
    expect(store.addSubmitting).not.toHaveBeenCalled()
  })

  it('main 返回失败：markFailed 保留错误', async () => {
    const store = storeMock()
    const claude360MusicSubmit = vi.fn(async (): Promise<Claude360MusicSubmitResult> => ({ ok: false, message: '余额不足' }))
    const result = await submitMusic({ claude360MusicSubmit }, store, simpleForm())
    expect(result.ok).toBe(false)
    expect(store.markFailed).toHaveBeenCalledWith(expect.any(String), '余额不足')
  })

  it('抛异常：捕获并 markFailed', async () => {
    const store = storeMock()
    const claude360MusicSubmit = vi.fn(async () => {
      throw new Error('boom')
    })
    const result = await submitMusic({ claude360MusicSubmit }, store, simpleForm())
    expect(result.ok).toBe(false)
    expect(store.markFailed).toHaveBeenCalledWith(expect.any(String), 'boom')
  })
})

describe('pollActiveTasksOnce', () => {
  it('拿到结果后调用 applyFetched', async () => {
    const store = storeMock()
    const claude360MusicFetch = vi.fn(async (taskId: string): Promise<Claude360MusicFetchResult> => ({
      ok: true,
      task: { taskId, status: 'success', songs: [] }
    }))
    await pollActiveTasksOnce({ claude360MusicFetch }, store, ['t1', 't2'])
    expect(claude360MusicFetch).toHaveBeenCalledTimes(2)
    expect(store.applyFetched).toHaveBeenCalledTimes(1)
    expect(store.applyFetched.mock.calls[0][0]).toHaveLength(2)
  })

  it('空 id 列表不调用 fetch/applyFetched', async () => {
    const store = storeMock()
    const claude360MusicFetch = vi.fn()
    await pollActiveTasksOnce({ claude360MusicFetch }, store, [])
    expect(claude360MusicFetch).not.toHaveBeenCalled()
    expect(store.applyFetched).not.toHaveBeenCalled()
  })

  it('全部网络错误：不调用 applyFetched（不误累加 miss）', async () => {
    const store = storeMock()
    const claude360MusicFetch = vi.fn(async () => {
      throw new Error('network')
    })
    await pollActiveTasksOnce({ claude360MusicFetch }, store, ['t1'])
    expect(store.applyFetched).not.toHaveBeenCalled()
  })
})

describe('downloadSong', () => {
  const deps = () => ({
    fetch: vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }) as unknown as Response),
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
    triggerDownload: vi.fn(),
    openFallback: vi.fn()
  })
  it('非法链接直接拒绝', async () => {
    const d = deps()
    await expect(downloadSong('javascript:alert(1)', 't', d)).resolves.toBe('invalid')
    expect(d.fetch).not.toHaveBeenCalled()
  })
  it('http(s) 成功 → blob 下载', async () => {
    const d = deps()
    await expect(downloadSong('https://cdn/x.mp3', '我的歌', d)).resolves.toBe('blob')
    expect(d.triggerDownload).toHaveBeenCalledWith('blob:x', '我的歌.mp3')
  })
  it('抓取失败 → fallback 新标签打开', async () => {
    const d = deps()
    d.fetch.mockRejectedValueOnce(new Error('net'))
    await expect(downloadSong('https://cdn/x.mp3', 't', d)).resolves.toBe('fallback')
    expect(d.openFallback).toHaveBeenCalledWith('https://cdn/x.mp3')
  })
  it('isSafeHttpUrl / safeSongFilename 行为', () => {
    expect(isSafeHttpUrl('https://a')).toBe(true)
    expect(isSafeHttpUrl('data:x')).toBe(false)
    expect(safeSongFilename('a/b:c')).toBe('a_b_c.mp3')
    expect(safeSongFilename('')).toBe('未命名.mp3')
  })
})

describe('playSongOnAudioElement', () => {
  function fakeAudio(src = '') {
    return {
      src,
      volume: 0,
      currentTime: 12,
      play: vi.fn(async () => undefined),
      pause: vi.fn()
    }
  }

  it('缺少音频地址时返回明确失败，不调用 play', async () => {
    const audio = fakeAudio()
    const result = await playSongOnAudioElement(audio, { audioUrl: '   ' }, 0.8)
    expect(result).toEqual({ ok: false, reason: 'missing-url' })
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('用户点击播放时复用 audio，设置 src/音量并调用 play', async () => {
    const audio = fakeAudio()
    const result = await playSongOnAudioElement(audio, { audioUrl: 'https://cdn/a.mp3' }, 0.6)
    expect(result).toEqual({ ok: true })
    expect(audio.src).toBe('https://cdn/a.mp3')
    expect(audio.currentTime).toBe(0)
    expect(audio.volume).toBe(0.6)
    expect(audio.play).toHaveBeenCalledTimes(1)
  })

  it('切换歌曲时先暂停旧音频，再加载新地址', async () => {
    const audio = fakeAudio('https://cdn/old.mp3')
    await playSongOnAudioElement(audio, { audioUrl: 'https://cdn/new.mp3' }, 1.5)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe('https://cdn/new.mp3')
    expect(audio.volume).toBe(1)
  })

  it('浏览器拒绝播放时返回 play-failed，供 UI 展示错误', async () => {
    const audio = fakeAudio()
    audio.play.mockRejectedValueOnce(new Error('NotAllowedError'))
    const result = await playSongOnAudioElement(audio, { audioUrl: 'https://cdn/a.mp3' }, 0.8)
    expect(result).toEqual({ ok: false, reason: 'play-failed', message: 'NotAllowedError' })
  })
})
