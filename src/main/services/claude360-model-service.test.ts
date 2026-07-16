import { describe, expect, it } from 'vitest'
import { Claude360ModelService, type Claude360ApiClientPort } from './claude360-model-service'
import { type Claude360SecretStore } from './claude360-secret-store'

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
  it('builds claude360:<group> profiles and never creates keys while refreshing models', async () => {
    let ensureCalls = 0
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
        ensureCalls++
        throw new Error(`refresh must not ensure token for ${purpose}:${group}`)
      }
    })

    const result = await service.refreshGroupsAndModels()

    const ids = result.providerProfiles.map((p) => p.id).sort()
    expect(ids).toEqual(['claude360:auto', 'claude360:image-group', 'claude360:vip'])

    const auto = result.providerProfiles.find((p) => p.id === 'claude360:auto')!
    expect(auto.baseUrl).toBe('https://claude360.xyz')
    expect(auto.endpointFormat).toBe('chat_completions')
    // 刷新模型只同步 Claude360 分组/模型，不创建/揭示 Key；apiKeyRef 由执行前 tokens:ensure 回填。
    expect(auto.apiKey).toBe('')
    expect(auto.apiKeyRef).toBeUndefined()
    expect(auto.modelProfiles['claude-sonnet-4-6'].supportsToolCalling).toBe(true)
    expect(auto.image).toBeUndefined()

    const image = result.providerProfiles.find((p) => p.id === 'claude360:image-group')!
    expect(image.image).toMatchObject({ protocol: 'openai-images', models: ['gemini-2.5-flash-image'] })
    expect(image.modelProfiles['gemini-2.5-flash-image'].supportsToolCalling).toBe(false)

    expect(result.modelCache.groups.sort()).toEqual(['auto', 'image-group', 'vip'])
    expect(result.modelCache.models).toContain('claude-sonnet-4-6')
    expect(result.modelCache.models).toContain('gemini-2.5-flash-image')

    expect(ensureCalls).toBe(0)

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
          { name: 'auto', recommended: false, ratio: 1, desc: '自动' },
          { name: 'vip', recommended: true, ratio: 0.8, desc: '高速通道' }
        ],
        '/api/cli/groups?tool=image': () => [{ name: 'image-group', recommended: true, ratio: 2, desc: '图像' }],
        '/api/cli/groups?tool=music': () => [{ name: 'music-group', recommended: false, ratio: 1.2 }],
        '/api/cli/models?group=auto': () => ({ models: [{ id: 'gpt-5.1-codex-max' }] }),
        '/api/cli/models?group=vip': () => ({ models: [{ id: 'gpt-5.1-codex-max' }] }),
        '/api/cli/models?group=image-group': () => ({ models: [{ id: 'gemini-2.5-flash-image' }] }),
        '/api/cli/models?group=music-group': () => ({ models: [{ id: 'suno-v4' }] })
      }),
      secretStore: fakeSecretStore(),
      ensureGroupRef: async (group, purpose) => {
        throw new Error(`refresh must not ensure token for ${purpose}:${group}`)
      }
    })

    const result = await service.refreshGroupsAndModels()

    expect(result.groupsByPurpose.text).toEqual([
      { name: 'auto', recommended: false, ratio: 1, desc: '自动' },
      { name: 'vip', recommended: true, ratio: 0.8, desc: '高速通道' }
    ])
    expect(result.groupsByPurpose.image).toEqual([
      { name: 'image-group', recommended: true, ratio: 2, desc: '图像' }
    ])
    // music-group 未提供 desc → 解析为 undefined（toEqual 忽略）；ratio 保留。
    expect(result.groupsByPurpose.music).toEqual([{ name: 'music-group', recommended: false, ratio: 1.2 }])
    expect(result.providerProfiles.map((p) => p.id).sort()).toEqual([
      'claude360:auto',
      'claude360:image-group',
      'claude360:music-group',
      'claude360:vip'
    ])
  })

  it('uses the full group list as text fallback so Code sees Codex when tool=codex is empty', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({
        '/api/cli/groups?tool=codex': () => [],
        '/api/cli/groups?tool=image': () => [{ name: 'image', recommended: false }],
        '/api/cli/groups?tool=music': () => [{ name: 'Suno', recommended: false }],
        '/api/cli/groups': () => [
          { name: 'Codex', recommended: true, ratio: 1, desc: 'Code 分组' },
          { name: 'image', recommended: false },
          { name: 'Suno', recommended: false }
        ],
        '/api/cli/models?group=Codex': () => ({ models: [{ id: 'gpt-5.5' }] }),
        '/api/cli/models?group=image': () => ({ models: [{ id: 'gemini-2.5-flash-image' }] }),
        '/api/cli/models?group=Suno': () => ({ models: [{ id: 'suno-v4' }] })
      }),
      secretStore: fakeSecretStore(),
      ensureGroupRef: async () => {
        throw new Error('refresh must not ensure keys')
      }
    })

    const result = await service.refreshGroupsAndModels()

    expect(result.groupsByPurpose.text).toEqual([
      { name: 'Codex', recommended: true, ratio: 1, desc: 'Code 分组' }
    ])
    expect(result.modelCache.groups).toEqual(expect.arrayContaining(['Codex']))
    expect(result.modelCache.models).toContain('gpt-5.5')
    expect(result.providerProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude360:Codex',
          name: 'Codex',
          apiKey: '',
          models: ['gpt-5.5']
        })
      ])
    )
  })

  // 07-17 国模分组事故回归：仅出现在全量接口的纯中文分组必须归入 text，
  // 且生成的 provider id 要能在 settings 归一化后仍被识别（不塌缩成裸 claude360）。
  it('classifies full-list-only Chinese-named groups as text with a normalization-safe id', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({
        '/api/cli/groups?tool=codex': () => [{ name: 'Codex', recommended: true }],
        '/api/cli/groups?tool=image': () => [],
        '/api/cli/groups?tool=music': () => [],
        '/api/cli/groups': () => [
          { name: 'Codex', recommended: true },
          { name: '国模分组', recommended: false, ratio: 1, desc: '国产模型' }
        ],
        '/api/cli/models?group=Codex': () => ({ models: [{ id: 'gpt-5.5' }] }),
        '/api/cli/models?group=%E5%9B%BD%E6%A8%A1%E5%88%86%E7%BB%84': () => ({
          models: [{ id: 'qwen3.7-max' }, { id: 'kimi-k2.7-code' }]
        })
      }),
      secretStore: fakeSecretStore()
    })

    const result = await service.refreshGroupsAndModels()

    expect(result.groupsByPurpose.text.map((g) => g.name)).toEqual(['Codex', '国模分组'])
    expect(result.modelCache.groups).toEqual(expect.arrayContaining(['国模分组']))
    expect(result.modelCache.models).toEqual(expect.arrayContaining(['qwen3.7-max', 'kimi-k2.7-code']))

    const guomo = result.providerProfiles.find((p) => p.name === '国模分组')!
    expect(guomo.models).toEqual(['qwen3.7-max', 'kimi-k2.7-code'])
    // id 归一化安全性（isClaude360ProviderId 往返）由 shared 层
    // app-settings-provider.test.ts 的 buildClaude360ProviderProfiles 用例统一覆盖。
  })

  it('throws when not logged in', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({}),
      secretStore: fakeSecretStore({}),
      ensureGroupRef: async () => {
        throw new Error('not used')
      }
    })
    await expect(service.refreshGroupsAndModels()).rejects.toThrow(/未登录/)
  })
})

describe('Claude360ModelService.listGroups / listModelsByGroup', () => {
  it('lists groups with ratio/desc and has no side effects (never ensures keys)', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({
        '/api/cli/groups?tool=codex': () => [{ name: 'auto', recommended: true, ratio: 1, desc: '自动分组' }],
        '/api/cli/groups?tool=image': () => [],
        '/api/cli/groups?tool=music': () => [],
        // 全量（不带 tool）：含未被任何 tool 命中的通用分组 claude-only。
        '/api/cli/groups': () => [
          { name: 'auto', recommended: true, ratio: 1, desc: '自动分组' },
          { name: 'claude-only', recommended: false, ratio: 1.5, desc: '纯 Claude' }
        ]
      }),
      secretStore: fakeSecretStore(),
      ensureGroupRef: async () => {
        throw new Error('listGroups must not ensure keys')
      }
    })
    const groups = await service.listGroups()
    // 「分组及Key」展示全量：tool 命中的 auto + 全量独有的 claude-only 都进 all(text 桶兜底)。
    expect(groups.text).toEqual([
      { name: 'auto', recommended: true, ratio: 1, desc: '自动分组' },
      { name: 'claude-only', recommended: false, ratio: 1.5, desc: '纯 Claude' }
    ])
    expect(groups.image).toEqual([])
    // 纯拉取：绝不触发建 Key（无副作用）。
  })

  it('lists models for a group and dedups ids', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({
        '/api/cli/models?group=vip': () => ({ models: [{ id: 'a' }, { id: 'a' }, { id: 'b' }, { id: '' }] })
      }),
      secretStore: fakeSecretStore(),
      ensureGroupRef: async () => {
        throw new Error('not used')
      }
    })
    expect(await service.listModelsByGroup('vip')).toEqual(['a', 'b'])
  })

  it('throws when not logged in (listGroups)', async () => {
    const service = new Claude360ModelService({
      apiClient: fakeApi({}),
      secretStore: fakeSecretStore({}),
      ensureGroupRef: async () => {
        throw new Error('not used')
      }
    })
    await expect(service.listGroups()).rejects.toThrow(/未登录/)
  })
})
