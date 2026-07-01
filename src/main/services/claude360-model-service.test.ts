import { describe, expect, it } from 'vitest'
import { Claude360ModelService, type Claude360ApiClientPort } from './claude360-model-service'
import { type Claude360SecretStore } from './claude360-secret-store'
import type { Claude360TokenPurpose } from '../../shared/claude360'

function fakeSecretStore(seed: Record<string, string> = { 'claude360:cli-token': 'cli-tok' }): Claude360SecretStore {
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

function fakeApi(routes: Record<string, () => unknown>): Claude360ApiClientPort {
  return {
    get: async <T>(path: string) => {
      const key = Object.keys(routes).find((r) => path === r || path.startsWith(`${r}&`) || path.startsWith(`${r}`))
      if (!key) throw new Error(`no route ${path}`)
      return routes[key]() as T
    }
  }
}

describe('Claude360ModelService.refreshGroupsAndModels', () => {
  it('builds claude360:<group> profiles, image capability and a model cache', async () => {
    const ensured: Array<[string, Claude360TokenPurpose]> = []
    const service = new Claude360ModelService({
      apiClient: fakeApi({
        '/api/cli/groups?tool=codex': () => ({ groups: [{ name: 'auto' }, { name: 'vip' }] }),
        '/api/cli/groups?tool=image': () => ({ groups: [{ name: 'image-group' }] }),
        '/api/cli/groups?tool=music': () => ({ groups: [] }),
        '/api/cli/models?group=auto': () => ({ models: [{ id: 'claude-sonnet-4-6' }] }),
        '/api/cli/models?group=vip': () => ({ models: [{ id: 'gpt-5.1-codex-max' }] }),
        '/api/cli/models?group=image-group': () => ({ models: [{ id: 'gemini-2.5-flash-image' }] })
      }),
      secretStore: fakeSecretStore(),
      ensureGroupRef: async (group, purpose) => {
        ensured.push([group, purpose])
        return { tokenId: group === 'auto' ? 1 : group === 'vip' ? 2 : 3, name: `Claude360 Copilot / ${purpose}`, group }
      }
    })

    const result = await service.refreshGroupsAndModels()

    const ids = result.providerProfiles.map((p) => p.id).sort()
    expect(ids).toEqual(['claude360:auto', 'claude360:image-group', 'claude360:vip'])

    const auto = result.providerProfiles.find((p) => p.id === 'claude360:auto')!
    expect(auto.baseUrl).toBe('https://claude360.xyz')
    expect(auto.endpointFormat).toBe('chat_completions')
    // 明文不落 profile：apiKey 为空，改存 secret-store 引用 apiKeyRef。
    expect(auto.apiKey).toBe('')
    expect(auto.apiKeyRef).toBe('claude360:api-key:1')
    expect(auto.modelProfiles['claude-sonnet-4-6'].supportsToolCalling).toBe(true)
    expect(auto.image).toBeUndefined()

    const image = result.providerProfiles.find((p) => p.id === 'claude360:image-group')!
    expect(image.image).toMatchObject({ protocol: 'openai-images', models: ['gemini-2.5-flash-image'] })
    expect(image.modelProfiles['gemini-2.5-flash-image'].supportsToolCalling).toBe(false)

    expect(result.modelCache.groups.sort()).toEqual(['auto', 'image-group', 'vip'])
    expect(result.modelCache.models).toContain('claude-sonnet-4-6')
    expect(result.modelCache.models).toContain('gemini-2.5-flash-image')

    // image-group 用途为 image，codex 分组用途为 text
    expect(ensured).toContainEqual(['image-group', 'image'])
    expect(ensured).toContainEqual(['auto', 'text'])

    // 分组清单按用途返回，供上层持久化 selectedTextGroup/Image/Music。
    expect(result.groupsByPurpose.text.map((g) => g.name).sort()).toEqual(['auto', 'vip'])
    expect(result.groupsByPurpose.image.map((g) => g.name)).toEqual(['image-group'])
    expect(result.groupsByPurpose.music).toEqual([])
  })

  it('parses the array-shaped groups envelope and carries recommended flags', async () => {
    // 后端 /api/cli/groups 的 data 实为数组（common.ApiSuccess 直接包数组），
    // 服务须兼容数组形态，否则分组读不到、provider 与 selected group 全部落空。
    const service = new Claude360ModelService({
      apiClient: fakeApi({
        '/api/cli/groups?tool=codex': () => [
          { name: 'auto', recommended: false },
          { name: 'vip', recommended: true }
        ],
        '/api/cli/groups?tool=image': () => [{ name: 'image-group', recommended: true }],
        '/api/cli/groups?tool=music': () => [{ name: 'music-group', recommended: false }],
        '/api/cli/models?group=auto': () => ({ models: [{ id: 'gpt-5.1-codex-max' }] }),
        '/api/cli/models?group=vip': () => ({ models: [{ id: 'gpt-5.1-codex-max' }] }),
        '/api/cli/models?group=image-group': () => ({ models: [{ id: 'gemini-2.5-flash-image' }] }),
        '/api/cli/models?group=music-group': () => ({ models: [{ id: 'suno-v4' }] })
      }),
      secretStore: fakeSecretStore(),
      ensureGroupRef: async (group, purpose) => ({ tokenId: 1, name: purpose, group })
    })

    const result = await service.refreshGroupsAndModels()

    expect(result.groupsByPurpose.text).toEqual([
      { name: 'auto', recommended: false },
      { name: 'vip', recommended: true }
    ])
    expect(result.groupsByPurpose.image).toEqual([{ name: 'image-group', recommended: true }])
    expect(result.groupsByPurpose.music).toEqual([{ name: 'music-group', recommended: false }])
    expect(result.providerProfiles.map((p) => p.id).sort()).toEqual([
      'claude360:auto',
      'claude360:image-group',
      'claude360:music-group',
      'claude360:vip'
    ])
  })

  it('throws when not logged in', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({}),
      secretStore: fakeSecretStore({}),
      ensureGroupRef: async (group, purpose) => ({ tokenId: 1, name: purpose, group })
    })
    await expect(service.refreshGroupsAndModels()).rejects.toThrow(/未登录/)
  })
})
