import { describe, expect, it, vi } from 'vitest'
import {
  Claude360MusicService,
  type Claude360MusicApiClientPort,
  type Claude360MusicServiceDeps
} from './claude360-music-service'
import { Claude360ApiError, type Claude360SunoRawEnvelope } from './claude360-api-client'
import { type Claude360SecretStore } from './claude360-secret-store'
import type { Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import type { Claude360MusicSubmitPayload } from '../../shared/claude360-music'
import type { Claude360TokenPurpose } from '../../shared/claude360'

// —— fake 端口（沿用既有 service test 的 fakeApi/fakeSecretStore/settingsPort 模式）——

function fakeSecretStore(seed: Record<string, string> = {}): Claude360SecretStore {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    saveSecret: async (r, v) => {
      map.set(r, v)
    },
    loadSecret: async (r) => map.get(r) ?? null,
    deleteSecret: async (r) => {
      map.delete(r)
    },
    clearClaude360Secrets: async () => map.clear(),
    isEncryptionActive: () => true
  }
}

function settingsWithMusicGroup(group: string): Claude360SettingsV1 {
  return {
    baseUrl: 'https://claude360.xyz',
    loggedIn: true,
    username: 'demo',
    displayName: 'Demo',
    defaultGroup: 'auto',
    selectedTextGroup: 'auto',
    selectedImageGroup: '',
    selectedMusicGroup: group,
    cliTokenRef: '',
    tokenRefs: {},
    modelCache: { groups: [], models: [] },
    lastSyncAt: ''
  }
}

type FakeApiOptions = {
  submit?: () => Claude360SunoRawEnvelope
  fetch?: () => Claude360SunoRawEnvelope
  onCall?: (path: string, body: unknown, token: string | undefined) => void
}

function fakeApi(opts: FakeApiOptions = {}): Claude360MusicApiClientPort {
  return {
    postSunoRaw: async (path, body, token) => {
      opts.onCall?.(path, body, token)
      if (path === '/suno/submit/music') {
        return (opts.submit ?? (() => ({ code: 'success', data: 'task-abc' })))()
      }
      if (path === '/suno/fetch') {
        return (opts.fetch ?? (() => ({ code: 'success', data: [] })))()
      }
      throw new Error(`unexpected path ${path}`)
    }
  }
}

function makeDeps(overrides: Partial<Claude360MusicServiceDeps> = {}): Claude360MusicServiceDeps {
  const ensured: Array<[string, Claude360TokenPurpose]> = []
  return {
    apiClient: fakeApi(),
    secretStore: fakeSecretStore(),
    readClaude360: async () => settingsWithMusicGroup('music-vip'),
    ensureGroupKey: vi.fn(async (group: string, purpose: Claude360TokenPurpose) => {
      ensured.push([group, purpose])
      return `key-${group}`
    }),
    ...overrides
  }
}

const samplePayload: Claude360MusicSubmitPayload = {
  prompt: '轻快的电子舞曲',
  model: 'V5_5',
  custom_mode: false
}

describe('Claude360MusicService.submitMusic', () => {
  it('使用 selectedMusicGroup 的 music Key 调 /suno/submit/music 并返回 taskId', async () => {
    const calls: Array<{ path: string; token: string | undefined }> = []
    const ensureGroupKey = vi.fn(async (group: string) => `key-${group}`)
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({
          submit: () => ({ code: 'success', data: 'T-777' }),
          onCall: (path, _body, token) => calls.push({ path, token })
        }),
        readClaude360: async () => settingsWithMusicGroup('music-vip'),
        ensureGroupKey
      })
    )

    const result = await service.submitMusic(samplePayload)

    expect(result).toEqual({ ok: true, taskId: 'T-777' })
    // 使用 music 分组、purpose=music
    expect(ensureGroupKey).toHaveBeenCalledWith('music-vip', 'music')
    // 请求带该分组 music Key
    expect(calls[0]).toMatchObject({ path: '/suno/submit/music', token: 'key-music-vip' })
  })

  it('未选择音乐分组：返回可展示错误，引导到 设置 → 分组及 Key（不再指向「我的」页）', async () => {
    const ensureGroupKey = vi.fn(async (group: string) => `key-${group}`)
    const service = new Claude360MusicService(
      makeDeps({
        readClaude360: async () => settingsWithMusicGroup(''),
        ensureGroupKey
      })
    )

    const result = await service.submitMusic(samplePayload)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('设置 → 分组及 Key')
      expect(result.message).not.toContain('我的')
    }
    expect(ensureGroupKey).not.toHaveBeenCalled()
  })

  it('不把 API Key 返回 renderer（结果对象里不含明文 Key）', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({ submit: () => ({ code: 'success', data: 'T-1' }) }),
        ensureGroupKey: async () => 'sk-super-secret-key'
      })
    )
    const result = await service.submitMusic(samplePayload)
    expect(JSON.stringify(result)).not.toContain('sk-super-secret-key')
  })

  it('账号未登录时返回登录提示错误，不发起请求', async () => {
    const postSunoRaw = vi.fn()
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: { postSunoRaw } as never,
        ensureGroupKey: async () => {
          throw new Claude360ApiError('未登录，请先登录 Claude360')
        }
      })
    )
    const result = await service.submitMusic(samplePayload)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.message).toMatch(/未登录/)
    expect(postSunoRaw).not.toHaveBeenCalled()
  })

  it('未选择 music 分组时返回可展示的分组错误', async () => {
    const service = new Claude360MusicService(
      makeDeps({ readClaude360: async () => settingsWithMusicGroup('') })
    )
    const result = await service.submitMusic(samplePayload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/音乐分组|分组/)
  })

  it('余额/分组等上游错误返回可展示 message（code !== success）', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({ submit: () => ({ code: '429', message: '余额不足，请充值' }) })
      })
    )
    const result = await service.submitMusic(samplePayload)
    expect(result).toMatchObject({ ok: false, message: '余额不足，请充值' })
  })

  it('网络失败返回 { ok:false, retryable:true }', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: {
          postSunoRaw: async () => {
            throw new Claude360ApiError('网络请求失败，请检查网络连接')
          }
        }
      })
    )
    const result = await service.submitMusic(samplePayload)
    expect(result).toMatchObject({ ok: false, retryable: true })
  })
})

describe('Claude360MusicService.fetchMusic', () => {
  it('taskId 为空时直接返回错误，不发起请求', async () => {
    const postSunoRaw = vi.fn()
    const service = new Claude360MusicService(makeDeps({ apiClient: { postSunoRaw } as never }))
    const result = await service.fetchMusic('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/taskId|任务/)
    expect(postSunoRaw).not.toHaveBeenCalled()
  })

  it('用 music Key 调 /suno/fetch 传 ids=[taskId] 并归一化成功任务', async () => {
    const calls: Array<{ path: string; body: unknown; token: string | undefined }> = []
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({
          fetch: () => ({
            code: 'success',
            data: [
              {
                task_id: 'T-9',
                action: 'MUSIC',
                status: 'SUCCESS',
                data: [
                  {
                    id: 's1',
                    audio_url: 'https://cdn/a.mp3',
                    image_url: 'https://cdn/a.png',
                    title: '晨光',
                    model_name: 'chirp-v5',
                    metadata: { tags: 'pop', duration: 123 }
                  }
                ]
              }
            ]
          }),
          onCall: (path, body, token) => calls.push({ path, body, token })
        })
      })
    )

    const result = await service.fetchMusic('T-9')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.task).toMatchObject({
        taskId: 'T-9',
        status: 'success'
      })
      expect(result.task.songs[0]).toMatchObject({
        id: 's1',
        audioUrl: 'https://cdn/a.mp3',
        imageUrl: 'https://cdn/a.png',
        title: '晨光',
        duration: 123,
        tags: 'pop',
        modelName: 'chirp-v5'
      })
    }
    expect(calls[0]).toMatchObject({ path: '/suno/fetch', body: { ids: ['T-9'] }, token: 'key-music-vip' })
  })

  it('兼容上游音频和封面的多种字段名，避免成功歌曲被过滤或丢封面', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({
          fetch: () => ({
            code: 'success',
            data: [
              {
                task_id: 'T-alt',
                action: 'MUSIC',
                status: 'SUCCESS',
                data: [
                  { id: 'audioUrl', audioUrl: 'https://cdn/audio-url.mp3', imageUrl: 'https://cdn/image-url.png' },
                  { id: 'url', url: 'https://cdn/url.mp3', coverUrl: 'https://cdn/cover-url.png' },
                  { id: 'streamUrl', streamUrl: 'https://cdn/stream-url.mp3', artworkUrl: 'https://cdn/artwork-url.png' },
                  { id: 'fileUrl', fileUrl: 'https://cdn/file-url.mp3', thumbnail: 'https://cdn/thumbnail.png' },
                  { id: 'musicUrl', musicUrl: 'https://cdn/music-url.mp3', image: 'https://cdn/image.png' },
                  { id: 'audio', audio: 'https://cdn/audio.mp3', cover: 'https://cdn/cover.png' },
                  { id: 'streamAudioUrl', streamAudioUrl: 'https://cdn/stream-audio-url.mp3' }
                ]
              }
            ]
          })
        })
      })
    )

    const result = await service.fetchMusic('T-alt')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.task.songs).toEqual([
        expect.objectContaining({
          id: 'audioUrl',
          audioUrl: 'https://cdn/audio-url.mp3',
          imageUrl: 'https://cdn/image-url.png'
        }),
        expect.objectContaining({
          id: 'url',
          audioUrl: 'https://cdn/url.mp3',
          imageUrl: 'https://cdn/cover-url.png'
        }),
        expect.objectContaining({
          id: 'streamUrl',
          audioUrl: 'https://cdn/stream-url.mp3',
          imageUrl: 'https://cdn/artwork-url.png'
        }),
        expect.objectContaining({
          id: 'fileUrl',
          audioUrl: 'https://cdn/file-url.mp3',
          imageUrl: 'https://cdn/thumbnail.png'
        }),
        expect.objectContaining({
          id: 'musicUrl',
          audioUrl: 'https://cdn/music-url.mp3',
          imageUrl: 'https://cdn/image.png'
        }),
        expect.objectContaining({
          id: 'audio',
          audioUrl: 'https://cdn/audio.mp3',
          imageUrl: 'https://cdn/cover.png'
        }),
        expect.objectContaining({
          id: 'streamAudioUrl',
          audioUrl: 'https://cdn/stream-audio-url.mp3'
        })
      ])
    }
  })

  it('把接口返回的相对资源地址补全为 Claude360 baseUrl 下的完整 URL', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        readClaude360: async () => ({ ...settingsWithMusicGroup('music-vip'), baseUrl: 'https://claude360.xyz/app/' }),
        apiClient: fakeApi({
          fetch: () => ({
            code: 'success',
            data: [
              {
                task_id: 'T-relative',
                action: 'MUSIC',
                status: 'SUCCESS',
                data: [
                  { id: 'root', audio_url: '/suno/files/a.mp3', image_url: '/suno/files/a.png' },
                  { id: 'plain', audio_url: 'media/b.mp3', image_url: 'media/b.png' },
                  { id: 'protocol', audio_url: '//cdn.example/c.mp3', image_url: '//cdn.example/c.png' }
                ]
              }
            ]
          })
        })
      })
    )

    const result = await service.fetchMusic('T-relative')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.task.songs).toEqual([
        expect.objectContaining({
          id: 'root',
          audioUrl: 'https://claude360.xyz/suno/files/a.mp3',
          imageUrl: 'https://claude360.xyz/suno/files/a.png'
        }),
        expect.objectContaining({
          id: 'plain',
          audioUrl: 'https://claude360.xyz/app/media/b.mp3',
          imageUrl: 'https://claude360.xyz/app/media/b.png'
        }),
        expect.objectContaining({
          id: 'protocol',
          audioUrl: 'https://cdn.example/c.mp3',
          imageUrl: 'https://cdn.example/c.png'
        })
      ])
    }
  })

  it('把 Windows 本地资源路径转换为 Electron 可加载的 file URL', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({
          fetch: () => ({
            code: 'success',
            data: [
              {
                task_id: 'T-local',
                action: 'MUSIC',
                status: 'SUCCESS',
                data: [
                  { id: 'local', audio_url: 'C:\\Music\\song.mp3', image_url: 'D:\\Images\\cover.png' }
                ]
              }
            ]
          })
        })
      })
    )

    const result = await service.fetchMusic('T-local')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.task.songs[0]).toMatchObject({
        audioUrl: 'file:///C:/Music/song.mp3',
        imageUrl: 'file:///D:/Images/cover.png'
      })
    }
  })

  it('上游未知状态标记 unresolved，避免永久轮询', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: fakeApi({
          fetch: () => ({
            code: 'success',
            data: [{ task_id: 'T-2', action: 'MUSIC', status: 'UNKNOWN' }]
          })
        })
      })
    )
    const result = await service.fetchMusic('T-2')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.task.unresolved).toBe(true)
      expect(result.task.status).toBe('in_progress')
    }
  })

  it('上游成功但未返回该任务时返回 unresolved 可归约结果（供轮询按 miss 计数兜底）', async () => {
    const service = new Claude360MusicService(
      makeDeps({ apiClient: fakeApi({ fetch: () => ({ code: 'success', data: [] }) }) })
    )
    const result = await service.fetchMusic('T-missing')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.task).toMatchObject({ taskId: 'T-missing', unresolved: true })
    }
  })

  it('网络失败返回 { ok:false, retryable:true }', async () => {
    const service = new Claude360MusicService(
      makeDeps({
        apiClient: {
          postSunoRaw: async () => {
            throw new Claude360ApiError('网络请求失败，请检查网络连接')
          }
        }
      })
    )
    const result = await service.fetchMusic('T-9')
    expect(result).toMatchObject({ ok: false, retryable: true })
  })
})

describe('Claude360MusicService.fetchMusicMedia', () => {
  it('同源音频代理请求携带 music Key 并返回 base64 blob', async () => {
    const calls: Array<{ url: string; headers?: HeadersInit }> = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers })
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' }
      })
    })
    const service = new Claude360MusicService(
      makeDeps({
        readClaude360: async () => ({ ...settingsWithMusicGroup('music-vip'), baseUrl: 'https://claude360.xyz/app/' }),
        fetchImpl
      })
    )

    const result = await service.fetchMusicMedia('/suno/files/a.mp3')

    expect(result).toEqual({
      ok: true,
      url: 'https://claude360.xyz/suno/files/a.mp3',
      mimeType: 'audio/mpeg',
      base64: 'AQID'
    })
    expect(calls[0]).toMatchObject({
      url: 'https://claude360.xyz/suno/files/a.mp3',
      headers: { Authorization: 'Bearer key-music-vip' }
    })
  })

  it('跨域 CDN 音频代理请求不泄露 Authorization', async () => {
    const calls: Array<{ url: string; headers?: HeadersInit }> = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers })
      return new Response(new Uint8Array([1]), { status: 200 })
    })
    const service = new Claude360MusicService(makeDeps({ fetchImpl }))

    const result = await service.fetchMusicMedia('https://cdn.example/a.mp3')

    expect(result.ok).toBe(true)
    expect(calls[0]).toMatchObject({ url: 'https://cdn.example/a.mp3', headers: {} })
  })
})
