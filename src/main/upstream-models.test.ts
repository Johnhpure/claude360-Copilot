import { describe, expect, it, vi } from 'vitest'
import {
  buildClaude360ProviderProfiles,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  defaultClaude360Settings,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds } from './upstream-models'

// Claude360 收口后，composer 模型列表只来自登录后自动生成的 `claude360:*`
// provider profile 与 modelCache，不再回落到 Kun/DeepSeek 默认模型。
function settings(options: { loggedIn?: boolean; runtimeModel?: string } = {}): AppSettingsV1 {
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
    provider: { ...provider, providers: claude360Providers },
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
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
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
})
