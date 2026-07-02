import {
  buildClaude360ProviderProfiles,
  isClaude360ImageModelId,
  type Claude360GroupModelsInput,
  type Claude360ToolGroupInfo
} from '../../shared/app-settings-provider'
import type { ModelProviderProfileV1 } from '../../shared/app-settings-types'
import type { Claude360ModelCache, Claude360TokenRef } from '../../shared/app-settings-claude360'
import type { Claude360TokenPurpose } from '../../shared/claude360'
import { Claude360ApiError } from './claude360-api-client'
import { CLAUDE360_CLI_TOKEN_REF, type Claude360SecretStore } from './claude360-secret-store'

/**
 * Claude360 分组/模型同步服务（plan-03 Task 2）。
 * 按 `tool=codex|image|music` 拉分组（不硬编码分组名），按分组拉模型，
 * 生成只读 provider profiles 与模型缓存。
 * 收口：刷新无副作用，不创建分组 Key；执行任务时再按所选分组 ensure Key。
 */

export type Claude360ApiClientPort = {
  get<T>(path: string, token?: string): Promise<T>
}

export type Claude360ModelServiceDeps = {
  apiClient: Claude360ApiClientPort
  secretStore: Claude360SecretStore
  /** @deprecated 刷新模型不再确保分组 Key；保留字段仅兼容旧调用方/测试注入。 */
  ensureGroupRef?: (group: string, purpose: Claude360TokenPurpose) => Promise<Claude360TokenRef>
}

export type Claude360ModelSyncResult = {
  modelCache: Claude360ModelCache
  providerProfiles: ModelProviderProfileV1[]
  /**
   * 每个用途（text/image/music）后端返回的分组清单（含 recommended），
   * 供上层据此持久化 selectedTextGroup/selectedImageGroup/selectedMusicGroup。
   */
  groupsByPurpose: Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]>
}

type GroupItem = {
  name?: string
  display_name?: string
  recommended?: boolean
  ratio?: number | null
  desc?: string
}
type ModelsResponse = { models?: { id?: string }[] }

const TOOL_TO_PURPOSE: Record<string, Claude360TokenPurpose> = {
  codex: 'text',
  image: 'image',
  music: 'music'
}

// 后端 `/api/cli/groups` 经 common.ApiSuccess 包装后 `data` 为**数组**；
// 但历史/测试也可能是 `{ groups: [...] }`。这里两种形态都兼容，避免因外层
// 形态差异导致分组读不到、provider 与 selected group 全部落空。
function extractGroups(resp: unknown): GroupItem[] {
  if (Array.isArray(resp)) return resp as GroupItem[]
  const nested = (resp as { groups?: unknown } | null)?.groups
  return Array.isArray(nested) ? (nested as GroupItem[]) : []
}

export class Claude360ModelService {
  private readonly deps: Claude360ModelServiceDeps

  constructor(deps: Claude360ModelServiceDeps) {
    this.deps = deps
  }

  private async cliToken(): Promise<string> {
    const token = await this.deps.secretStore.loadSecret(CLAUDE360_CLI_TOKEN_REF)
    if (!token) throw new Claude360ApiError('未登录，请先登录 Claude360')
    return token
  }

  private async fetchGroupsByPurpose(token: string): Promise<{
    groupsByPurpose: Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]>
    purposeByGroup: Map<string, Claude360TokenPurpose>
  }> {
    // 按工具拉分组：记录每个分组首次出现的用途（codex→text / image / music），
    // 保留完整清单（含 recommended/ratio/desc），供选默认分组与「分组及Key」页展示。
    const groupsByPurpose: Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]> = {
      text: [],
      image: [],
      music: []
    }
    const purposeByGroup = new Map<string, Claude360TokenPurpose>()
    for (const tool of ['codex', 'image', 'music'] as const) {
      const purpose = TOOL_TO_PURPOSE[tool]
      const resp = await this.deps.apiClient.get<unknown>(`/api/cli/groups?tool=${tool}`, token)
      const seen = new Set<string>()
      for (const g of extractGroups(resp)) {
        const name = (g.name ?? '').trim()
        if (!name || seen.has(name)) continue
        seen.add(name)
        groupsByPurpose[purpose].push({
          name,
          recommended: g.recommended === true,
          ratio: typeof g.ratio === 'number' ? g.ratio : null,
          desc: typeof g.desc === 'string' ? g.desc : undefined
        })
        if (!purposeByGroup.has(name)) purposeByGroup.set(name, purpose)
      }
    }
    return { groupsByPurpose, purposeByGroup }
  }

  /** 拉取用户全部可用分组（不带 tool 过滤），供「分组及Key」全量展示。 */
  private async fetchAllGroups(token: string): Promise<Claude360ToolGroupInfo[]> {
    const resp = await this.deps.apiClient.get<unknown>('/api/cli/groups', token)
    const seen = new Set<string>()
    const out: Claude360ToolGroupInfo[] = []
    for (const g of extractGroups(resp)) {
      const name = (g.name ?? '').trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push({
        name,
        recommended: g.recommended === true,
        ratio: typeof g.ratio === 'number' ? g.ratio : null,
        desc: typeof g.desc === 'string' ? g.desc : undefined
      })
    }
    return out
  }

  /** 纯拉分组清单（含倍率/描述/推荐），无副作用（不 ensure Key、不写 settings）。供「分组及Key」页。 */
  async listGroups(): Promise<Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]>> {
    const token = await this.cliToken()
    const { groupsByPurpose } = await this.fetchGroupsByPurpose(token)
    // 「分组及Key」需展示用户**全部**可用分组：额外拉一次不带 tool 的全量清单，
    // 把未被 codex/image/music 命中的分组补入 text 桶（多为纯文本/通用分组），
    // 使 all 视图（三桶并集）= 用户全量分组。选默认分组的带 tool 归类不受影响。
    // 全量补全失败不应拖垮整页：降级为仅展示三桶命中的分组（保证鲁棒性）。
    let all: Claude360ToolGroupInfo[] = []
    try {
      all = await this.fetchAllGroups(token)
    } catch {
      all = []
    }
    const known = new Set<string>()
    for (const p of ['text', 'image', 'music'] as Claude360TokenPurpose[]) {
      for (const g of groupsByPurpose[p]) known.add(g.name)
    }
    for (const g of all) {
      if (!known.has(g.name)) groupsByPurpose.text.push(g)
    }
    return groupsByPurpose
  }

  /** 按分组拉可用模型 id（去重）。供「分组及Key」页详情懒加载。 */
  async listModelsByGroup(group: string): Promise<string[]> {
    const token = await this.cliToken()
    const resp = await this.deps.apiClient.get<ModelsResponse>(
      `/api/cli/models?group=${encodeURIComponent(group)}`,
      token
    )
    const seen = new Set<string>()
    const out: string[] = []
    for (const m of resp.models ?? []) {
      const id = (m.id ?? '').trim()
      if (id && !seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
    return out
  }

  async refreshGroupsAndModels(): Promise<Claude360ModelSyncResult> {
    const token = await this.cliToken()

    // 1) 拉分组（含 recommended/ratio/desc）。
    const { groupsByPurpose, purposeByGroup } = await this.fetchGroupsByPurpose(token)

    // 2) 每个分组拉模型，标注图片模型。刷新只同步服务端状态，不创建 Key。
    const groupInputs: Claude360GroupModelsInput[] = []
    const allModels: string[] = []
    for (const group of purposeByGroup.keys()) {
      const resp = await this.deps.apiClient.get<ModelsResponse>(
        `/api/cli/models?group=${encodeURIComponent(group)}`,
        token
      )
      const models = (resp.models ?? [])
        .map((m) => (m.id ?? '').trim())
        .filter(Boolean)
        .map((id) => ({ id, isImage: isClaude360ImageModelId(id) }))
      groupInputs.push({ group, models })
      for (const m of models) if (!allModels.includes(m.id)) allModels.push(m.id)
    }

    const providerProfiles = buildClaude360ProviderProfiles(groupInputs, {})
    const modelCache: Claude360ModelCache = {
      groups: [...purposeByGroup.keys()],
      models: allModels
    }
    return { modelCache, providerProfiles, groupsByPurpose }
  }
}
