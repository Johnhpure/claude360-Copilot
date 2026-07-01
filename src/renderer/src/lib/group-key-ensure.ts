/**
 * 「选定分组模型 → 确保该分组有可用 API Key」的核心逻辑（Code 与写作共用）。
 *
 * 移除"供应商"概念后，选模型 = 选分组(claude360:<group>)+模型。运行时按分组的
 * Key 调用；若选了一个还没建过 Key 的分组，profile.apiKeyRef 为空 → 运行时 401。
 * 本模块在"选完模型立即检测"时补上这一环：无 Key 则弹优雅模态询问，确认后建 Key。
 *
 * 纯逻辑，所有副作用经 deps 注入，便于单测。
 */

/**
 * 从 providerId 提取 claude360 分组名。构造格式 `claude360:<group>`，settings 归一化后
 * 为 `claude360-<group>`（只把 `:`→`-`，分组名内字符不变），两种都兼容；非 claude360 返回 null。
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

export type GroupKeyEnsureDeps = {
  /** 拉取当前用户所有 Key（含 group 字段），用于检测该分组是否已有 Key。 */
  listTokens: () => Promise<{ group: string }[]>
  /**
   * 弹出"是否为该分组创建 Key"的优雅模态，用户确认时内部执行建 Key(ensure 回填 ref)，
   * 返回最终是否已就绪（true=已有/已建成功；false=用户取消或建失败）。
   */
  promptCreateAndEnsure: (group: string) => Promise<boolean>
}

/**
 * 确保 group 有可用 Key。
 * - group 为 null（非 claude360 分组/未识别）→ 直接放行 true。
 * - 已有该分组 Key → true。
 * - 无 → 弹窗询问；确认建成 → true；取消/失败 → false（调用方据此回退所选模型）。
 */
export async function ensureGroupKeyForSelection(
  group: string | null,
  deps: GroupKeyEnsureDeps
): Promise<boolean> {
  if (!group) return true
  const tokens = await deps.listTokens()
  if (tokens.some((t) => t.group === group)) return true
  return deps.promptCreateAndEnsure(group)
}
