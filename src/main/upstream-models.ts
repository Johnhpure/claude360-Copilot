import {
  getModelProviderSettings,
  isClaude360ProviderId,
  isComposerChatModelId,
  listNonTextModelIds,
  modelProfileSupportsTextChat,
  modelProviderModelProfile,
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import type { ModelProviderModelGroup } from '../shared/kun-gui-api'

export type FetchUpstreamModelsResult =
  | { ok: true; modelIds: string[]; defaultModelId?: string; modelGroups?: ModelProviderModelGroup[] }
  | { ok: false; message: string }

/**
 * Builds the model list the composer picker shows. After the Claude360
 * white-label convergence (plan-03), the ONLY model source is the set of
 * auto-generated `claude360:*` provider profiles created on login; there is no
 * DeepSeek/Kun default fallback and no upstream `GET /v1/models` catalog query.
 *
 * When the user is not logged in to Claude360 the picker returns an explicit
 * error instead of silently offering default models — an unauthenticated
 * client must not be able to pick a model.
 *
 */
export async function fetchUpstreamModelIds(
  settings: AppSettingsV1
): Promise<FetchUpstreamModelsResult> {
  if (!settings.claude360?.loggedIn) {
    return { ok: false, message: 'Claude360 未登录，登录后即可选择模型。' }
  }
  const nonTextModelIds = listNonTextModelIds(settings)
  const groups: ModelProviderModelGroup[] = []
  const textModelIds: string[] = []
  for (const provider of getModelProviderSettings(settings).providers) {
    if (!isClaude360ProviderId(provider.id)) continue
    const modelIds = provider.models.filter((id) =>
      isComposerChatModelId(id, nonTextModelIds)
      && modelProfileSupportsTextChat(modelProviderModelProfile(provider, id))
    )
    if (modelIds.length === 0) continue
    for (const id of modelIds) textModelIds.push(id)
    groups.push({
      providerId: provider.id,
      label: provider.name,
      modelIds,
      modelProfiles: provider.modelProfiles
    })
  }
  if (textModelIds.length === 0) {
    return { ok: false, message: 'Claude360 暂无可用文本模型，请打开 设置 → 分组及 Key 刷新。' }
  }
  const modelIds = sortComposerModelIds(textModelIds)
  const defaultModelId = resolveClaude360DefaultModelId(settings, modelIds)
  return { ok: true, modelIds, defaultModelId, modelGroups: mergeModelGroups(groups) }
}

/**
 * Prefers the runtime-configured (recommended) model, then the first cached
 * model that is a usable text model, then the first available text model.
 */
function resolveClaude360DefaultModelId(settings: AppSettingsV1, textModelIds: readonly string[]): string {
  const known = new Set(textModelIds)
  const runtimeModel = resolveKunRuntimeSettings(settings).model.trim()
  if (runtimeModel && known.has(runtimeModel)) return runtimeModel
  for (const cached of settings.claude360?.modelCache?.models ?? []) {
    const trimmed = cached.trim()
    if (trimmed && known.has(trimmed)) return trimmed
  }
  return textModelIds[0] ?? ''
}

function mergeModelGroups(groups: readonly ModelProviderModelGroup[]): ModelProviderModelGroup[] {
  const byProvider = new Map<string, ModelProviderModelGroup>()
  for (const group of groups) {
    const providerId = group.providerId.trim()
    if (!providerId) continue
    const existing = byProvider.get(providerId)
    const modelIds = sortComposerModelIds([
      ...(existing?.modelIds ?? []),
      ...group.modelIds
    ])
    byProvider.set(providerId, {
      providerId,
      label: group.label.trim() || providerId,
      modelIds,
      modelProfiles: {
        ...(existing?.modelProfiles ?? {}),
        ...(group.modelProfiles ?? {})
      }
    })
  }
  return [...byProvider.values()].filter((group) => group.modelIds.length > 0)
}

function sortComposerModelIds(ids: readonly string[]): string[] {
  const ordered = new Set<string>()
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed && trimmed !== 'auto') ordered.add(trimmed)
  }
  return [...ordered].sort((a, b) => a.localeCompare(b))
}
