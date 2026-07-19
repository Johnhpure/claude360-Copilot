import type i18next from 'i18next'
import type { AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { invalidateGroupKeyCache } from '../lib/group-key-ensure'
import type { ChatState, ChatStoreGet, ChatStoreSet, InitialSetupMode, PluginHostRoute, SettingsRouteSection } from './chat-store-types'
import type { ComposerPlanMode } from './chat-store-helpers'
import {
  canSwitchComposerModel,
  conversationHasVisionAttachments,
  composerModelSelectable,
  composerModeForThread,
  persistComposerMode,
  persistComposerProviderId,
  providerIdForComposerModel,
  providerIdMatchesComposerModel,
  readThreadComposerMode,
  readThreadComposerSelection,
  rememberThreadComposerMode,
  rememberThreadComposerSelection,
  readStoredComposerProviderId
} from './chat-store-helpers'

type CreateAppActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: typeof i18next
  /** R1（07-14-renderer-lazy-loading）：en 资源为动态 chunk，changeLanguage 前先加载注册。 */
  ensureI18nResources: (locale: AppSettingsV1['locale']) => Promise<boolean>
  persistComposerModel: (model: string) => void
  persistComposerMode: (mode: ComposerPlanMode) => void
  rememberThreadComposerMode: (threadId: string, mode: ComposerPlanMode) => void
  readStoredComposerModel: (allowedIds: readonly string[]) => string
  mergeComposerPickList: (upstreamOk: boolean, upstreamIds: string[]) => string[]
  fallbackComposerModel: (pickList: readonly string[], runtimeDefault: string) => string
  getComposerModelLoadPromise: () => Promise<void> | null
  setComposerModelLoadPromise: (promise: Promise<void> | null) => void
  applyTheme: (theme: AppSettingsV1['theme']) => void
  applyUiFontScale: (scale: AppSettingsV1['uiFontScale']) => void
  applyChatContentMaxWidth: (widthPx: AppSettingsV1['chatContentMaxWidthPx']) => void
  applyCursorSpotlight: (enabled: boolean) => void
  applyCursorSpotlightColor: (color: AppSettingsV1['cursorSpotlightColor']) => void
  applyWriteTypography: (typography: AppSettingsV1['write']['typography']) => void
  applyDocumentLocale: (locale: AppSettingsV1['locale']) => void
  workspaceLabelFromPath: (workspaceRoot: string) => string
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
}

export function createAppActions(options: CreateAppActionsOptions): Pick<
  ChatState,
  | 'setError'
  | 'setComposerMode'
  | 'setComposerModel'
  | 'setComposerAgentId'
  | 'loadComposerModels'
  | 'reloadComposerModels'
  | 'setRoute'
  | 'openWrite'
  | 'openSettings'
  | 'openPlugins'
  | 'openClaw'
  | 'openSchedule'
  | 'openWorkflow'
  | 'openInitialSetup'
  | 'closeInitialSetup'
  | 'selectInspectorItem'
  | 'applyI18nFromSettings'
  | 'reloadUiSettings'
> {
  const {
    set,
    get,
    i18n,
    ensureI18nResources,
    persistComposerModel,
    persistComposerMode,
    rememberThreadComposerMode,
    readStoredComposerModel,
    mergeComposerPickList,
    fallbackComposerModel,
    getComposerModelLoadPromise,
    setComposerModelLoadPromise,
    applyTheme,
    applyUiFontScale,
    applyChatContentMaxWidth,
    applyCursorSpotlight,
    applyCursorSpotlightColor,
    applyWriteTypography,
    applyDocumentLocale,
    workspaceLabelFromPath,
    normalizeWorkspaceRoot
  } = options

  // R1（07-14-renderer-lazy-loading）：applyI18nFromSettings 的 last-write-wins 守卫。
  // ensureI18nResources('en') 在 chunk 加载 await 期间若又发起了新的语言切换，
  // 旧请求完成后不得再 changeLanguage（避免后发先至把语言切回去）。
  let i18nApplyGeneration = 0

  return {
    setError: (message) => set({ error: message }),

    setComposerMode: (mode) => {
      const activeThreadId = get().activeThreadId
      if (activeThreadId) {
        rememberThreadComposerMode(activeThreadId, mode)
      } else {
        persistComposerMode(mode)
      }
      set({ composerMode: mode })
    },

    setComposerModel: (modelId, providerId) => {
      const nextProviderId = providerId?.trim() || providerIdForComposerModel(get().composerModelGroups, modelId)
      const state = get()
      const lockVisionToTextSwitch =
        state.route === 'chat' &&
        Array.isArray(state.blocks) &&
        conversationHasVisionAttachments(state.blocks)
      if (!canSwitchComposerModel(
        lockVisionToTextSwitch,
        state.composerModelGroups,
        state.composerModel,
        state.composerProviderId,
        modelId,
        nextProviderId
      )) {
        return
      }
      const activeThreadId = state.activeThreadId
      if (activeThreadId) {
        rememberThreadComposerSelection(activeThreadId, modelId, nextProviderId)
      } else {
        persistComposerModel(modelId)
        persistComposerProviderId(nextProviderId)
      }
      set({ composerModel: modelId, composerProviderId: nextProviderId })
      const trimmed = modelId.trim()
      if (!activeThreadId && trimmed && trimmed.toLowerCase() !== 'auto' && typeof window.kunGui !== 'undefined') {
        void window.kunGui.saveSettingsSilent({ agents: { kun: { model: trimmed } } })
      }
      // 分组模式：选模型仅切换，不再即时检测 Key；Key 在发送消息时按所选分组检测/创建。
    },

    setComposerAgentId: (agentId) => {
      set({ composerAgentId: agentId.trim() })
    },

    loadComposerModels: async () => {
      if (getComposerModelLoadPromise()) return getComposerModelLoadPromise()!
      if (typeof window.kunGui === 'undefined') return
      // 刷新分组列表 = 分组/Key 配置可能已变，失效「已验证有 Key」缓存（07-05）。
      invalidateGroupKeyCache()
      const task = (async () => {
        const res = await window.kunGui.fetchUpstreamModels()
        const pick = mergeComposerPickList(res.ok, res.ok ? res.modelIds : [])
        const groups = res.ok ? res.modelGroups ?? [] : []
        console.info(
          `[kun-gui] Code page model groups fetched ok=${res.ok} feature=code ` +
            `groups=[${groups.map((group) => `${group.providerId}/${group.label}:${group.modelIds.join('|')}`).join(', ')}] ` +
            `models=[${res.ok ? res.modelIds.join(', ') : ''}]`
        )
        if (res.ok && groups.length === 0) {
          console.warn('[kun-gui] Code page model groups empty after upstream fetch; picker will show no Claude360 groups')
        }
        const runtimeDefault = res.ok ? res.defaultModelId?.trim() ?? '' : ''
        set((state) => {
          const isSelectable = (model: string): boolean => composerModelSelectable(pick, groups, model)
          const activeThread = state.activeThreadId
            ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
            : null
          const threadSelection = activeThread ? readThreadComposerSelection(activeThread.id) : null
          const currentModel = state.composerModel.trim()
          const normalizedCurrentModel = currentModel.toLowerCase() === 'auto' ? '' : currentModel
          const storedModel = readStoredComposerModel(pick)
          let model = activeThread
            ? threadSelection?.model?.trim() || activeThread.model.trim()
            : normalizedCurrentModel
          let shouldPersist = !activeThread && model !== state.composerModel
          if (model === '' || !isSelectable(model)) {
            model = activeThread ? '' : storedModel
            shouldPersist = false
          }
          if (model === '' || !isSelectable(model)) {
            model = fallbackComposerModel(pick, runtimeDefault)
            shouldPersist = false
          }
          if (shouldPersist) persistComposerModel(model)
          const threadProviderId =
            threadSelection && providerIdMatchesComposerModel(groups, threadSelection.providerId, model)
              ? threadSelection.providerId
              : ''
          const storedProviderId = activeThread ? '' : readStoredComposerProviderId(groups, model)
          const providerId = threadProviderId || storedProviderId || providerIdForComposerModel(groups, model)
          if (!activeThread && providerId !== state.composerProviderId) persistComposerProviderId(providerId)
          if (
            activeThread &&
            (!threadSelection || threadSelection.model !== model || threadSelection.providerId !== providerId) &&
            composerModelSelectable(pick, groups, model)
          ) {
            rememberThreadComposerSelection(activeThread.id, model, providerId)
          }
          return {
            composerPickList: pick,
            composerModel: model,
            composerProviderId: providerId,
            composerModelGroups: groups
          }
        })
      })().finally(() => {
        setComposerModelLoadPromise(null)
      })
      setComposerModelLoadPromise(task)
      return task
    },

    // 强制重载（07-19-startup-perf-optimization P1）：main 侧后台刷新完成事件的
    // 处理入口。与 loadComposerModels 的 in-flight 去重相容——若有进行中的加载
    // 先等它落定（其结果可能仍是旧数据），再发起一次新的加载读最新落盘数据。
    reloadComposerModels: async () => {
      const inFlight = getComposerModelLoadPromise()
      if (inFlight) await inFlight.catch(() => undefined)
      await get().loadComposerModels()
    },

    setRoute: (route) => set({ route }),

    openWrite: async () => {
      set({ route: 'write' })
    },

    openSettings: (section: SettingsRouteSection = 'general') =>
      set((state) => ({
        route: 'settings',
        settingsSection: section,
        settingsReturnRoute: state.route === 'settings' ? state.settingsReturnRoute : state.route
      })),

    openPlugins: (host?: PluginHostRoute) =>
      set((state) => ({
        route: 'plugins',
        pluginHostRoute: host ?? (state.route === 'claw' ? 'claw' : 'chat')
      })),

    openClaw: () => {
      set({ route: 'claw' })
      void get().refreshClawChannels()
    },

    openSchedule: () => {
      set({ route: 'schedule' })
    },

    openWorkflow: () => {
      set({ route: 'workflow' })
    },

    openInitialSetup: (mode: InitialSetupMode = 'required', message: string | null = null) =>
      set({ initialSetupOpen: true, initialSetupMode: mode, initialSetupMessage: message }),

    closeInitialSetup: () => set({ initialSetupOpen: false, initialSetupMode: 'required', initialSetupMessage: null }),

    selectInspectorItem: (id) => set({ inspectorSelectedId: id }),

    applyI18nFromSettings: async (locale) => {
      // en 资源是动态 chunk：changeLanguage 前先确保注册完成（避免文案闪 key）；
      // 加载失败时仍切换语言，t() 由 fallbackLng=zh 兜底。
      const generation = ++i18nApplyGeneration
      await ensureI18nResources(locale)
      // await 期间有更新的语言请求：放弃本次切换，由最新请求负责收尾。
      if (generation !== i18nApplyGeneration) return
      await i18n.changeLanguage(locale)
      applyDocumentLocale(locale)
    },

    reloadUiSettings: async () => {
      if (typeof window.kunGui === 'undefined') return
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
      applyTheme(settings.theme)
      applyUiFontScale(settings.uiFontScale)
      applyChatContentMaxWidth(settings.chatContentMaxWidthPx)
      applyCursorSpotlight(settings.cursorSpotlight !== false)
      applyCursorSpotlightColor(settings.cursorSpotlightColor)
      if (settings.write?.typography) applyWriteTypography(settings.write.typography)
      set({
        workspaceRoot,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        conversationWorkspaceRoot: settings.conversationWorkspaceRoot || '',
        disabledSkillIds: settings.disabledSkillIds,
        clawChannels: settings.claw.channels,
        activeClawChannelId: settings.claw.channels.some(
          (channel) => channel.id === get().activeClawChannelId && channel.enabled
        )
          ? get().activeClawChannelId
          : settings.claw.channels.find((channel) => channel.enabled)?.id ?? ''
      })
      await get().applyI18nFromSettings(settings.locale)
      if (get().runtimeConnection === 'ready') {
        void get().refreshThreads()
      }
      void get().loadComposerModels()
    }
  }
}
