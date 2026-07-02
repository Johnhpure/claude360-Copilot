import type { AppSettingsV1 } from '@shared/app-settings'
import { ensureGroupKeyForSelection, type GroupKeyEnsureDeps } from '../lib/group-key-ensure'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useGroupKeyPromptStore } from '../store/group-key-prompt-store'

type EnsureWriteTextGroupKeyInput = {
  feature: string
  model?: string
}

type EnsureWriteTextGroupKeyDeps = GroupKeyEnsureDeps & {
  getSettings: () => Promise<AppSettingsV1>
}

function selectedTextGroup(settings: AppSettingsV1): string {
  const group = ((settings as { claude360?: { selectedTextGroup?: string } }).claude360?.selectedTextGroup ?? '').trim()
  return group || 'auto'
}

function defaultDeps(): EnsureWriteTextGroupKeyDeps | null {
  if (typeof window.kunGui?.claude360TokensList !== 'function') return null
  return {
    getSettings: () => rendererRuntimeClient.getSettings({ forceRefresh: true }),
    listTokens: () => window.kunGui.claude360TokensList(),
    promptCreateAndEnsure: (group) => useGroupKeyPromptStore.getState().open(group),
    log: (message) => console.info(message)
  }
}

export async function ensureWriteTextGroupKey(
  input: EnsureWriteTextGroupKeyInput,
  deps: EnsureWriteTextGroupKeyDeps | null = defaultDeps()
): Promise<boolean> {
  if (!deps) return true
  const settings = await deps.getSettings()
  const group = selectedTextGroup(settings)
  return ensureGroupKeyForSelection(group, deps, {
    feature: input.feature,
    model: input.model
  })
}
