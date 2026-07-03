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
  audioExtensionFromMimeType,
  debugProbeSongs,
  downloadSong,
  playSongOnAudioElement,
  pollActiveTasksOnce,
  songDownloadFilename,
  submitMusic
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

describe('downloadSong（主进程链路，绝不打开窗口）', () => {
  const song = { audioUrl: 'https://cdn/x.mp3', title: '我的歌' }
  const okMedia = { ok: true as const, url: 'https://cdn/x.mp3', mimeType: 'audio/mpeg', base64: 'eA==' }

  it('media-blob 代取成功 → save-as 保存成功', async () => {
    const claude360MusicMediaBlob = vi.fn(async () => okMedia)
    const saveWorkspaceFileAs = vi.fn(
      async (_payload: { suggestedName?: string; dataBase64?: string; mimeType?: string }) =>
        ({ ok: true as const, path: '/tmp/我的歌.mp3' })
    )
    const result = await downloadSong({ claude360MusicMediaBlob, saveWorkspaceFileAs }, song, vi.fn())
    expect(result).toEqual({ ok: true, path: '/tmp/我的歌.mp3' })
    expect(claude360MusicMediaBlob).toHaveBeenCalledWith('https://cdn/x.mp3')
    const payload = saveWorkspaceFileAs.mock.calls[0]![0]
    expect(payload.dataBase64).toBe('eA==')
    expect(payload.mimeType).toBe('audio/mpeg')
    expect(payload.suggestedName).toMatch(/^我的歌-\d{8}-\d{4}\.mp3$/)
  })

  it('media-blob 失败 → 返回失败并带原因，不触达 save-as', async () => {
    const claude360MusicMediaBlob = vi.fn(async () => ({ ok: false as const, message: '音频请求失败 (HTTP 403)' }))
    const saveWorkspaceFileAs = vi.fn()
    const log = vi.fn()
    const result = await downloadSong({ claude360MusicMediaBlob, saveWorkspaceFileAs }, song, log)
    expect(result).toEqual({ ok: false, message: '音频请求失败 (HTTP 403)' })
    expect(saveWorkspaceFileAs).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })

  it('用户取消保存 → canceled 标记，不算错误', async () => {
    const claude360MusicMediaBlob = vi.fn(async () => okMedia)
    const saveWorkspaceFileAs = vi.fn(async () => ({ ok: false as const, canceled: true as const, message: 'Save cancelled.' }))
    const result = await downloadSong({ claude360MusicMediaBlob, saveWorkspaceFileAs }, song, vi.fn())
    expect(result).toEqual({ ok: false, canceled: true, message: 'Save cancelled.' })
  })

  it('无音频地址 / 能力缺失时明确拒绝', async () => {
    const deps = { claude360MusicMediaBlob: vi.fn(), saveWorkspaceFileAs: vi.fn() }
    await expect(downloadSong(deps, { audioUrl: '  ', title: 't' }, vi.fn())).resolves.toMatchObject({ ok: false })
    await expect(downloadSong({}, song, vi.fn())).resolves.toMatchObject({ ok: false, message: '下载功能不可用' })
    expect(deps.claude360MusicMediaBlob).not.toHaveBeenCalled()
  })

  it('songDownloadFilename / audioExtensionFromMimeType 行为', () => {
    const now = new Date(2026, 6, 3, 9, 5)
    expect(songDownloadFilename('a/b:c', 'audio/mpeg', now)).toBe('a_b_c-20260703-0905.mp3')
    expect(songDownloadFilename('', 'audio/wav', now)).toBe(`music-${now.getTime()}.wav`)
    expect(audioExtensionFromMimeType('audio/mp4')).toBe('m4a')
    expect(audioExtensionFromMimeType('')).toBe('mp3')
  })
})

describe('debugProbeSongs（媒体可访问性探针）', () => {
  it('逐首验证 cover/audio 并打一条汇总日志', async () => {
    const claude360MusicMediaProbe = vi.fn(async (url: string) =>
      url.endsWith('.jpeg')
        ? { ok: true as const, url, status: 200, contentType: 'image/jpeg', playableAudio: false }
        : { ok: false as const, url, status: 403, contentType: 'application/json', message: '请求失败 (HTTP 403)' }
    )
    const log = vi.fn()
    const reports = await debugProbeSongs(
      { claude360MusicMediaProbe },
      [{ id: 's1', title: 'T', audioUrl: 'https://cdn/a.mp3', imageUrl: 'https://cdn/c.jpeg' }],
      log
    )
    expect(reports[0].cover).toMatchObject({ ok: true, contentType: 'image/jpeg' })
    expect(reports[0].audio).toMatchObject({ ok: false, status: 403 })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('无探针能力 / 无 URL 时不炸', async () => {
    const reports = await debugProbeSongs({}, [{ id: 's1', title: 'T', audioUrl: '', imageUrl: undefined }], vi.fn())
    expect(reports[0]).toMatchObject({ cover: null, audio: null })
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
    expect(result).toEqual({ ok: true, sourceUrl: 'https://cdn/a.mp3', usedFallback: false })
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

  it('浏览器拒绝播放时记录真实错误并返回 play-failed，供 UI 展示错误', async () => {
    const audio = fakeAudio()
    const logError = vi.fn()
    audio.play.mockRejectedValueOnce(new Error('NotAllowedError'))
    const result = await playSongOnAudioElement(audio, { audioUrl: 'https://cdn/a.mp3?sig=secret' }, 0.8, {
      logError
    })
    expect(result).toEqual({ ok: false, reason: 'play-failed', message: 'Error: NotAllowedError' })
    expect(logError).toHaveBeenCalledWith(
      '[claude360-music] audio.play failed',
      expect.objectContaining({
        message: 'Error: NotAllowedError',
        url: 'https://cdn/a.mp3'
      })
    )
  })

  it('HTMLAudioElement 直连失败时可使用 fallback object URL 再播放', async () => {
    const audio = fakeAudio()
    const resolvePlayableUrl = vi.fn(async () => 'blob:music-a')
    audio.play
      .mockRejectedValueOnce(new Error('HTTP 401'))
      .mockResolvedValueOnce(undefined)

    const result = await playSongOnAudioElement(audio, { audioUrl: 'https://claude360.xyz/suno/a.mp3' }, 0.8, {
      resolvePlayableUrl
    })

    expect(result).toEqual({ ok: true, sourceUrl: 'blob:music-a', usedFallback: true })
    expect(resolvePlayableUrl).toHaveBeenCalledWith('https://claude360.xyz/suno/a.mp3', expect.any(Error))
    expect(audio.src).toBe('blob:music-a')
    expect(audio.currentTime).toBe(0)
    expect(audio.play).toHaveBeenCalledTimes(2)
  })
})
