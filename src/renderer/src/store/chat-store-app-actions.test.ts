import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type i18next from 'i18next'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  fallbackComposerModel,
  mergeComposerPickList,
  persistComposerMode,
  persistComposerModel,
  rememberThreadComposerMode,
  readStoredComposerModel
} from './chat-store-helpers'
import { createAppActions } from './chat-store-app-actions'

const COMPOSER_MODEL_STORAGE_KEY = 'kun.composerModel'
const COMPOSER_PROVIDER_STORAGE_KEY = 'kun.composerProviderId'
const THREAD_COMPOSER_SELECTION_STORAGE_KEY = 'kun.threadComposerSelection.v1'
const THREAD_COMPOSER_MODE_STORAGE_KEY = 'kun.threadComposerMode.v1'
const COMPOSER_MODE_STORAGE_KEY = 'kun.composerMode'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

type FetchModelsResult =
  | { ok: true; modelIds: string[]; defaultModelId?: string; modelGroups?: ChatState['composerModelGroups'] }
  | { ok: false; message: string }

function buildHarness(fetchModelsResult: FetchModelsResult): {
  actions: ReturnType<typeof createAppActions>
  state: ChatState
} {
  let state = {
    activeThreadId: null,
    threads: [],
    composerMode: 'agent',
    composerModel: '',
    composerProviderId: '',
    composerPickList: mergeComposerPickList(false, []),
    composerModelGroups: []
  } as unknown as ChatState
  let loadPromise: Promise<void> | null = null
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state

  vi.stubGlobal('window', {
    kunGui: {
      fetchUpstreamModels: vi.fn(async () => fetchModelsResult),
      saveSettingsSilent: vi.fn(async () => state)
    }
  })

  return {
    state,
    actions: createAppActions({
      set,
      get,
      i18n: { t: (key: string) => key, changeLanguage: vi.fn(async () => undefined) } as unknown as typeof i18next,
      ensureI18nResources: vi.fn(async () => true),
      persistComposerModel,
      persistComposerMode,
      rememberThreadComposerMode,
      readStoredComposerModel,
      mergeComposerPickList,
      fallbackComposerModel,
      getComposerModelLoadPromise: () => loadPromise,
      setComposerModelLoadPromise: (promise) => {
        loadPromise = promise
      },
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

describe('chat-store app actions composer model loading', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores the previously selected custom model after the full model list loads', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'MiniMax-M2')
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MiniMax-M2'],
      defaultModelId: 'deepseek-v4-pro',
      modelGroups: [{
        providerId: 'minimax',
        label: 'MiniMax',
        modelIds: ['MiniMax-M2']
      }]
    })

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('MiniMax-M2')
    expect(state.composerProviderId).toBe('minimax')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('MiniMax-M2')
    expect(localStorage.getItem(COMPOSER_PROVIDER_STORAGE_KEY)).toBe('minimax')
  })

  it('updates the composer provider when the picker supplies a provider id', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MiniMax-M2'],
      defaultModelId: 'deepseek-v4-pro',
      modelGroups: [{
        providerId: 'minimax',
        label: 'MiniMax',
        modelIds: ['MiniMax-M2']
      }]
    })
    state.composerModelGroups = [{
      providerId: 'minimax',
      label: 'MiniMax',
      modelIds: ['MiniMax-M2']
    }]

    actions.setComposerModel('MiniMax-M2', 'minimax')

    expect(state.composerModel).toBe('MiniMax-M2')
    expect(state.composerProviderId).toBe('minimax')
    expect(localStorage.getItem(COMPOSER_PROVIDER_STORAGE_KEY)).toBe('minimax')
    expect(window.kunGui.saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { model: 'MiniMax-M2' } }
    })
  })

  it('keeps active-thread plan mode changes out of the global composer default', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MiniMax-M2'],
      defaultModelId: 'deepseek-v4-pro',
      modelGroups: []
    })
    state.activeThreadId = 'thread-a'

    actions.setComposerMode('plan')

    expect(state.composerMode).toBe('plan')
    expect(localStorage.getItem(COMPOSER_MODE_STORAGE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(THREAD_COMPOSER_MODE_STORAGE_KEY) ?? '{}')).toEqual({
      'thread-a': 'plan'
    })
  })

  it('keeps active-thread model changes out of the global Kun default', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MiniMax-M2'],
      defaultModelId: 'deepseek-v4-pro',
      modelGroups: [{
        providerId: 'minimax',
        label: 'MiniMax',
        modelIds: ['MiniMax-M2']
      }]
    })
    state.activeThreadId = 'thread-a'
    state.threads = [{
      id: 'thread-a',
      title: 'Thread A',
      workspace: '/tmp/project',
      model: 'deepseek-v4-pro',
      status: 'idle',
      mode: 'agent',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]
    state.composerModelGroups = [{
      providerId: 'minimax',
      label: 'MiniMax',
      modelIds: ['MiniMax-M2']
    }]

    actions.setComposerModel('MiniMax-M2', 'minimax')

    expect(state.composerModel).toBe('MiniMax-M2')
    expect(state.composerProviderId).toBe('minimax')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(COMPOSER_PROVIDER_STORAGE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY) ?? '{}')).toEqual({
      'thread-a': { model: 'MiniMax-M2', providerId: 'minimax' }
    })
    expect(window.kunGui.saveSettingsSilent).not.toHaveBeenCalled()
  })

  it('restores a model selection from the active thread instead of the global picker', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'deepseek-v4-flash')
    localStorage.setItem(
      THREAD_COMPOSER_SELECTION_STORAGE_KEY,
      JSON.stringify({ 'thread-a': { model: 'MiniMax-M2', providerId: 'minimax' } })
    )
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['MiniMax-M2'],
      defaultModelId: 'deepseek-v4-pro',
      modelGroups: [{
        providerId: 'minimax',
        label: 'MiniMax',
        modelIds: ['MiniMax-M2']
      }]
    })
    state.activeThreadId = 'thread-a'
    state.threads = [{
      id: 'thread-a',
      title: 'Thread A',
      workspace: '/tmp/project',
      model: 'deepseek-v4-pro',
      status: 'idle',
      mode: 'agent',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('MiniMax-M2')
    expect(state.composerProviderId).toBe('minimax')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('deepseek-v4-flash')
  })

  it('does not restore a per-thread selection filtered out of the composer menu', async () => {
    localStorage.setItem(
      THREAD_COMPOSER_SELECTION_STORAGE_KEY,
      JSON.stringify({ 'thread-a': { model: 'Kwai-Kolors/Kolors', providerId: 'minimax' } })
    )
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['Kwai-Kolors/Kolors', 'text-fallback-model'],
      defaultModelId: 'text-fallback-model',
      modelGroups: [{
        providerId: 'minimax',
        label: 'MiniMax',
        modelIds: ['Kwai-Kolors/Kolors'],
        modelProfiles: {
          'kwai-kolors/kolors': {
            inputModalities: ['text'],
            outputModalities: ['image'],
            supportsToolCalling: false,
            messageParts: ['text']
          }
        }
      }]
    })
    state.activeThreadId = 'thread-a'
    state.threads = [{
      id: 'thread-a',
      title: 'Thread A',
      workspace: '/tmp/project',
      model: 'text-fallback-model',
      status: 'idle',
      mode: 'agent',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('text-fallback-model')
    expect(state.composerProviderId).toBe('')
  })

  it('blocks switching a chat with image attachments from vision to text-only', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    state.blocks = [{
      kind: 'user',
      id: 'user-1',
      text: 'describe this',
      meta: { attachments: [{ id: 'att-1', kind: 'image' }] }
    }] as ChatState['blocks']
    state.activeThreadId = 'thread-a'
    state.threads = [{
      id: 'thread-a',
      title: 'Thread A',
      workspace: '/tmp/project',
      model: 'vision-model',
      status: 'idle',
      mode: 'agent',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('vision-model')
    expect(state.composerProviderId).toBe('test-provider')
    expect(localStorage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY)).toBeNull()
    expect(window.kunGui.saveSettingsSilent).not.toHaveBeenCalled()
  })

  it('allows switching a text-only chat from vision to text-only (issue #579)', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    // A plain text conversation must not pin the picker to vision models.
    state.blocks = [
      { kind: 'user', id: 'user-1', text: 'hello' },
      { kind: 'assistant', id: 'assistant-1', text: 'hi there' }
    ] as ChatState['blocks']
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
    expect(state.composerProviderId).toBe('test-provider')
  })

  it('allows switching a document-only chat from vision to text-only', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    // Documents are text-extracted, so they don't require a vision model.
    state.blocks = [{
      kind: 'user',
      id: 'user-1',
      text: 'summarize',
      meta: { attachments: [{ id: 'doc-1', kind: 'document' }] }
    }] as ChatState['blocks']
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
  })

  it('allows switching an empty chat from vision to text-only', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    state.blocks = []
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
    expect(state.composerProviderId).toBe('test-provider')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('text-model')
    expect(window.kunGui.saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { model: 'text-model' } }
    })
  })

  it('allows switching an active chat from text-only to vision', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'text-model',
      modelGroups: []
    })
    state.route = 'chat'
    state.blocks = [{ kind: 'user', id: 'user-1', text: 'hello' }] as ChatState['blocks']
    state.composerModel = 'text-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('vision-model', 'test-provider')

    expect(state.composerModel).toBe('vision-model')
    expect(state.composerProviderId).toBe('test-provider')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('vision-model')
  })

  it('keeps the stored custom model and shows no hardcoded fallback when upstream fails', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'MiniMax-M2')
    const { actions, state } = buildHarness({
      ok: false,
      message: 'upstream unavailable'
    })

    await actions.loadComposerModels()

    // 07-10: 上游失败时 pick 列表为空,不得回退 deepseek hardcode;
    // 已存储的自定义模型保留在 localStorage,待上游恢复后再还原。
    expect(state.composerPickList).toEqual([])
    expect(state.composerModel).toBe('')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('MiniMax-M2')
  })
})

// R1（07-14-renderer-lazy-loading）：en 语言包为动态 chunk，
// applyI18nFromSettings 必须先 await ensureI18nResources 再 changeLanguage。
describe('applyI18nFromSettings resource loading order (R1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function buildI18nHarness(ensureI18nResources: (locale: 'en' | 'zh') => Promise<boolean>): {
    actions: ReturnType<typeof createAppActions>
    changeLanguage: ReturnType<typeof vi.fn>
    applyDocumentLocale: ReturnType<typeof vi.fn>
  } {
    const changeLanguage = vi.fn(async () => undefined)
    const applyDocumentLocale = vi.fn()
    const state = {} as unknown as ChatState
    const actions = createAppActions({
      set: () => undefined,
      get: () => state,
      i18n: { t: (key: string) => key, changeLanguage } as unknown as typeof i18next,
      ensureI18nResources,
      persistComposerModel,
      persistComposerMode,
      rememberThreadComposerMode,
      readStoredComposerModel,
      mergeComposerPickList,
      fallbackComposerModel,
      getComposerModelLoadPromise: () => null,
      setComposerModelLoadPromise: () => undefined,
      applyTheme: () => undefined,
      applyUiFontScale: () => undefined,
      applyChatContentMaxWidth: () => undefined,
      applyCursorSpotlight: () => undefined,
      applyCursorSpotlightColor: () => undefined,
      applyWriteTypography: () => undefined,
      applyDocumentLocale,
      workspaceLabelFromPath: (workspaceRoot) => workspaceRoot,
      normalizeWorkspaceRoot: (workspaceRoot) => workspaceRoot?.trim() ?? ''
    })
    return { actions, changeLanguage, applyDocumentLocale }
  }

  it('awaits ensureI18nResources before changeLanguage', async () => {
    let resolveEnsure: (ready: boolean) => void = () => undefined
    const ensure = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveEnsure = resolve
        })
    )
    const { actions, changeLanguage, applyDocumentLocale } = buildI18nHarness(ensure)

    const pending = actions.applyI18nFromSettings('en')
    await Promise.resolve()
    expect(ensure).toHaveBeenCalledWith('en')
    expect(changeLanguage).not.toHaveBeenCalled()

    resolveEnsure(true)
    await pending
    expect(changeLanguage).toHaveBeenCalledWith('en')
    expect(applyDocumentLocale).toHaveBeenCalledWith('en')
  })

  it('still switches language when the en chunk fails to load (zh fallback keeps UI readable)', async () => {
    const ensure = vi.fn(async () => false)
    const { actions, changeLanguage, applyDocumentLocale } = buildI18nHarness(ensure)

    await actions.applyI18nFromSettings('en')

    expect(ensure).toHaveBeenCalledWith('en')
    expect(changeLanguage).toHaveBeenCalledWith('en')
    expect(applyDocumentLocale).toHaveBeenCalledWith('en')
  })

  it('drops a stale switch when a newer language request arrives while the chunk is loading', async () => {
    // 竞态守卫（last-write-wins）：en 的 ensure 还在 await 时用户切回 zh——
    // en 完成后不得再 changeLanguage('en') 把语言抢回去。
    let resolveEnEnsure: (ready: boolean) => void = () => undefined
    const ensure = vi.fn((locale: 'en' | 'zh') => {
      if (locale === 'en') {
        return new Promise<boolean>((resolve) => {
          resolveEnEnsure = resolve
        })
      }
      return Promise.resolve(true)
    })
    const { actions, changeLanguage, applyDocumentLocale } = buildI18nHarness(ensure)

    const stale = actions.applyI18nFromSettings('en')
    const latest = actions.applyI18nFromSettings('zh')
    await latest
    expect(changeLanguage).toHaveBeenCalledTimes(1)
    expect(changeLanguage).toHaveBeenCalledWith('zh')

    resolveEnEnsure(true)
    await stale
    // 过期请求被丢弃：不再有第二次 changeLanguage。
    expect(changeLanguage).toHaveBeenCalledTimes(1)
    expect(applyDocumentLocale).toHaveBeenCalledTimes(1)
    expect(applyDocumentLocale).toHaveBeenCalledWith('zh')
  })
})
