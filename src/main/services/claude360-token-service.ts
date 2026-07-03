import type {
  Claude360SettingsPatchV1,
  Claude360SettingsV1,
  Claude360TokenRef
} from '../../shared/app-settings-claude360'
import type {
  Claude360CreateTokenResponse,
  Claude360RevealTokenResponse,
  Claude360TokenListItem,
  Claude360TokenListResponse,
  Claude360TokenPurpose
} from '../../shared/claude360'
import { normalizeClaude360GroupKey, sameClaude360Group } from '../../shared/claude360'
import { Claude360ApiError } from './claude360-api-client'
import { CLAUDE360_CLI_TOKEN_REF, claude360ApiKeyRef, type Claude360SecretStore } from './claude360-secret-store'

/**
 * Claude360 API Key（newapi token）管理服务（plan-03 Task 1）。
 *
 * - 调用 `/api/cli/tokens*` 需带 cli_token（access token），从 secretStore 读取。
 * - 创建/reveal 得到的明文 Key 立即加密存入 secretStore；settings 只存脱敏 ref。
 * - reveal 仅在用户显式操作或 ensure 时本地 secret 缺失才调用。
 */

export type Claude360ApiClientPort = {
  get<T>(path: string, token?: string): Promise<T>
  post<T>(path: string, body?: unknown, token?: string): Promise<T>
  delete<T>(path: string, token?: string): Promise<T>
}

export type Claude360TokenServiceDeps = {
  apiClient: Claude360ApiClientPort
  secretStore: Claude360SecretStore
  readClaude360(): Claude360SettingsV1 | Promise<Claude360SettingsV1>
  writeClaude360(patch: Claude360SettingsPatchV1): void | Promise<void>
}

export const CLAUDE360_TOKEN_NAME_PREFIX = 'Claude360 Copilot'

export type Claude360EnsuredTokenRef = Claude360TokenRef & {
  /** True when ensure wrote a full key value into secret-store during this call. */
  secretUpdated: boolean
  /** True when ensure had to create a new server-side token. */
  tokenCreated: boolean
}

/**
 * tokenRefs 存储键：按 `purpose + group` 双维度隔离，避免同一 purpose 下
 * 不同分组（如 auto/text 与 vip/text）互相覆盖、复用到错误分组的 API Key。
 * group 段统一归一化（小写），避免 "Codex"/"codex" 两种来源写出两个键；
 * 历史原样大小写的键由 findScopedTokenRef 做不敏感兜底读取。
 * 旧数据用扁平 purpose 作键（legacy），读取时单独兜底并做 group 校验。
 */
export function claude360TokenRefKey(purpose: Claude360TokenPurpose, group: string): string {
  return `${purpose}:${normalizeClaude360GroupKey(group)}`
}

/**
 * 在 tokenRefs 里按 purpose+group 查 ref：先精确命中归一化键，再对历史键
 * （可能保留原始大小写）做大小写不敏感兜底；条目自身的 group 也须同组才可信。
 */
function findScopedTokenRef(
  tokenRefs: Record<string, Claude360TokenRef>,
  purpose: Claude360TokenPurpose,
  group: string
): Claude360TokenRef | undefined {
  const exact = tokenRefs[claude360TokenRefKey(purpose, group)]
  if (exact) return exact
  const prefix = `${purpose}:`
  for (const [key, ref] of Object.entries(tokenRefs)) {
    if (!key.startsWith(prefix)) continue
    if (sameClaude360Group(key.slice(prefix.length), group) && sameClaude360Group(ref.group, group)) {
      return ref
    }
  }
  return undefined
}

function mapTokenItem(item: Claude360TokenListResponse['items'][number]): Claude360TokenListItem {
  return {
    id: item.id,
    name: item.name,
    maskedKey: item.masked_key ?? '',
    status: item.status ?? 1,
    group: item.group ?? '',
    remainQuota: item.remain_quota ?? 0,
    unlimitedQuota: item.unlimited_quota === true
  }
}

export class Claude360TokenService {
  private readonly deps: Claude360TokenServiceDeps
  // 按 group|purpose 记录进行中的 ensureGroupToken，防止同一分组/用途首次并发触发
  // 重复 reveal / 重复 createToken（在中转站建出多把 token → 误计费/脏数据）。
  private readonly ensureInflight = new Map<string, Promise<Claude360EnsuredTokenRef>>()

  constructor(deps: Claude360TokenServiceDeps) {
    this.deps = deps
  }

  private async cliToken(): Promise<string> {
    const token = await this.deps.secretStore.loadSecret(CLAUDE360_CLI_TOKEN_REF)
    if (!token) throw new Claude360ApiError('未登录，请先登录 Claude360')
    return token
  }

  async listTokens(): Promise<Claude360TokenListItem[]> {
    const token = await this.cliToken()
    const resp = await this.deps.apiClient.get<Claude360TokenListResponse>('/api/cli/tokens', token)
    return (resp.items ?? []).map(mapTokenItem)
  }

  async createToken(group: string, name: string): Promise<Claude360TokenRef> {
    const token = await this.cliToken()
    const resp = await this.deps.apiClient.post<Claude360CreateTokenResponse>(
      '/api/cli/tokens',
      { name, group },
      token
    )
    // 明文 Key 立即加密落盘；不进入 settings。
    await this.deps.secretStore.saveSecret(claude360ApiKeyRef(resp.id), resp.key)
    return { tokenId: resp.id, name: resp.name, group: resp.group }
  }

  async revealToken(tokenId: number): Promise<string> {
    const token = await this.cliToken()
    const resp = await this.deps.apiClient.post<Claude360RevealTokenResponse>(
      `/api/cli/tokens/${tokenId}/reveal`,
      undefined,
      token
    )
    return resp.key
  }

  /**
   * 删除指定 API Key：后端删除 + 清掉本地明文缓存。
   * tokenRefs 里指向该 tokenId 的悬空条目不在此单独删除（浅合并无法删键），
   * 由 ensureGroupToken 的自愈重建覆盖（reveal 失败→重建，同 scopedKey 覆盖）。
   */
  async deleteToken(tokenId: number): Promise<void> {
    const token = await this.cliToken()
    await this.deps.apiClient.delete(`/api/cli/tokens/${tokenId}`, token)
    await this.deps.secretStore.deleteSecret(claude360ApiKeyRef(tokenId))
  }

  /** 确保某用途有可用的分组 Key：已存且 secret 可读则复用；secret 缺失则 reveal；都没有则创建。 */
  async ensureGroupToken(group: string, purpose: Claude360TokenPurpose): Promise<Claude360EnsuredTokenRef> {
    // in-flight 去重：同一 group|purpose 并发调用共用同一 Promise，避免重复建 token。
    // 键用归一化分组名，"Codex"/"codex" 两种来源的并发也能合并。
    const key = `${normalizeClaude360GroupKey(group)}|${purpose}`
    const pending = this.ensureInflight.get(key)
    if (pending) return pending
    const task = this.ensureGroupTokenUncached(group, purpose).finally(() => {
      this.ensureInflight.delete(key)
    })
    this.ensureInflight.set(key, task)
    return task
  }

  private async ensureGroupTokenUncached(
    group: string,
    purpose: Claude360TokenPurpose
  ): Promise<Claude360EnsuredTokenRef> {
    const settings = await this.deps.readClaude360()
    const scopedKey = claude360TokenRefKey(purpose, group)
    // 读取顺序：优先 group-scoped ref（含历史大小写键兜底）；否则回退 legacy 扁平
    // tokenRefs[purpose]，但仅当其 group 与请求同组才允许复用（否则可能把 A 组 Key 用到 B 组）。
    const scoped = findScopedTokenRef(settings.tokenRefs, purpose, group)
    const legacy = settings.tokenRefs[purpose]
    const existing = scoped ?? (legacy && sameClaude360Group(legacy.group, group) ? legacy : undefined)
    if (existing) {
      const secret = await this.deps.secretStore.loadSecret(claude360ApiKeyRef(existing.tokenId))
      if (secret) {
        // 固化/迁移到 group-scoped key（legacy/历史大小写键命中或首次写入时补齐）。
        await this.deps.writeClaude360({ tokenRefs: { [scopedKey]: existing } })
        console.info(
          `[kun-gui] ensureGroupToken group="${group}" purpose=${purpose} → 复用本地 ref #${existing.tokenId}(group="${existing.group}")`
        )
        return { ...existing, secretUpdated: false, tokenCreated: false }
      }
      // secret 缺失：尝试 reveal 补回；若 token 已被删除（reveal 失败），丢弃悬空 ref，
      // 落到下方重建流程，避免删 Key 后该分组永远 ensure 失败。
      try {
        const revealed = await this.revealToken(existing.tokenId)
        await this.deps.secretStore.saveSecret(claude360ApiKeyRef(existing.tokenId), revealed)
        await this.deps.writeClaude360({ tokenRefs: { [scopedKey]: existing } })
        return { ...existing, secretUpdated: true, tokenCreated: false }
      } catch {
        // 悬空 ref：继续走下方重建（scopedKey 将被新 ref 覆盖）。
      }
    }

    const tokens = await this.listTokens()
    // 创建前查重（大小写不敏感）：该分组已有任意启用的 Key 就复用，绝不重复创建——
    // 优先复用本应用自动创建的前缀 Key；用户手动创建的 Key 同样是该分组的有效凭据。
    const groupTokens = tokens.filter((tk) => tk.status === 1 && sameClaude360Group(tk.group, group))
    const match =
      groupTokens.find((tk) => tk.name.startsWith(CLAUDE360_TOKEN_NAME_PREFIX)) ?? groupTokens[0]
    let ref: Claude360TokenRef
    if (match) {
      console.info(
        `[kun-gui] ensureGroupToken group="${group}" purpose=${purpose} → 复用服务端已有 Key #${match.id}(group="${match.group}", name="${match.name}")`
      )
      const revealed = await this.revealToken(match.id)
      await this.deps.secretStore.saveSecret(claude360ApiKeyRef(match.id), revealed)
      ref = { tokenId: match.id, name: match.name, group: match.group }
    } else {
      console.info(
        `[kun-gui] ensureGroupToken group="${group}" purpose=${purpose} → 该分组无任何可用 Key（账号共 ${tokens.length} 个 Key，均不属于此分组或未启用），创建新 Key`
      )
      ref = await this.createToken(group, `${CLAUDE360_TOKEN_NAME_PREFIX} / ${purpose}`)
    }
    await this.deps.writeClaude360({ tokenRefs: { [scopedKey]: ref } })
    return { ...ref, secretUpdated: true, tokenCreated: !match }
  }
}
