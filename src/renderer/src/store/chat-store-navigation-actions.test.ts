import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type i18next from 'i18next'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { AppRoute, ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

const applyThemeLibMock = vi.hoisted(() => ({
  applyCursorSpotlight: vi.fn(),
  applyCursorSpotlightColor: vi.fn(),
  applyTheme: vi.fn(),
  applyUiFontScale: vi.fn(),
  applyChatContentMaxWidth: vi.fn(),
  applyDocumentLocale: vi.fn()
}))

vi.mock('../lib/apply-theme', () => applyThemeLibMock)

import { createNavigationActions } from './chat-store-navigation-actions'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-12T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

function buildHarness(overrides?: {
  subscribeThreadEventsLive?: ReturnType<typeof vi.fn>
  recoverActiveTurn?: ReturnType<typeof vi.fn>
  applyI18nFromSettings?: ReturnType<typeof vi.fn>
  probeRuntime?: ReturnType<typeof vi.fn>
  loadComposerModels?: ReturnType<typeof vi.fn>
}): {
  actions: ReturnType<typeof createNavigationActions>
  state: ChatState
  createThread: ReturnType<typeof vi.fn>
  refreshThreads: ReturnType<typeof vi.fn>
  selectThread: ReturnType<typeof vi.fn>
  subscribeThreadEventsLive: ReturnType<typeof vi.fn>
  recoverActiveTurn: ReturnType<typeof vi.fn>
} {
  const createThread = vi.fn(async () => undefined)
  const refreshThreads = vi.fn(async () => undefined)
  const selectThread = vi.fn(async () => undefined)
  const subscribeThreadEventsLive = overrides?.subscribeThreadEventsLive ?? vi.fn(async () => undefined)
  const recoverActiveTurn = overrides?.recoverActiveTurn ?? vi.fn(async () => true)
  const applyI18nFromSettings = overrides?.applyI18nFromSettings ?? vi.fn(async () => undefined)
  const probeRuntime = overrides?.probeRuntime ?? vi.fn(async () => undefined)
  const loadComposerModels = overrides?.loadComposerModels ?? vi.fn(async () => undefined)
  let state = {
    activeThreadId: 'thr_default',
    applyI18nFromSettings,
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: ['~/.kun/default_workspace'],
    composerPickList: [],
    createThread,
    currentTurnId: null,
    currentTurnUserId: null,
    error: null,
    loadComposerModels,
    openWrite: vi.fn(async () => undefined),
    probeRuntime,
    refreshThreads,
    route: 'chat',
    runtimeConnection: 'ready',
    selectThread,
    subscribeThreadEventsLive,
    recoverActiveTurn,
    threads: [
      thread({
        id: 'thr_default',
        title: 'Only default thread',
        workspace: '~/.kun/default_workspace'
      })
    ],
    unreadThreadIds: {},
    watchTurnCompletion: {},
    workspaceLabel: 'default_workspace',
    workspaceRoot: '~/.kun/default_workspace'
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...update }
  }
  const get: ChatStoreGet = () => state
  return {
    actions: createNavigationActions({
      set,
      get,
      sseAbortRef: { current: null }
    }),
    get state() {
      return state
    },
    createThread,
    refreshThreads,
    selectThread,
    subscribeThreadEventsLive,
    recoverActiveTurn
  }
}

describe('chat-store navigation workspace selection', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not move the only default thread into a newly picked empty workspace', async () => {
    const provider = {
      updateThreadWorkspace: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const pickWorkspaceDirectory = vi.fn(async () => ({
      canceled: false,
      path: '/Users/zxy/new-project'
    }))
    const setSettings = vi.fn(async () => ({
      workspaceRoot: '/Users/zxy/new-project'
    }))
    vi.stubGlobal('window', {
      kunGui: {
        pickWorkspaceDirectory,
        setSettings
      }
    })
    const harness = buildHarness()

    await expect(harness.actions.chooseWorkspace()).resolves.toBe('/Users/zxy/new-project')

    expect(pickWorkspaceDirectory).toHaveBeenCalledWith('~/.kun/default_workspace')
    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(provider.updateThreadWorkspace).not.toHaveBeenCalled()
    expect(harness.state.threads.find((item) => item.id === 'thr_default')?.workspace)
      .toBe('~/.kun/default_workspace')
    expect(harness.createThread).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.selectThread).not.toHaveBeenCalled()
  })

  it('selectWorkspaceRoot persists the directory and lands on a clean new conversation', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '/Users/zxy/new-project' }))
    vi.stubGlobal('window', { kunGui: { setSettings } })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('/Users/zxy/new-project'))
      .resolves.toBe('/Users/zxy/new-project')

    expect(setSettings).toHaveBeenCalledWith({ workspaceRoot: '/Users/zxy/new-project' })
    expect(harness.state.workspaceRoot).toBe('/Users/zxy/new-project')
    expect(harness.state.workspaceLabel).toBe('new-project')
    // Clean empty-hero state so typing starts a fresh thread in the new directory.
    expect(harness.state.activeThreadId).toBeNull()
    expect(harness.state.blocks).toEqual([])
    expect(harness.state.codeWorkspaceRoots).toContain('/Users/zxy/new-project')
    expect(harness.refreshThreads).toHaveBeenCalled()
    // The default thread is preserved in the listing, just not active.
    expect(harness.selectThread).not.toHaveBeenCalled()
    expect(harness.createThread).not.toHaveBeenCalled()
  })

  it('selectWorkspaceRoot ignores an empty path', async () => {
    const setSettings = vi.fn(async () => ({ workspaceRoot: '' }))
    vi.stubGlobal('window', { kunGui: { setSettings } })
    const harness = buildHarness()

    await expect(harness.actions.selectWorkspaceRoot('   ')).resolves.toBeNull()
    expect(setSettings).not.toHaveBeenCalled()
    expect(harness.state.activeThreadId).toBe('thr_default')
  })
})

describe('onClawChannelActivity routes through subscribeThreadEventsLive (not selectThread)', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('calls subscribeThreadEventsLive when activeThreadId differs from the bot thread', async () => {
    const subscribeThreadEventsLive = vi.fn(async () => undefined)
    const selectThread = vi.fn(async () => undefined)
    const recoverActiveTurn = vi.fn(async () => true)

    // Capture the callback registered via window.kunGui.onClawChannelActivity
    let capturedClawActivityCallback: ((payload: { channelId: string; threadId: string }) => void) | null = null
    const onClawChannelActivity = vi.fn((cb: (payload: { channelId: string; threadId: string }) => void) => {
      capturedClawActivityCallback = cb
      return () => {}
    })
    const onRuntimeStatus = vi.fn(() => () => {})
    let capturedTrayActionCallback: ((payload: { type: 'new-chat' } | { type: 'open-thread'; threadId: string }) => void) | null = null
    const onTrayAction = vi.fn((cb: typeof capturedTrayActionCallback) => {
      capturedTrayActionCallback = cb
      return () => {}
    })
    const getSettings = vi.fn(async () => ({
      workspaceRoot: '~/.kun/default_workspace',
      write: {
        defaultWorkspaceRoot: '~/.kun/default_workspace',
        activeWorkspaceRoot: '~/.kun/default_workspace',
        workspaces: []
      },
      claw: {
        channels: [
          { id: 'ch_1', enabled: true, label: 'Feishu Agent01', provider: 'feishu' }
        ]
      },
      theme: 'dark',
      uiFontScale: 1,
    chatContentMaxWidthPx: 896,
      locale: 'en',
      agents: { kun: { apiKey: 'test-key', model: 'deepseek-v4-pro', baseUrl: '' } },
      claude360: { loggedIn: true },
      disabledSkillIds: []
    }))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings,
        onClawChannelActivity,
        onTrayAction,
        onRuntimeStatus
      }
    })

    const harness = buildHarness({ subscribeThreadEventsLive, recoverActiveTurn })
    await harness.actions.boot()
    expect(typeof capturedClawActivityCallback).toBe('function')
    expect(onClawChannelActivity).toHaveBeenCalledTimes(1)
    expect(onTrayAction).toHaveBeenCalledTimes(1)

    harness.state.route = 'settings'
    capturedTrayActionCallback!({ type: 'open-thread', threadId: 'thr_recent' })
    expect(harness.state.route).toBe('chat')
    expect(harness.selectThread).toHaveBeenCalledWith('thr_recent')

    harness.state.route = 'settings'
    capturedTrayActionCallback!({ type: 'new-chat' })
    expect(harness.state.route).toBe('chat')
    expect(harness.createThread).toHaveBeenCalledWith({ forceNew: true })

    // Set state conditions AFTER boot so they survive the boot's set() calls:
    // route is claw, activeClawChannelId matches incoming channelId,
    // activeThreadId differs from incoming threadId — so we should auto-switch.
    harness.state.route = 'claw'
    harness.state.activeClawChannelId = 'ch_1'
    harness.state.activeThreadId = 'thr_default'

    // Trigger the captured callback with a Feishu bot event.
    await capturedClawActivityCallback!({ channelId: 'ch_1', threadId: 'thr_bot' })
    // Allow the void(async()) microtask inside the callback to flush.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(subscribeThreadEventsLive).toHaveBeenCalledWith('thr_bot')
    expect(selectThread).not.toHaveBeenCalled()
  })

  it('requires initial setup when the local Claude360 secret is missing despite stale logged-in settings', async () => {
    const onRuntimeStatus = vi.fn(() => () => {})
    const onTrayAction = vi.fn(() => () => {})
    const onClawChannelActivity = vi.fn(() => () => {})
    const claude360Session = vi.fn(async () => ({
      loggedIn: false,
      username: 'demo',
      displayName: 'Demo',
      baseUrl: 'https://claude360.xyz',
      message: '由于安全存储方式已更新，请重新登录 Claude360'
    }))
    const getSettings = vi.fn(async () => ({
      workspaceRoot: '~/.kun/default_workspace',
      write: {
        defaultWorkspaceRoot: '~/.kun/default_workspace',
        activeWorkspaceRoot: '~/.kun/default_workspace',
        workspaces: []
      },
      claw: { channels: [] },
      theme: 'dark',
      uiFontScale: 1,
      chatContentMaxWidthPx: 896,
      locale: 'en',
      agents: { kun: { apiKey: 'test-key', model: 'deepseek-v4-pro', baseUrl: '' } },
      claude360: { loggedIn: true },
      disabledSkillIds: []
    }))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings,
        claude360Session,
        onClawChannelActivity,
        onTrayAction,
        onRuntimeStatus
      }
    })

    const probeRuntime = vi.fn(async () => undefined)
    const harness = buildHarness({ probeRuntime })
    await harness.actions.boot()

    expect(claude360Session).toHaveBeenCalledTimes(1)
    expect(harness.state.initialSetupOpen).toBe(true)
    expect(harness.state.initialSetupMessage).toBe('由于安全存储方式已更新，请重新登录 Claude360')
    expect(harness.state.runtimeConnection).toBe('idle')
    expect(probeRuntime).not.toHaveBeenCalled()
  })
})

// 「我的」页路由:setRoute('my') 合法,且从「我的」页打开设置再返回时
// settingsReturnRoute 记录到 'my'(codex plan-03 Task 6 Step 1)。
function buildRouteHarness(initialRoute: AppRoute = 'chat'): {
  actions: ReturnType<typeof createAppActions>
  state: ChatState
} {
  const state = {
    route: initialRoute,
    settingsReturnRoute: 'chat',
    settingsSection: 'general',
    activeThreadId: null,
    threads: [],
    composerMode: 'agent',
    composerModel: '',
    composerProviderId: '',
    composerModelGroups: []
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  return {
    state,
    actions: createAppActions({
      set,
      get,
      i18n: { t: (key: string) => key, changeLanguage: vi.fn(async () => undefined) } as unknown as typeof i18next,
      persistComposerModel: () => undefined,
      persistComposerMode: () => undefined,
      rememberThreadComposerMode: () => undefined,
      readStoredComposerModel: () => '',
      mergeComposerPickList: () => [],
      fallbackComposerModel: () => '',
      getComposerModelLoadPromise: () => null,
      setComposerModelLoadPromise: () => undefined,
      applyTheme: () => undefined,
      applyUiFontScale: () => undefined,
      applyChatContentMaxWidth: () => undefined,
      applyCursorSpotlight: () => undefined,
      applyCursorSpotlightColor: () => undefined,
      applyWriteTypography: () => undefined,
      applyDocumentLocale: () => undefined,
      workspaceLabelFromPath: (workspaceRoot) => workspaceRoot,
      normalizeWorkspaceRoot: (workspaceRoot) => workspaceRoot?.trim() ?? ''
    })
  }
}

describe('「我的」页路由', () => {
  it('setRoute(\'my\') 让 route 变为合法的 \'my\'', () => {
    const { actions, state } = buildRouteHarness('chat')
    actions.setRoute('my')
    expect(state.route).toBe('my')
  })

  it('从「我的」页打开设置时把 settingsReturnRoute 记录为 \'my\'', () => {
    const { actions, state } = buildRouteHarness('my')
    actions.openSettings('general')
    expect(state.route).toBe('settings')
    expect(state.settingsReturnRoute).toBe('my')
    // 返回时用记录的来源路由即可回到「我的」页。
    actions.setRoute(state.settingsReturnRoute)
    expect(state.route).toBe('my')
  })
})

// 新增主路由 music/canvas 由 plan-05/06 交付页面,本簇只保证 route 合法。
describe('music/canvas 路由合法性(plan-04 Task4)', () => {
  it.each(['my', 'music', 'canvas'] as const)('setRoute(\'%s\') 让 route 变为对应合法值', (route) => {
    const { actions, state } = buildRouteHarness('chat')
    actions.setRoute(route)
    expect(state.route).toBe(route)
  })

  it('打开 music 再返回 chat 不丢失既有 state(plan-05 Task7)', () => {
    const { actions, state } = buildRouteHarness('chat')
    state.composerModel = 'claude360-sonnet'
    actions.setRoute('music')
    expect(state.route).toBe('music')
    actions.setRoute('chat')
    expect(state.route).toBe('chat')
    // 切走再切回不应清空其他编排字段
    expect(state.composerModel).toBe('claude360-sonnet')
  })
})

// plan-05/06 Task7：Workbench 在 route==='music' 时渲染 MusicWorkbench，
// 在 route==='canvas' 时渲染 CanvasWorkbench（均懒加载）。
// 在 node 里整体渲染重型 Workbench 不现实，故：
// 1) 断言目标组件模块可用（懒加载目标有效）；
// 2) 用 Vite 的 ?raw 内联 Workbench 源码断言接线（不依赖 node:fs）。
import WorkbenchSource from '../components/Workbench.tsx?raw'

describe('Workbench 音乐/生图路由接线(plan-05/06 Task7)', () => {
  it('MusicWorkbench 组件模块可用(懒加载目标有效)', async () => {
    const mod = await import('../components/music/MusicWorkbench')
    expect(typeof mod.MusicWorkbench).toBe('function')
  })
  it('CanvasWorkbench 组件模块可用(懒加载目标有效)', async () => {
    const mod = await import('../components/canvas/CanvasWorkbench')
    expect(typeof mod.CanvasWorkbench).toBe('function')
  })
  it('懒加载 MusicWorkbench 并在 music 路由渲染', () => {
    expect(WorkbenchSource).toContain("import('./music/MusicWorkbench')")
    expect(WorkbenchSource).toMatch(/route === 'music'[\s\S]*?<MusicWorkbench/)
  })
  it('懒加载 CanvasWorkbench 并在 canvas 路由渲染(plan-06 Task6)', () => {
    expect(WorkbenchSource).toContain("import('./canvas/CanvasWorkbench')")
    expect(WorkbenchSource).toMatch(/route === 'canvas'[\s\S]*?<CanvasWorkbench/)
  })
  it('music/canvas 分支通过 onOpenMy 跳「我的」页(setRoute(\'my\'))', () => {
    expect(WorkbenchSource).toMatch(/<MusicWorkbench[\s\S]*?onOpenMy=\{\(\) => setRoute\('my'\)\}/)
    expect(WorkbenchSource).toMatch(/<CanvasWorkbench[\s\S]*?onOpenMy=\{\(\) => setRoute\('my'\)\}/)
  })
  it('canvas 分支不再是占位 div，且不误进旧 infinite-canvas iframe', () => {
    expect(WorkbenchSource).not.toContain('data-route-placeholder={route}')
    expect(WorkbenchSource).not.toContain('<iframe')
  })
})
