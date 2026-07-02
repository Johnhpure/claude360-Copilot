import {
  getModelProviderProfile,
  getModelProviderSettings,
  isClaude360ProviderId,
  resolveKunRuntimeSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionProviderProfile,
  type AppSettingsV1,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import { sameClaude360Group } from '@shared/claude360'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import {
  compactWorkspaceRoots,
  normalizePath,
  normalizeWriteSettings,
  withResolvedInlineCompletionSettings
} from './write-workspace-store-helpers'

type WriteSettingsActions = Pick<
  WriteWorkspaceState,
  'loadWriteSettings' | 'selectWriteWorkspace' | 'addWriteWorkspace' | 'removeWriteWorkspace'
>

type WriteSettingsActionContext = {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
}

function applyWriteSettingsState(
  set: WriteWorkspaceSet,
  settings: Awaited<ReturnType<typeof rendererRuntimeClient.getSettings>>
): ReturnType<typeof withResolvedInlineCompletionSettings> {
  const write = withResolvedInlineCompletionSettings(normalizeWriteSettings(settings.write), settings)
  set({
    defaultWorkspaceRoot: write.defaultWorkspaceRoot,
    workspaceRoots: write.workspaces,
    inlineCompletion: write.inlineCompletion,
    selectionAssist: write.selectionAssist,
    agentPresets: write.agentPresets,
    inlineCompletionApiReady: isInlineCompletionApiReady(settings),
    imageGenReady: isClaude360ImageGenerationReady(settings),
    // Prototype generation rides the primary chat provider, not the image one.
    prototypeReady: isPrototypeGenerationReady(settings),
    settingsError: null
  })
  return write
}

function profileCredentialReady(profile: ModelProviderProfileV1): boolean {
  return Boolean(profile.apiKey.trim() || profile.apiKeyRef?.trim())
}

function isInlineCompletionApiReady(settings: AppSettingsV1): boolean {
  if (resolveWriteInlineCompletionApiKey(settings).trim()) return true
  const profile = resolveWriteInlineCompletionProviderProfile(settings)
  return isClaude360ProviderId(profile.id) && profileCredentialReady(profile)
}

function isClaude360ImageGenerationReady(settings: AppSettingsV1): boolean {
  const selectedGroup = ((settings as { claude360?: { selectedImageGroup?: string } }).claude360?.selectedImageGroup ?? '').trim()
  if (!selectedGroup) return false
  const profile = getModelProviderSettings(settings).providers.find((item) =>
    isClaude360ProviderId(item.id) &&
    sameClaude360Group(claude360ProfileGroup(item), selectedGroup)
  )
  return Boolean(profile?.image?.models.some((model) => model.trim()))
}

function isPrototypeGenerationReady(settings: AppSettingsV1): boolean {
  const runtime = resolveKunRuntimeSettings(settings)
  if (!runtime.model.trim()) return false
  if (runtime.apiKey.trim()) return true
  const profile = getModelProviderProfile(settings, runtime.providerId)
  return isClaude360ProviderId(profile.id) && profileCredentialReady(profile)
}

function claude360ProfileGroup(profile: Pick<ModelProviderProfileV1, 'id' | 'name'>): string {
  const name = profile.name.trim()
  if (name) return name
  const id = profile.id.trim()
  const lower = id.toLowerCase()
  if (lower.startsWith('claude360:')) return id.slice('claude360:'.length)
  if (lower.startsWith('claude360-')) return id.slice('claude360-'.length)
  return id
}

export function createWriteSettingsActions({ set, get }: WriteSettingsActionContext): WriteSettingsActions {
  return {
    loadWriteSettings: async () => {
      if (get().settingsLoading) return
      set({ settingsLoading: true, settingsError: null })
      try {
        const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
        const write = applyWriteSettingsState(set, settings)
        set({ settingsLoading: false })
        await get().initializeWorkspace(write.activeWorkspaceRoot)
      } catch (error) {
        set({
          settingsLoading: false,
          settingsError: error instanceof Error ? error.message : String(error)
        })
      }
    },

    selectWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
      set({ workspaceRoots: roots })
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot: normalized,
            workspaces: roots
          }
        })
        const write = applyWriteSettingsState(set, settings)
        await get().initializeWorkspace(write.activeWorkspaceRoot)
      } catch (error) {
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    },

    addWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const roots = compactWorkspaceRoots([normalized, ...get().workspaceRoots])
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot: normalized,
            workspaces: roots
          }
        })
        const write = applyWriteSettingsState(set, settings)
        await get().initializeWorkspace(write.activeWorkspaceRoot)
      } catch (error) {
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    },

    removeWriteWorkspace: async (workspaceRoot) => {
      const normalized = normalizePath(workspaceRoot)
      if (!normalized) return
      const state = get()
      const fallback = state.defaultWorkspaceRoot ||
        state.workspaceRoots.find((item) => item !== normalized) ||
        state.workspaceRoot
      const roots = compactWorkspaceRoots([
        fallback,
        ...state.workspaceRoots.filter((item) => normalizePath(item) !== normalized)
      ])
      const activeWorkspaceRoot = normalizePath(state.workspaceRoot) === normalized
        ? fallback
        : state.workspaceRoot
      try {
        const settings = await rendererRuntimeClient.setSettings({
          write: {
            activeWorkspaceRoot,
            workspaces: roots
          }
        })
        const write = applyWriteSettingsState(set, settings)
        if (normalizePath(get().workspaceRoot) === normalized) {
          await get().initializeWorkspace(write.activeWorkspaceRoot)
        }
      } catch (error) {
        set({ settingsError: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
