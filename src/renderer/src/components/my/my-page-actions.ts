// 「我的」页的纯编排函数(codex plan-03 Task 6)。
//
// 把充值、订单轮询等异步流程从 React 组件里剥离出来,便于在 node 环境下用
// renderToStaticMarkup + mock 直接单测,而不需要 jsdom / testing-library。
// 注：API Key 的分组/创建管理已归口到「设置 → 分组及 Key」，本文件不再涉及 Key 编排。
import type {
  Claude360Me,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder,
  Claude360TopupOrderStatus
} from '@shared/claude360'

/** 「我的」页需要用到的 kunGui 子集(与真实签名一致)。 */
export type MyPageApi = {
  claude360BillingMe: () => Promise<Claude360Me>
  claude360BillingTopupOptions: () => Promise<Claude360TopupOptions>
  claude360BillingTopupWechat: (payload: { amount: number; discountCode?: string }) => Promise<Claude360TopupOrder>
  claude360BillingTopupOrder: (payload: { orderId: string }) => Promise<Claude360TopupOrderStatus>
  claude360BillingTokenStats: (payload: { startTimestamp?: number; endTimestamp?: number }) => Promise<Claude360TokenStat[]>
}

/** 订单是否已完成:newapi 完成后会回填 completeTime(秒)。 */
export function isTopupOrderComplete(order: Claude360TopupOrderStatus): boolean {
  return order.completeTime > 0
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
