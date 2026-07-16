import { describe, expect, it, vi } from 'vitest'
import {
  buildClaude360ProviderProfiles,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultImageWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  defaultClaude360Settings,
  isClaude360ProviderId,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds } from './upstream-models'

// Claude360 收口后，composer 模型列表只来自登录后自动生成的 `claude360:*`
// provider profile 与 modelCache，不再回落到 Kun/DeepSeek 默认模型。
function settings(options: { loggedIn?: boolean; runtimeModel?: string; providers?: AppSettingsV1['provider']['providers'] } = {}): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  const claude360Providers = buildClaude360ProviderProfiles(
    [
      {
        group: 'auto',
        models: [
          { id: 'claude-sonnet-4-6', supportsToolCalling: true },
          { id: 'gpt-5-codex', supportsToolCalling: true }
        ]
      },
      {
        group: 'image-group',
        models: [{ id: 'gpt-image-1', isImage: true }]
      }
    ],
    { auto: 'sk-auto', 'image-group': 'sk-image' }
  )
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    provider: { ...provider, providers: options.providers ?? claude360Providers },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        model: options.runtimeModel ?? 'claude-sonnet-4-6',
        providerId: 'claude360:auto'
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false, windowMaterial: 'none' },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    imageWorkflow: defaultImageWorkflowSettings(),
    terminal: defaultTerminalSettings(),
    claude360: {
      ...defaultClaude360Settings(),
      loggedIn: options.loggedIn ?? true,
      username: 'alice',
      displayName: 'Alice',
      modelCache: {
        groups: ['auto', 'image-group'],
        models: ['claude-sonnet-4-6', 'gpt-5-codex', 'gpt-image-1']
      }
    },
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

describe('upstream model picker list (Claude360 source)', () => {
  it('returns Claude360 groups and text models when logged in', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await fetchUpstreamModelIds(settings())

      expect(result).toMatchObject({ ok: true })
      if (result.ok) {
        // Text models from the claude360 groups are present...
        expect(result.modelIds).toContain('claude-sonnet-4-6')
        expect(result.modelIds).toContain('gpt-5-codex')
        // ...image-output models never enter the text composer picker...
        expect(result.modelIds).not.toContain('gpt-image-1')
        // ...and there is no DeepSeek/Kun default fallback.
        expect(result.modelIds).not.toContain('deepseek-v4-pro')
        expect(result.modelIds).not.toContain('deepseek-v4-flash')
        expect(result.modelIds).not.toContain('auto')

        const autoGroup = result.modelGroups?.find((group) => group.providerId === 'claude360-auto')
        expect(autoGroup?.label).toBe('auto')
        expect(autoGroup?.modelIds).toEqual(expect.arrayContaining(['claude-sonnet-4-6', 'gpt-5-codex']))
        expect(autoGroup?.modelIds).not.toContain('gpt-image-1')
        // The image-only group has no text models, so it is not offered.
        expect(result.modelGroups?.some((group) => group.providerId === 'claude360-image-group')).toBe(false)
      }
      // The picker never queries the upstream /v1/models catalog.
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses the runtime model as defaultModelId when it is a known Claude360 text model', async () => {
    const result = await fetchUpstreamModelIds(settings({ runtimeModel: 'gpt-5-codex' }))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.defaultModelId).toBe('gpt-5-codex')
    }
  })

  it('falls back to the first cached text model when the runtime model is unknown', async () => {
    const result = await fetchUpstreamModelIds(settings({ runtimeModel: 'no-such-model' }))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.defaultModelId).toBe('claude-sonnet-4-6')
    }
  })

  it('returns an explicit error and no fallback models when Claude360 is not logged in', async () => {
    const result = await fetchUpstreamModelIds(settings({ loggedIn: false }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toBeTruthy()
    }
  })

  it('keeps Codex available for Code even when provider has no apiKeyRef', async () => {
    const codexProvider = buildClaude360ProviderProfiles(
      [{ group: 'Codex', models: [{ id: 'gpt-5.5', supportsToolCalling: true }] }],
      {}
    )

    const result = await fetchUpstreamModelIds(settings({ providers: codexProvider, runtimeModel: '' }))

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.modelIds).toContain('gpt-5.5')
      expect(result.modelGroups).toEqual([
        expect.objectContaining({
          providerId: 'claude360-codex',
          label: 'Codex',
          modelIds: ['gpt-5.5']
        })
      ])
    }
  })

  // 07-17 国模分组事故回归：纯中文分组（仅出现在全量分组接口）此前经 settings
  // 归一化后 id 塌缩成裸 claude360，被 isClaude360ProviderId 过滤，三个文本
  // 选择器整组拉不到。现在必须以原始分组名为 label 完整出现。
  it('offers Chinese-named groups with their text models and keeps non-text groups out', async () => {
    const providers = buildClaude360ProviderProfiles(
      [
        {
          group: '国模分组',
          models: [
            { id: 'deepseek-v4-pro' },
            { id: 'qwen3.7-max' },
            { id: 'kimi-k2.7-code' },
            { id: 'glm-5.1' }
          ]
        },
        { group: 'image-大香蕉', models: [{ id: 'gemini-3-pro-image', isImage: true }] },
        { group: 'Suno-音乐生成', models: [{ id: 'gpt-5.5' }, { id: 'suno_music' }] }
      ],
      {}
    )

    const result = await fetchUpstreamModelIds(settings({ providers, runtimeModel: '' }))

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      const guomo = result.modelGroups?.find((group) => group.label === '国模分组')
      expect(guomo).toBeDefined()
      expect(guomo?.modelIds).toEqual(['deepseek-v4-pro', 'glm-5.1', 'kimi-k2.7-code', 'qwen3.7-max'])
      // providerId 归一化后仍可被识别为 Claude360 provider，选择配对不回退默认分组。
      expect(guomo && isClaude360ProviderId(guomo.providerId)).toBe(true)
      // 纯图片分组不进文本选择器。
      expect(result.modelGroups?.some((group) => group.label === 'image-大香蕉')).toBe(false)
      // 混合分组只保留通过 capability 判定的文本模型。
      const suno = result.modelGroups?.find((group) => group.label === 'Suno-音乐生成')
      expect(suno?.modelIds).toEqual(['gpt-5.5'])
    }
  })
})
