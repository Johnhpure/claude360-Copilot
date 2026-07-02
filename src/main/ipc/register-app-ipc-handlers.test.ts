import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeScheduleSettings,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  defaultClaude360Settings,
  type AppSettingsPatch,
  type AppSettingsV1
} from '../../shared/app-settings'

const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  app: {
    quit: vi.fn()
  },
  dialog: {},
  shell: {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
}))

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
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
    claude360: defaultClaude360Settings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    disabledSkillIds: []
  }
}

function registerOptions(overrides: Partial<Parameters<typeof import('./register-app-ipc-handlers').registerAppIpcHandlers>[0]> = {}) {
  const applySettingsPatch = vi.fn(async () => settings())
  const saveSettingsPatch = vi.fn(async () => settings())
  return {
    store: { load: vi.fn(async () => settings()) } as never,
    getMainWindow: () => null,
    applySettingsPatch,
    saveSettingsPatch,
    runtimeRequest: vi.fn() as never,
    restartRuntime: vi.fn(async () => undefined),
    fetchUpstreamModels: vi.fn() as never,
    getClawRuntime: () => null,
    getScheduleRuntime: () => null,
    getWorkflowRuntime: () => null,
    startFeishuInstallQrcode: vi.fn() as never,
    pollFeishuInstall: vi.fn() as never,
    startWeixinInstallQrcode: vi.fn() as never,
    pollWeixinInstall: vi.fn() as never,
    resolveKunConfigPath: () => '/tmp/kun.json',
    showTurnCompleteNotification: vi.fn() as never,
    getAppVersion: () => '0.1.0',
    readGuiUpdateState: vi.fn() as never,
    loadGuiUpdaterModule: vi.fn() as never,
    resolveLogDirectory: () => '/tmp/logs',
    logError: vi.fn(),
    claude360AuthService: {
      getSession: vi.fn(async () => ({ loggedIn: false, username: '', displayName: '', baseUrl: 'https://claude360.xyz' })),
      startDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn(),
      passwordLogin: vi.fn(),
      passwordLogin2FA: vi.fn(),
      logout: vi.fn(),
      syncAccount: vi.fn()
    } as never,
    claude360TokenService: {
      listTokens: vi.fn(async () => []),
      ensureGroupToken: vi.fn(),
      createToken: vi.fn(),
      revealToken: vi.fn(async () => 'sk-x')
    } as never,
    claude360ModelService: {
      refreshGroupsAndModels: vi.fn(async () => ({ modelCache: { groups: [], models: [] }, providerProfiles: [] }))
    } as never,
    claude360BillingService: {
      getMe: vi.fn(),
      getTopupOptions: vi.fn(),
      createWechatTopup: vi.fn(),
      getTopupOrder: vi.fn(),
      getTokenStats: vi.fn()
    } as never,
    claude360MusicService: {
      submitMusic: vi.fn(async () => ({ ok: true, taskId: 'T-1' })),
      fetchMusic: vi.fn(async () => ({ ok: true, task: { taskId: 'T-1', status: 'success', songs: [] } }))
    } as never,
    claude360CanvasService: {
      generateImages: vi.fn(async () => ({ ok: true, images: [] })),
      editImage: vi.fn(async () => ({ ok: true, images: [] }))
    } as never,
    ...overrides
  }
}

describe('registerAppIpcHandlers', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('rejects invalid settings patches at the handler boundary', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    expect(handler).toBeTypeOf('function')
    await expect(
      handler?.({}, { agents: { kun: { mysteryFlag: true } } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('passes valid settings patches through to applySettingsPatch', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      theme: 'dark' as const,
      agents: {
        kun: {
          port: 19000
        }
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('accepts checkpoint cleanup settings patches', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      checkpointCleanup: {
        intervalDays: 5
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('rejects unsupported checkpoint cleanup intervals', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const handler = handlers.get('settings:set')
    await expect(
      handler?.({}, { checkpointCleanup: { intervalDays: 4 } })
    ).rejects.toThrow(/Invalid payload for settings:set/)
    expect(applySettingsPatch).not.toHaveBeenCalled()
  })

  it('accepts telegram phone connection settings patches', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      claw: {
        enabled: true,
        im: { enabled: true, workspaceRoot: '' },
        channels: [{
          id: 'telegram_1',
          provider: 'telegram' as const,
          label: 'telegram agent',
          enabled: true,
          model: 'auto',
          threadId: '',
          workspaceRoot: '',
          agentProfile: {
            name: 'telegram agent',
            description: '',
            identity: '',
            personality: '',
            userContext: '',
            replyRules: ''
          },
          platformCredential: {
            kind: 'telegram' as const,
            botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
            allowedChatIds: '123456789',
            botUsername: 'kun_test_bot',
            createdAt: '2026-06-19T00:00:00.000Z'
          },
          conversations: [],
          createdAt: '2026-06-19T00:00:00.000Z',
          updatedAt: '2026-06-19T00:00:00.000Z'
        }]
      }
    }

    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('restarts the managed runtime through the restart IPC handler', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const restartRuntime = vi.fn(async () => undefined)

    registerAppIpcHandlers(registerOptions({ restartRuntime }))

    await expect(handlers.get('runtime:restart')?.({})).resolves.toBeUndefined()
    expect(restartRuntime).toHaveBeenCalledTimes(1)
  })

  it('saves generated files to a user-selected path', async () => {
    const { dialog } = await import('electron')
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const temp = mkdtempSync(join(tmpdir(), 'kun-save-as-'))
    const source = join(temp, 'source.png')
    const target = join(temp, 'downloaded.png')
    writeFileSync(source, 'generated-image')
    ;(dialog as unknown as { showSaveDialog: ReturnType<typeof vi.fn> }).showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: target
    }))

    try {
      registerAppIpcHandlers(registerOptions())

      const handler = handlers.get('file:save-as')
      await expect(handler?.({}, {
        sourcePath: source,
        suggestedName: 'source.png',
        mimeType: 'image/png'
      })).resolves.toEqual({ ok: true, path: target })
      expect(readFileSync(target, 'utf8')).toBe('generated-image')
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('accepts the full settings snapshot emitted by SettingsView auto-apply', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = { ...settings(), locale: 'zh' as const }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('passes schedule settings patches through to applySettingsPatch', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async (partial: AppSettingsPatch) => ({
      ...settings(),
      schedule: mergeScheduleSettings(settings().schedule, partial.schedule)
    }))

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{
          id: 'task-1',
          title: 'Daily',
          enabled: true,
          prompt: 'Run',
          schedule: { kind: 'manual' as const }
        }]
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toMatchObject({
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{ id: 'task-1', prompt: 'Run' }]
      }
    })
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('writes MCP config JSON and notifies the runtime apply hook', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)
    const content = `${JSON.stringify({
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
        }
      }
    }, null, 2)}\n`

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('kun:config:write')?.({}, content)).resolves.toEqual({
        ok: true,
        path: configPath
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(onKunMcpConfigWritten).toHaveBeenCalledWith(configPath, content)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid MCP config JSON before writing or applying it', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('kun:config:write')?.({}, '{')).rejects.toThrow(
        /MCP config must be JSON/
      )
      await expect(handlers.get('kun:config:write')?.({}, '[]')).rejects.toThrow(
        /MCP config must be a JSON object/
      )
      expect(existsSync(configPath)).toBe(false)
      expect(onKunMcpConfigWritten).not.toHaveBeenCalled()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('uses the GUI-managed WeChat bridge for WeChat install handlers', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const configuredSettings = settings()
    configuredSettings.claw.im.weixinBridgeUrl = 'http://127.0.0.1:18787/rpc'
    const store = { load: vi.fn(async () => configuredSettings) }
    const startWeixinInstallQrcode = vi.fn(async () => ({
      ok: false as const,
      message: 'expected test response'
    }))
    const pollWeixinInstall = vi.fn(async () => ({ done: false as const }))

    registerAppIpcHandlers(registerOptions({
      store: store as never,
      startWeixinInstallQrcode,
      pollWeixinInstall
    }))

    await expect(
      handlers.get('claw:im-install:qrcode')?.({}, { provider: 'weixin' })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      handlers.get('claw:im-install:poll')?.({}, { provider: 'weixin', deviceCode: 'device-1' })
    ).resolves.toEqual({ done: false })

    expect(startWeixinInstallQrcode).toHaveBeenCalledWith()
    expect(pollWeixinInstall).toHaveBeenCalledWith('device-1')
  })

  it('routes schedule task IPC calls to the Schedule runtime', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const scheduleRuntime = {
      status: vi.fn(async () => ({
        internalServerRunning: true,
        internalUrl: 'http://127.0.0.1:18788',
        runningTaskIds: ['task-1'],
        powerSaveBlockerActive: true
      })),
      runTask: vi.fn(async (taskId: string) => ({ ok: true as const, taskId, message: 'Started' })),
      createScheduledTaskFromText: vi.fn(async () => ({
        kind: 'created' as const,
        taskId: 'task-2',
        title: 'Reminder',
        scheduleAt: '2026-06-03T09:00:00.000+08:00',
        confirmationText: 'Scheduled.'
      }))
    }
    registerAppIpcHandlers(registerOptions({
      getScheduleRuntime: () => scheduleRuntime as never
    }))

    await expect(handlers.get('schedule:status')?.({})).resolves.toMatchObject({
      internalServerRunning: true,
      runningTaskIds: ['task-1'],
      powerSaveBlockerActive: true
    })
    await expect(handlers.get('schedule:task:run')?.({}, 'task-1')).resolves.toMatchObject({
      ok: true,
      taskId: 'task-1'
    })
    await expect(
      handlers.get('schedule:task:create-from-text')?.({}, {
        text: 'Remind me tomorrow.',
        workspaceRoot: '/tmp/schedule',
        clawChannelId: 'channel-1',
        modelHint: 'deepseek-v4-flash',
        mode: 'plan'
      })
    ).resolves.toMatchObject({
      kind: 'created',
      taskId: 'task-2'
    })

    expect(scheduleRuntime.runTask).toHaveBeenCalledWith('task-1')
    expect(scheduleRuntime.createScheduledTaskFromText).toHaveBeenCalledWith('Remind me tomorrow.', {
      workspaceRoot: '/tmp/schedule',
      clawChannelId: 'channel-1',
      modelHint: 'deepseek-v4-flash',
      mode: 'plan'
    })
  })

  it('routes desktop command IPC calls to the focused window and web contents', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const webContents = {
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      reload: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
      toggleDevTools: vi.fn()
    }
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents,
      minimize: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn()
    }

    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => mainWindow as never
    }))

    const handler = handlers.get('desktop:command')
    await handler?.({ sender: webContents }, 'copy')
    await handler?.({ sender: webContents }, 'zoomIn')
    await handler?.({ sender: webContents }, 'toggleMaximize')
    await handler?.({ sender: webContents }, 'close')

    expect(webContents.copy).toHaveBeenCalledTimes(1)
    expect(webContents.setZoomLevel).toHaveBeenCalledWith(1)
    expect(mainWindow.maximize).toHaveBeenCalledTimes(1)
    expect(mainWindow.close).toHaveBeenCalledTimes(1)
  })

  it('creates a unique conversation workspace, suffixing on timestamp collision', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const root = mkdtempSync(join(tmpdir(), 'kun-conv-'))
    try {
      registerAppIpcHandlers(registerOptions({
        store: { load: vi.fn(async () => ({ ...settings(), conversationWorkspaceRoot: root })) } as never
      }))

      const handler = handlers.get('conversation:create-workspace')
      expect(handler).toBeTypeOf('function')

      const first = await handler?.({}) as { ok: boolean; path: string }
      const second = await handler?.({}) as { ok: boolean; path: string }

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      // 两次创建即使落在同一秒,目录路径也必须不同,否则会静默共用目录。
      expect(first.path).not.toBe(second.path)
      expect(existsSync(first.path)).toBe(true)
      expect(existsSync(second.path)).toBe(true)
      expect(first.path.startsWith(root)).toBe(true)
      expect(second.path.startsWith(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('claude360 auth IPC handlers', () => {
  beforeEach(() => {
    handlers.clear()
  })

  function authServiceMock(overrides: Record<string, unknown> = {}) {
    return {
      getSession: vi.fn(),
      startDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn(),
      passwordLogin: vi.fn(),
      passwordLogin2FA: vi.fn(),
      logout: vi.fn(),
      syncAccount: vi.fn(),
      ...overrides
    } as never
  }

  it('routes claude360:session to the auth service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const getSession = vi.fn(async () => ({
      loggedIn: true,
      username: 'demo',
      displayName: 'Demo',
      baseUrl: 'https://claude360.xyz'
    }))
    registerAppIpcHandlers(registerOptions({ claude360AuthService: authServiceMock({ getSession }) }))
    const handler = handlers.get('claude360:session')
    expect(await handler?.({})).toMatchObject({ loggedIn: true, username: 'demo' })
    expect(getSession).toHaveBeenCalled()
  })

  it('validates the password login payload and forwards valid input', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const passwordLogin = vi.fn(async () => ({ ok: false, message: 'x' }))
    registerAppIpcHandlers(registerOptions({ claude360AuthService: authServiceMock({ passwordLogin }) }))
    const handler = handlers.get('claude360:auth:password-login')
    await expect(handler?.({}, { username: 'demo' })).rejects.toThrow(/Invalid payload/)
    expect(passwordLogin).not.toHaveBeenCalled()
    await handler?.({}, { username: 'demo', password: 'pw' })
    expect(passwordLogin).toHaveBeenCalledWith({ username: 'demo', password: 'pw' })
  })

  it('rejects an empty device code on poll', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const pollDeviceAuth = vi.fn()
    registerAppIpcHandlers(registerOptions({ claude360AuthService: authServiceMock({ pollDeviceAuth }) }))
    const handler = handlers.get('claude360:auth:poll-device')
    await expect(handler?.({}, { deviceCode: '' })).rejects.toThrow(/Invalid payload/)
    expect(pollDeviceAuth).not.toHaveBeenCalled()
  })
})

describe('claude360 token/model/billing IPC handlers', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('validates create-token payload and forwards to the token service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const createToken = vi.fn(async () => ({ tokenId: 1, name: 'x', group: 'auto' }))
    registerAppIpcHandlers(
      registerOptions({
        claude360TokenService: { listTokens: vi.fn(), ensureGroupToken: vi.fn(), createToken, revealToken: vi.fn() } as never
      })
    )
    const handler = handlers.get('claude360:tokens:create')
    await expect(handler?.({}, { name: '' })).rejects.toThrow(/Invalid payload/) // 空名非法
    expect(createToken).not.toHaveBeenCalled()
    await handler?.({}, { name: 'My Key', group: 'auto' })
    expect(createToken).toHaveBeenCalledWith('auto', 'My Key')
  })

  it('rejects a non-positive token id on reveal', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const revealToken = vi.fn(async () => 'sk-x')
    registerAppIpcHandlers(
      registerOptions({
        claude360TokenService: { listTokens: vi.fn(), ensureGroupToken: vi.fn(), createToken: vi.fn(), revealToken } as never
      })
    )
    const handler = handlers.get('claude360:tokens:reveal')
    await expect(handler?.({}, { tokenId: 0 })).rejects.toThrow(/Invalid payload/)
    expect(revealToken).not.toHaveBeenCalled()
  })

  it('models:refresh persists provider profiles and model cache', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const applySettingsPatch = vi.fn(async (_patch: unknown) => settings())
    const refreshGroupsAndModels = vi.fn(async () => ({
      modelCache: { groups: ['auto'], models: ['m1'] },
      providerProfiles: [{ id: 'claude360:auto' }],
      groupsByPurpose: { text: [{ name: 'auto', recommended: true }], image: [], music: [] }
    }))
    registerAppIpcHandlers(
      registerOptions({
        applySettingsPatch,
        claude360ModelService: { refreshGroupsAndModels } as never
      })
    )
    const handler = handlers.get('claude360:models:refresh')
    const result = await handler?.({})
    expect(refreshGroupsAndModels).toHaveBeenCalled()
    const patch = applySettingsPatch.mock.calls[0]?.[0] as {
      provider: { providers: Array<{ id: string }> }
      claude360: Record<string, unknown>
    }
    // 架构收口：刷新落盘只保留 Claude360 自动 provider，不再携带旧自定义/DeepSeek provider。
    expect(patch.provider.providers).toEqual([
      expect.objectContaining({ id: 'claude360:auto', apiKey: '' })
    ])
    // 分组持久化：text 当前选择 auto 仍有效则保留；image/music 无分组保持空。
    expect(patch.claude360).toEqual({
      modelCache: { groups: ['auto'], models: ['m1'] },
      selectedTextGroup: 'auto',
      selectedImageGroup: '',
      selectedMusicGroup: ''
    })
    expect(result).toMatchObject({ ok: true })
  })

  it('upstream:models refreshes Claude360 groups when the logged-in model cache is empty', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    let current: AppSettingsV1 = {
      ...settings(),
      claude360: {
        ...defaultClaude360Settings(),
        loggedIn: true,
        cliTokenRef: 'claude360:cli-token',
        modelCache: { groups: [] as string[], models: [] as string[] }
      }
    }
    const store = { load: vi.fn(async () => current) }
    const applySettingsPatch = vi.fn(async (patch: AppSettingsPatch) => {
      current = {
        ...current,
        provider: {
          ...current.provider,
          ...(patch.provider?.providers ? { providers: patch.provider.providers as AppSettingsV1['provider']['providers'] } : {})
        },
        claude360: {
          ...current.claude360,
          ...(patch.claude360 ?? {}),
          modelCache: {
            ...current.claude360.modelCache,
            ...(patch.claude360?.modelCache ?? {})
          }
        }
      }
      return current
    })
    const refreshGroupsAndModels = vi.fn(async () => ({
      modelCache: { groups: ['Codex'], models: ['gpt-5.5'] },
      providerProfiles: [
        {
          id: 'claude360:Codex',
          name: 'Codex',
          apiKey: '',
          baseUrl: 'https://claude360.xyz/v1',
          endpointFormat: 'chat_completions',
          models: ['gpt-5.5'],
          modelProfiles: {
            'gpt-5.5': {
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text']
            }
          }
        }
      ],
      groupsByPurpose: { text: [{ name: 'Codex', recommended: true }], image: [], music: [] }
    }))
    const fetchUpstreamModels = vi.fn(async () => ({
      ok: true as const,
      modelIds: current.claude360.modelCache.models,
      modelGroups: current.provider.providers
        .filter((provider) => provider.id.startsWith('claude360'))
        .map((provider) => ({
          providerId: provider.id,
          label: provider.name,
          modelIds: provider.models
        }))
    }))

    registerAppIpcHandlers(
      registerOptions({
        store: store as never,
        applySettingsPatch,
        fetchUpstreamModels,
        claude360ModelService: { refreshGroupsAndModels } as never
      })
    )

    const handler = handlers.get('upstream:models')
    const result = await handler?.({})

    expect(refreshGroupsAndModels).toHaveBeenCalled()
    expect(applySettingsPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        claude360: expect.objectContaining({
          modelCache: { groups: ['Codex'], models: ['gpt-5.5'] },
          selectedTextGroup: 'Codex'
        })
      })
    )
    expect(fetchUpstreamModels).toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      modelIds: ['gpt-5.5'],
      modelGroups: [expect.objectContaining({ label: 'Codex', modelIds: ['gpt-5.5'] })]
    })
  })

  it('forwards token stats payload to the billing service', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const getTokenStats = vi.fn(async () => [])
    registerAppIpcHandlers(
      registerOptions({
        claude360BillingService: { getMe: vi.fn(), getTopupOptions: vi.fn(), createWechatTopup: vi.fn(), getTopupOrder: vi.fn(), getTokenStats } as never
      })
    )
    const handler = handlers.get('claude360:billing:token-stats')
    await handler?.({}, { startTimestamp: 100, endTimestamp: 200 })
    expect(getTokenStats).toHaveBeenCalledWith({ startTimestamp: 100, endTimestamp: 200 })
  })
})

describe('claude360 music IPC handlers', () => {
  beforeEach(() => {
    handlers.clear()
  })

  function musicServiceMock(overrides: Record<string, unknown> = {}) {
    return {
      submitMusic: vi.fn(async () => ({ ok: true, taskId: 'T-1' })),
      fetchMusic: vi.fn(async () => ({ ok: true, task: { taskId: 'T-1', status: 'success', songs: [] } })),
      ...overrides
    } as never
  }

  it('validates the submit payload and forwards to submitMusic', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const submitMusic = vi.fn(async () => ({ ok: true, taskId: 'T-9' }))
    registerAppIpcHandlers(registerOptions({ claude360MusicService: musicServiceMock({ submitMusic }) }))
    const handler = handlers.get('claude360:music:submit')
    expect(handler).toBeTypeOf('function')
    // 无 prompt 且非 instrumental → 非法，拦在 handler 边界。
    await expect(handler?.({}, { model: 'V5_5', custom_mode: false })).rejects.toThrow(/Invalid payload/)
    expect(submitMusic).not.toHaveBeenCalled()
    // 合法请求转发。
    await expect(handler?.({}, { prompt: '轻快的舞曲', model: 'V5_5', custom_mode: false })).resolves.toMatchObject({
      ok: true,
      taskId: 'T-9'
    })
    expect(submitMusic).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '轻快的舞曲', model: 'V5_5' })
    )
  })

  it('validates the fetch payload and forwards to fetchMusic', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const fetchMusic = vi.fn(async () => ({ ok: true, task: { taskId: 'T-9', status: 'success', songs: [] } }))
    registerAppIpcHandlers(registerOptions({ claude360MusicService: musicServiceMock({ fetchMusic }) }))
    const handler = handlers.get('claude360:music:fetch')
    await expect(handler?.({}, { taskId: '' })).rejects.toThrow(/Invalid payload/)
    expect(fetchMusic).not.toHaveBeenCalled()
    await handler?.({}, { taskId: 'T-9' })
    expect(fetchMusic).toHaveBeenCalledWith('T-9')
  })

  it('converts unexpected service errors into a unified error result on submit', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const submitMusic = vi.fn(async () => {
      throw new Error('boom')
    })
    registerAppIpcHandlers(registerOptions({ claude360MusicService: musicServiceMock({ submitMusic }) }))
    const handler = handlers.get('claude360:music:submit')
    await expect(
      handler?.({}, { prompt: 'x', model: 'V5_5', custom_mode: false })
    ).resolves.toMatchObject({ ok: false })
  })

  it('converts unexpected service errors into a unified error result on fetch', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const fetchMusic = vi.fn(async () => {
      throw new Error('boom')
    })
    registerAppIpcHandlers(registerOptions({ claude360MusicService: musicServiceMock({ fetchMusic }) }))
    const handler = handlers.get('claude360:music:fetch')
    await expect(handler?.({}, { taskId: 'T-9' })).resolves.toMatchObject({ ok: false })
  })
})

describe('claude360 canvas IPC handlers', () => {
  beforeEach(() => {
    handlers.clear()
  })

  function canvasServiceMock(overrides: Record<string, unknown> = {}) {
    return {
      generateImages: vi.fn(async () => ({ ok: true, images: [] })),
      editImage: vi.fn(async () => ({ ok: true, images: [] })),
      ...overrides
    } as never
  }

  it('validates the generate payload and forwards to generateImages', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const generateImages = vi.fn(async () => ({ ok: true, images: [{ id: 'i1', source: 'url', url: 'https://cdn/a.png', mimeType: 'image/png', prompt: 'p', model: 'm', createdAt: 'now' }] }))
    registerAppIpcHandlers(registerOptions({ claude360CanvasService: canvasServiceMock({ generateImages }) }))
    const handler = handlers.get('claude360:canvas:generate')
    expect(handler).toBeTypeOf('function')
    // 无 prompt → 非法，拦在 handler 边界。
    await expect(handler?.({}, { model: 'gpt-image-1' })).rejects.toThrow(/Invalid payload/)
    expect(generateImages).not.toHaveBeenCalled()
    // 合法请求转发。
    await expect(
      handler?.({}, { model: 'gpt-image-1', prompt: '一只柯基', size: '1024x1024', n: 2 })
    ).resolves.toMatchObject({ ok: true })
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1', prompt: '一只柯基', size: '1024x1024', n: 2 })
    )
  })

  it('validates the edit payload and forwards to editImage', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const editImage = vi.fn(async () => ({ ok: true, images: [] }))
    registerAppIpcHandlers(registerOptions({ claude360CanvasService: canvasServiceMock({ editImage }) }))
    const handler = handlers.get('claude360:canvas:edit')
    // 缺 image → 非法。
    await expect(handler?.({}, { model: 'm', prompt: 'x' })).rejects.toThrow(/Invalid payload/)
    expect(editImage).not.toHaveBeenCalled()
    await handler?.({}, { model: 'm', prompt: '把帽子改成红色', image: 'data:image/png;base64,QUJD' })
    expect(editImage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'm', prompt: '把帽子改成红色', image: 'data:image/png;base64,QUJD' })
    )
  })

  it('converts unexpected service errors into a unified error result on generate', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const generateImages = vi.fn(async () => {
      throw new Error('boom')
    })
    registerAppIpcHandlers(registerOptions({ claude360CanvasService: canvasServiceMock({ generateImages }) }))
    const handler = handlers.get('claude360:canvas:generate')
    await expect(
      handler?.({}, { model: 'm', prompt: 'x' })
    ).resolves.toMatchObject({ ok: false })
  })

  it('converts unexpected service errors into a unified error result on edit', async () => {
    const { registerAppIpcHandlers } = await import('./register-app-ipc-handlers')
    const editImage = vi.fn(async () => {
      throw new Error('boom')
    })
    registerAppIpcHandlers(registerOptions({ claude360CanvasService: canvasServiceMock({ editImage }) }))
    const handler = handlers.get('claude360:canvas:edit')
    await expect(
      handler?.({}, { model: 'm', prompt: 'x', image: 'QUJD' })
    ).resolves.toMatchObject({ ok: false })
  })
})
