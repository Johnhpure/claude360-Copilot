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
  console.info(
    `[kun-gui] Code model picker feature=code Claude360 loggedIn=${settings.claude360?.loggedIn === true}`
  )
  if (!settings.claude360?.loggedIn) {
    return { ok: false, message: 'Claude360 未登录，登录后即可选择模型。' }
  }
  const nonTextModelIds = listNonTextModelIds(settings)
  const nonTextSet = new Set(nonTextModelIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
  const groups: ModelProviderModelGroup[] = []
  const textModelIds: string[] = []
  const providers = getModelProviderSettings(settings).providers
  console.info(
    `[kun-gui] Code model picker provider count=${providers.length} ` +
      `cachedGroups=[${settings.claude360?.modelCache?.groups?.join(', ') ?? ''}] ` +
      `cachedModels=[${settings.claude360?.modelCache?.models?.join(', ') ?? ''}]`
  )
  for (const provider of providers) {
    if (!isClaude360ProviderId(provider.id)) continue
    console.info(
      `[kun-gui] Code model picker group before filter ` +
        `id="${provider.id}" name="${provider.name}" models=[${provider.models.join(', ')}] ` +
        `hasApiKeyRef=${Boolean(provider.apiKeyRef?.trim())}`
    )
    const modelIds: string[] = []
    const filtered: string[] = []
    for (const id of provider.models) {
      const normalized = id.trim().toLowerCase()
      const profile = modelProviderModelProfile(provider, id)
      const reasons: string[] = []
      if (!isComposerChatModelId(id, nonTextModelIds)) {
        reasons.push(nonTextSet.has(normalized) ? 'non-text-capability-cache' : 'not-composer-chat-model-id')
      }
      if (!modelProfileSupportsTextChat(profile)) reasons.push('profile-not-text-chat')
      if (reasons.length === 0) {
        modelIds.push(id)
      } else {
        filtered.push(`${id}:${reasons.join('+')}`)
      }
    }
    console.info(
      `[kun-gui] Code model picker group after filter ` +
        `id="${provider.id}" name="${provider.name}" kept=[${modelIds.join(', ')}] ` +
        `filtered=[${filtered.join(', ')}]`
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
    console.warn('[kun-gui] Code model picker filtered all Claude360 groups; no text/code models remain')
    return { ok: false, message: 'Claude360 暂无可用文本模型，请打开 设置 → 分组及 Key 刷新。' }
  }
  const modelIds = sortComposerModelIds(textModelIds)
  const defaultModelId = resolveClaude360DefaultModelId(settings, modelIds)
  const modelGroups = mergeModelGroups(groups)
  console.info(
    `[kun-gui] Code model picker final groups=${modelGroups.length} ` +
      `models=[${modelIds.join(', ')}] default="${defaultModelId ?? ''}"`
  )
  return { ok: true, modelIds, defaultModelId, modelGroups }
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
