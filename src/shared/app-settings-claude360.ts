import type {
  Claude360ModelCache,
  Claude360SettingsPatchV1,
  Claude360SettingsV1,
  Claude360TokenRef
} from './app-settings-types'

export type {
  Claude360ModelCache,
  Claude360SettingsPatchV1,
  Claude360SettingsV1,
  Claude360TokenRef
}

export const DEFAULT_CLAUDE360_BASE_URL = 'https://claude360.xyz'

export function defaultClaude360Settings(): Claude360SettingsV1 {
  return {
    baseUrl: DEFAULT_CLAUDE360_BASE_URL,
    loggedIn: false,
    username: '',
    displayName: '',
    defaultGroup: 'auto',
    selectedTextGroup: 'auto',
    selectedImageGroup: '',
    selectedMusicGroup: '',
    cliTokenRef: '',
    tokenRefs: {},
    modelCache: { groups: [], models: [] },
    lastSyncAt: ''
  }
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))]
}

function normalizeBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_CLAUDE360_BASE_URL
  // 去掉尾部斜杠，统一 baseUrl 形态（API client 也会再次去尾斜杠）。
  return raw.replace(/\/+$/, '')
}

function normalizeTokenRef(value: unknown): Claude360TokenRef | null {
  if (typeof value !== 'object' || value === null) return null
  const ref = value as Partial<Claude360TokenRef>
  if (typeof ref.tokenId !== 'number') return null
  return {
    tokenId: ref.tokenId,
    name: normalizeString(ref.name, ''),
    group: normalizeString(ref.group, '')
  }
}

function normalizeTokenRefs(value: unknown): Record<string, Claude360TokenRef> {
  if (typeof value !== 'object' || value === null) return {}
  const result: Record<string, Claude360TokenRef> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const ref = normalizeTokenRef(raw)
    if (ref) result[key] = ref
  }
  return result
}

function normalizeModelCache(value: unknown): Claude360ModelCache {
  if (typeof value !== 'object' || value === null) return { groups: [], models: [] }
  const cache = value as Partial<Claude360ModelCache>
  return {
    groups: normalizeStringArray(cache.groups),
    models: normalizeStringArray(cache.models)
  }
}

export function normalizeClaude360Settings(
  input: Claude360SettingsPatchV1 | undefined
): Claude360SettingsV1 {
  const defaults = defaultClaude360Settings()
  return {
    baseUrl: normalizeBaseUrl(input?.baseUrl),
    loggedIn: input?.loggedIn === true,
    username: normalizeString(input?.username, defaults.username),
    displayName: normalizeString(input?.displayName, defaults.displayName),
    defaultGroup: normalizeString(input?.defaultGroup, defaults.defaultGroup),
    selectedTextGroup: normalizeString(input?.selectedTextGroup, defaults.selectedTextGroup),
    selectedImageGroup: normalizeString(input?.selectedImageGroup, defaults.selectedImageGroup),
    selectedMusicGroup: normalizeString(input?.selectedMusicGroup, defaults.selectedMusicGroup),
    cliTokenRef: normalizeString(input?.cliTokenRef, defaults.cliTokenRef),
    tokenRefs: normalizeTokenRefs(input?.tokenRefs),
    modelCache: normalizeModelCache(input?.modelCache),
    lastSyncAt: normalizeString(input?.lastSyncAt, defaults.lastSyncAt)
  }
}

export function mergeClaude360Settings(
  current: Claude360SettingsV1,
  patch: Claude360SettingsPatchV1 | undefined
): Claude360SettingsV1 {
  if (!patch) return normalizeClaude360Settings(current)
  return normalizeClaude360Settings({
    ...current,
    ...patch,
    ...(patch.tokenRefs !== undefined
      ? { tokenRefs: { ...current.tokenRefs, ...patch.tokenRefs } }
      : {}),
    ...(patch.modelCache !== undefined
      ? { modelCache: { ...current.modelCache, ...patch.modelCache } }
      : {})
  })
}
