/**
 * 「执行任务时 → 确保所选分组有可用 API Key」的核心逻辑（Code/写作/生图/音乐共用）。
 *
 * 移除"供应商"概念后，选模型 = 选分组(claude360:<group>)+模型。运行时按分组的
 * Key 调用；若分组还没建过 Key，profile.apiKeyRef 为空 → 401。本模块在「点执行」
 * 时补上这一环：无 Key 则弹优雅模态询问，确认后自动建 Key 并续跑本次任务。
 *
 * 分组匹配一律走 sameClaude360Group（大小写不敏感）：providerId 归一化会 lowercase
 * 分组名（"Codex"→"claude360-codex"），而服务端 token.group 保留原始大小写，
 * 裸 === 曾把已有 5 个 Key 的 Codex 分组误判为无 Key 并反复弹窗创建。
 *
 * 纯逻辑，所有副作用经 deps 注入，便于单测。
 */
import { sameClaude360Group } from '@shared/claude360'

/**
 * 从 providerId 提取 claude360 分组名。构造格式 `claude360:<group>`，settings 归一化后
 * 为 `claude360-<group>`（且整体 lowercase），两种都兼容；非 claude360 返回 null。
 * 注意：返回值可能与服务端原始分组名大小写不同，只能配合 sameClaude360Group 使用，
 * 权威形态由 main 侧 tokens:ensure 按 profile.name 还原。
 */
export function groupNameFromProviderId(providerId: string | undefined): string | null {
  const id = (providerId ?? '').trim()
  if (!id) return null
  const lower = id.toLowerCase()
  if (lower.startsWith('claude360:') || lower.startsWith('claude360-')) {
    return id.slice('claude360:'.length) || null
  }
  return null
}

/** 调试日志上下文：功能入口 + 当前选择，用于排查「分组明明有 Key 却弹创建」类误判。 */
export type GroupKeyEnsureContext = {
  /** 功能类型：Code / 写作 / 生图 / 音乐。 */
  feature: string
  /** 当前选中的模型 id（生图/音乐无模型概念时可空）。 */
  model?: string
  /** 原始 providerId（Code/写作路径），便于核对归一化前后形态。 */
  providerId?: string
}

/**
 * 「该分组已验证有可用 Key」的正向结果缓存（07-05 首次对话慢修复）：
 * 同分组连续发送时跳过 listTokens + ensure 的两次网络往返。
 * - 两级验证：'listed'=仅确认服务端有可用 Key（生图/音乐路径，不注入 ensureUsableKey）；
 *   'ensured'=已静默 ensure 完整 Key 并回填 apiKeyRef（Code/写作路径）。
 *   带 ensureUsableKey 的调用只认 'ensured' 级缓存——否则生图先验证过的分组会让
 *   Code 跳过 apiKeyRef 回填而 401（审查 Critical 2）。
 * - 仅缓存正向结果；fail-open 与失败不缓存。
 * - TTL 兜底 + 显式失效（创建/删除 Key、切换账号、刷新分组时调 invalidateGroupKeyCache）。
 * - 缓存过期或失效后回到实时检测，弹窗语义不变。
 */
type GroupKeyVerifiedLevel = 'listed' | 'ensured'
const verifiedGroups = new Map<string, { at: number; level: GroupKeyVerifiedLevel }>()
export const GROUP_KEY_CACHE_TTL_MS = 5 * 60_000

/** 失效已验证分组缓存：不传 group 时全清（账号切换等全局事件用）。 */
export function invalidateGroupKeyCache(group?: string): void {
  if (group === undefined) {
    verifiedGroups.clear()
    return
  }
  verifiedGroups.delete(group.trim().toLowerCase())
}

function verifiedCacheAgeMs(group: string, now: number, requiredLevel: GroupKeyVerifiedLevel): number | null {
  const key = group.trim().toLowerCase()
  const entry = verifiedGroups.get(key)
  if (entry === undefined) return null
  const age = now - entry.at
  if (age < 0 || age >= GROUP_KEY_CACHE_TTL_MS) {
    verifiedGroups.delete(key)
    return null
  }
  if (requiredLevel === 'ensured' && entry.level !== 'ensured') return null
  return age
}

function rememberVerifiedGroup(group: string, now: number, level: GroupKeyVerifiedLevel): void {
  const key = group.trim().toLowerCase()
  const existing = verifiedGroups.get(key)
  // 'ensured' 不被 'listed' 降级：Code ensure 过后生图再验证只会刷新时间戳。
  const nextLevel = existing?.level === 'ensured' || level === 'ensured' ? 'ensured' : 'listed'
  verifiedGroups.set(key, { at: now, level: nextLevel })
}

export type GroupKeyEnsureDeps = {
  /** 拉取当前用户所有 Key（实时请求，不走缓存），用于检测该分组是否已有可用 Key。 */
  listTokens: () => Promise<{ group: string; id?: number; name?: string; status?: number }[]>
  /**
   * 静默确保该分组 Key 已在本机可用：main 侧会 reveal/create、缓存完整 key，
   * 并把 profile.apiKeyRef 回填给运行时。已有服务端 Key 也必须走这一步，
   * 因为 settings 列表里的 maskedKey 不是可调用 secret。
   */
  ensureUsableKey?: (group: string) => Promise<boolean>
  /**
   * 弹出"是否为该分组创建 Key"的优雅模态，用户确认时内部执行建 Key(ensure 回填 ref)，
   * 返回最终是否已就绪（true=已有/已建成功；false=用户取消或建失败）。
   */
  promptCreateAndEnsure: (group: string) => Promise<boolean>
  /** 调试日志出口，默认 console.info；测试可注入捕获。 */
  log?: (message: string) => void
  /** 时钟注入（缓存 TTL 单测用），默认 Date.now。 */
  now?: () => number
}

function describeTokens(tokens: { group: string; id?: number; name?: string; status?: number }[]): string {
  if (tokens.length === 0) return '(空)'
  return tokens
    .map(
      (t) =>
        `#${t.id ?? '?'} group="${t.group}"${t.name ? ` name="${t.name}"` : ''}${
          t.status !== undefined && t.status !== 1 ? ' [已禁用]' : ''
        }`
    )
    .join(', ')
}

/**
 * 统一的「执行前分组 Key 检测」入口（任务书要求的 resolveGroupKey 角色）。
 * - group 为 null（非 claude360 分组/未识别）→ 直接放行 true。
 * - 已有该分组 Key（大小写不敏感匹配）→ true，直接调用不弹窗。
 * - 无 → 弹窗询问；确认建成 → true（调用方续跑）；取消/失败 → false（调用方中止本次任务）。
 * - 检测本身失败（未登录/网络）→ fail-open 放行 true：让请求继续走出去，由运行时/
 *   服务端返回可见错误；否则任务会被静默吞掉且无任何提示。
 */
export async function ensureGroupKeyForSelection(
  group: string | null,
  deps: GroupKeyEnsureDeps,
  context?: GroupKeyEnsureContext
): Promise<boolean> {
  const log = deps.log ?? ((message: string) => console.info(message))
  const now = deps.now ?? (() => Date.now())
  const head = `[group-key] feature=${context?.feature ?? '?'} group="${group ?? ''}"${
    context?.model ? ` model="${context.model}"` : ''
  }${context?.providerId ? ` providerId="${context.providerId}"` : ''}`
  if (!group) {
    log(`${head} 非 Claude360 分组/未选择分组 → 跳过 Key 检测`)
    return true
  }
  // 带 ensureUsableKey 的调用（Code/写作）只认 'ensured' 级缓存；
  // 不带的（生图/音乐）'listed' 即可。
  const requiredLevel: GroupKeyVerifiedLevel = deps.ensureUsableKey ? 'ensured' : 'listed'
  const cacheAge = verifiedCacheAgeMs(group, now(), requiredLevel)
  if (cacheAge !== null) {
    log(`${head} 命中已验证缓存（${Math.round(cacheAge / 1000)}s 前验证）→ 跳过 keyList/ensure 网络检测`)
    return true
  }
  let tokens: { group: string; id?: number; name?: string; status?: number }[]
  try {
    tokens = await deps.listTokens()
  } catch (error) {
    log(
      `${head} keyList 拉取失败(${error instanceof Error ? error.message : String(error)}) → fail-open 放行，由服务端报可见错误`
    )
    return true
  }
  // 「可用 Key」口径与 main 侧查重一致：status 缺省视为启用，非 1 的禁用 Key 不算数
  // （分组只剩禁用 Key 时应弹创建弹窗自愈，而不是放行后 401）。
  const sameGroupTokens = tokens.filter((t) => sameClaude360Group(t.group, group))
  const matched = sameGroupTokens.find((t) => t.status === undefined || t.status === 1)
  if (matched) {
    log(
      `${head} keys=${tokens.length} [${describeTokens(tokens)}] → 匹配到 #${matched.id ?? '?'} group="${matched.group}"，准备静默 ensure 完整 Key`
    )
    if (!deps.ensureUsableKey) {
      rememberVerifiedGroup(group, now(), 'listed')
      return true
    }
    try {
      const ready = await deps.ensureUsableKey(group)
      log(`${head} matchedKeyId=${matched.id ?? '?'} ensureUsableKey=${ready ? 'ok' : 'failed'}`)
      if (ready) rememberVerifiedGroup(group, now(), 'ensured')
      return ready
    } catch (error) {
      log(
        `${head} matchedKeyId=${matched.id ?? '?'} ensureUsableKey 异常(${
          error instanceof Error ? error.message : String(error)
        }) → 中止本次调用`
      )
      return false
    }
  }
  const reason =
    sameGroupTokens.length > 0
      ? `同分组的 ${sameGroupTokens.length} 个 Key 均已禁用`
      : '所有 Key 的 group 与当前分组均不同（大小写不敏感比较后仍不同）'
  log(`${head} keys=${tokens.length} [${describeTokens(tokens)}] → 未匹配：${reason} → 弹窗询问自动创建`)
  const created = await deps.promptCreateAndEnsure(group)
  // 弹窗建 Key 内部执行了 ensure 回填（tokens:ensure），达到 'ensured' 级。
  if (created) rememberVerifiedGroup(group, now(), 'ensured')
  return created
}
