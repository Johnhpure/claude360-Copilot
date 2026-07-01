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
