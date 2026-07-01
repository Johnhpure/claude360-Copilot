// 「我的」页的纯编排函数(codex plan-03 Task 6)。
//
// 把创建 Key、充值、订单轮询等异步流程从 React 组件里剥离出来,
// 只依赖一个最小的 kunGui 子集(通过参数注入),便于在 node 环境下用
// renderToStaticMarkup + mock 直接单测,而不需要 jsdom / testing-library。
import type {
  Claude360Me,
  Claude360TokenListItem,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder,
  Claude360TopupOrderStatus
} from '@shared/claude360'
import type { Claude360TokenRef } from '@shared/app-settings-claude360'

/** 「我的」页需要用到的 kunGui 子集(与真实签名一致)。 */
export type MyPageApi = {
  claude360BillingMe: () => Promise<Claude360Me>
  claude360TokensList: () => Promise<Claude360TokenListItem[]>
  claude360TokensCreate: (payload: { group?: string; name: string }) => Promise<Claude360TokenRef>
  claude360TokensReveal: (payload: { tokenId: number }) => Promise<{ key: string }>
  claude360BillingTopupOptions: () => Promise<Claude360TopupOptions>
  claude360BillingTopupWechat: (payload: { amount: number; discountCode?: string }) => Promise<Claude360TopupOrder>
  claude360BillingTopupOrder: (payload: { orderId: string }) => Promise<Claude360TopupOrderStatus>
  claude360BillingTokenStats: (payload: { startTimestamp?: number; endTimestamp?: number }) => Promise<Claude360TokenStat[]>
}

/** 订单是否已完成:newapi 完成后会回填 completeTime(秒)。 */
export function isTopupOrderComplete(order: Claude360TopupOrderStatus): boolean {
  return order.completeTime > 0
}

export type CreateTokenResult =
  | { ok: true; ref: Claude360TokenRef; tokens: Claude360TokenListItem[] }
  | { ok: false; message: string }

/**
 * 创建一个新的 API Key,成功后重新拉取分组列表。
 * 返回刷新后的 tokens,供调用方直接落到 state。
 */
export async function createTokenAndRefresh(
  api: Pick<MyPageApi, 'claude360TokensCreate' | 'claude360TokensList'>,
  input: { name: string; group?: string }
): Promise<CreateTokenResult> {
  try {
    const ref = await api.claude360TokensCreate({ name: input.name, group: input.group })
    const tokens = await api.claude360TokensList()
    return { ok: true, ref, tokens }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export type PollTopupOptions = {
  /** 最多轮询次数(默认 60)。 */
  maxAttempts?: number
  /** 每次轮询间隔毫秒(默认 3000)。 */
  intervalMs?: number
  /** 睡眠实现,便于测试注入(默认 setTimeout)。 */
  sleep?: (ms: number) => Promise<void>
  /** 每次拿到订单状态后回调(用于 UI 展示进度)。 */
  onStatus?: (status: Claude360TopupOrderStatus) => void
  /** 允许外部中断轮询(返回 true 表示应停止)。 */
  shouldAbort?: () => boolean
}

export type PollTopupResult =
  | { ok: true; completed: true; status: Claude360TopupOrderStatus }
  | { ok: true; completed: false }
  | { ok: false; message: string }

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 轮询微信充值订单直至完成或超时。完成后不直接刷新余额,
 * 交由调用方在 completed=true 时调用 refreshMe(),保持职责单一。
 */
export async function pollTopupOrderUntilComplete(
  api: Pick<MyPageApi, 'claude360BillingTopupOrder'>,
  orderId: string,
  options: PollTopupOptions = {}
): Promise<PollTopupResult> {
  const maxAttempts = options.maxAttempts ?? 60
  const intervalMs = options.intervalMs ?? 3000
  const sleep = options.sleep ?? defaultSleep
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (options.shouldAbort?.()) return { ok: true, completed: false }
      const status = await api.claude360BillingTopupOrder({ orderId })
      options.onStatus?.(status)
      if (isTopupOrderComplete(status)) {
        return { ok: true, completed: true, status }
      }
      await sleep(intervalMs)
    }
    return { ok: true, completed: false }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** 组内所有 Key 的剩余额度合计(unlimited 不计入数值)。 */
export function summarizeTokenGroups(
  tokens: Claude360TokenListItem[]
): { group: string; count: number; hasUnlimited: boolean }[] {
  const byGroup = new Map<string, { count: number; hasUnlimited: boolean }>()
  for (const token of tokens) {
    const key = token.group || 'default'
    const entry = byGroup.get(key) ?? { count: 0, hasUnlimited: false }
    entry.count += 1
    if (token.unlimitedQuota) entry.hasUnlimited = true
    byGroup.set(key, entry)
  }
  return [...byGroup.entries()]
    .map(([group, value]) => ({ group, ...value }))
    .sort((a, b) => a.group.localeCompare(b.group))
}
