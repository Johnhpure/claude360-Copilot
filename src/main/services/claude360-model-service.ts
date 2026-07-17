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

function groupSummary(group: Claude360ToolGroupInfo): string {
  return `${group.name}(recommended=${group.recommended}, ratio=${group.ratio ?? 'n/a'}, desc=${group.desc ?? ''})`
}

function logGroupsByPurpose(
  scope: string,
  groupsByPurpose: Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]>
): void {
  console.info(
    `[kun-gui] Claude360 groups ${scope}: ` +
      `text=[${groupsByPurpose.text.map(groupSummary).join(', ')}] ` +
      `image=[${groupsByPurpose.image.map(groupSummary).join(', ')}] ` +
      `music=[${groupsByPurpose.music.map(groupSummary).join(', ')}]`
  )
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
    // 并行拉三个 tool 分组；Promise.all 保序，按固定 ['codex','image','music'] 顺序消费
    // 结果，使 groupsByPurpose 推入顺序与 purposeByGroup「首次出现优先」语义与串行版字节一致。
    const tools = ['codex', 'image', 'music'] as const
    const perTool = await Promise.all(
      tools.map(async (tool) => ({
        tool,
        resp: await this.deps.apiClient.get<unknown>(`/api/cli/groups?tool=${tool}`, token)
      }))
    )
    for (const { tool, resp } of perTool) {
      const purpose = TOOL_TO_PURPOSE[tool]
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

  /**
   * 统一拉取 Claude360 分组：先按 tool=codex/image/music 分类，再用不带 tool 的全量
   * 分组补齐 text 桶。这样设置页与 Code 模型选择器共享同一套分组兜底逻辑。
   */
  private async fetchClaude360Groups(token: string): Promise<{
    groupsByPurpose: Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]>
    purposeByGroup: Map<string, Claude360TokenPurpose>
  }> {
    console.info('[kun-gui] Claude360 groups login=true; fetching tool-scoped groups for code/text,image,music')
    // 分组阶段并行：tool-scoped 三请求（fetchGroupsByPurpose 内部 Promise.all）与不带
    // tool 的全量 all-groups 请求并发发起。all-groups 允许失败（历史语义：全量拉取失败
    // 仅回落 tool-scoped），故独立 catch 包装其 settled 结果，不让其 rejection 影响
    // tool-scoped 的严格失败传播（任一 tool 请求失败仍整体 throw → 上游 keep-stale-cache）。
    const allGroupsSettled = this.fetchAllGroups(token).then(
      (all) => ({ ok: true as const, all }),
      (error) => ({ ok: false as const, error })
    )
    const { groupsByPurpose, purposeByGroup } = await this.fetchGroupsByPurpose(token)
    logGroupsByPurpose('tool-scoped', groupsByPurpose)

    const allResult = await allGroupsSettled
    let all: Claude360ToolGroupInfo[] = []
    if (allResult.ok) {
      all = allResult.all
      console.info(`[kun-gui] Claude360 groups full-list=[${all.map(groupSummary).join(', ')}]`)
    } else {
      console.warn(
        '[kun-gui] Claude360 groups full-list fetch failed; using tool-scoped groups only:',
        allResult.error instanceof Error ? allResult.error.message : String(allResult.error)
      )
    }

    const known = new Set<string>()
    for (const purpose of ['text', 'image', 'music'] as Claude360TokenPurpose[]) {
      for (const group of groupsByPurpose[purpose]) known.add(group.name)
    }
    for (const group of all) {
      if (known.has(group.name)) continue
      groupsByPurpose.text.push(group)
      purposeByGroup.set(group.name, 'text')
      known.add(group.name)
      console.info(
        `[kun-gui] Claude360 groups fallback: group="${group.name}" not returned by tool filters; classify as text/code`
      )
    }
    logGroupsByPurpose('merged', groupsByPurpose)
    return { groupsByPurpose, purposeByGroup }
  }

  /** 纯拉分组清单（含倍率/描述/推荐），无副作用（不 ensure Key、不写 settings）。供「分组及Key」页。 */
  async listGroups(): Promise<Record<Claude360TokenPurpose, Claude360ToolGroupInfo[]>> {
    const token = await this.cliToken()
    const { groupsByPurpose } = await this.fetchClaude360Groups(token)
    console.info('[kun-gui] settings groups page receives merged Claude360 groups')
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

    // 1) 拉分组（含 recommended/ratio/desc）。设置页和 Code picker 共用同一兜底逻辑。
    const { groupsByPurpose, purposeByGroup } = await this.fetchClaude360Groups(token)

    // 2) 每个分组拉模型，标注图片模型。刷新只同步服务端状态，不创建 Key。
    //    并行发起、按 purposeByGroup 既有插入顺序消费结果——groupInputs / allModels
    //    的构建顺序必须与串行版字节一致（provider id/指纹依赖此顺序，禁止「先完成先处理」）。
    const perGroup = await Promise.all(
      [...purposeByGroup.keys()].map(async (group) => ({
        group,
        resp: await this.deps.apiClient.get<ModelsResponse>(
          `/api/cli/models?group=${encodeURIComponent(group)}`,
          token
        )
      }))
    )

    const groupInputs: Claude360GroupModelsInput[] = []
    const allModels: string[] = []
    for (const { group, resp } of perGroup) {
      const purpose = purposeByGroup.get(group)
      const models = (resp.models ?? [])
        .map((m) => (m.id ?? '').trim())
        .filter(Boolean)
        .map((id) => ({ id, isImage: isClaude360ImageModelId(id) }))
      console.info(
        `[kun-gui] Claude360 group models feature=code purpose=${purpose ?? 'unknown'} ` +
          `group="${group}" models=[${models.map((m) => m.id).join(', ')}]`
      )
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
