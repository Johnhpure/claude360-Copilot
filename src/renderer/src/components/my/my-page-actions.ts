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

/**
 * 充值订单轮询阶段(充值弹窗据此推导视图)。
 * failed/expired 映射后端字符串枚举的终态;轮询跑满上限(timeout)也归入 expired 展示。
 */
export type BillingPollPhase = 'idle' | 'pending' | 'completed' | 'failed' | 'expired'

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
  | { ok: true; completed: false; reason: 'timeout' | 'aborted' | 'failed' | 'expired' }
  | { ok: false; message: string }

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 轮询微信充值订单直至完成或超时。完成后不直接刷新余额,
 * 交由调用方在 completed=true 时调用 refreshMe(),保持职责单一。
 * 后端 status 为字符串枚举 pending/success/failed/expired:
 * 遇 failed/expired 终态提前终止(旧实现会傻等到轮询上限),reason 区分未完成原因。
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
      if (options.shouldAbort?.()) return { ok: true, completed: false, reason: 'aborted' }
      const status = await api.claude360BillingTopupOrder({ orderId })
      options.onStatus?.(status)
      if (isTopupOrderComplete(status)) {
        return { ok: true, completed: true, status }
      }
      if (status.status === 'failed' || status.status === 'expired') {
        return { ok: true, completed: false, reason: status.status }
      }
      await sleep(intervalMs)
    }
    return { ok: true, completed: false, reason: 'timeout' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

// ── 二维码 payload 分类(R4) ──

export type QrPayload =
  | { kind: 'encode'; value: string } // weixin:// 等支付链接 → QRCodeSVG 前端编码
  | { kind: 'image'; src: string } // dataURL / http(s) URL / 补前缀后的裸 base64 → <img>
  | { kind: 'empty' }

/** 裸 base64(无 data: 前缀)判定:纯 base64 字符且足够长(排除短支付码/口令)。 */
const BARE_BASE64_RE = /^[A-Za-z0-9+/=]+$/

/**
 * 按内容分类 codeUrl 的渲染方式。判定顺序按可判定性从强到弱:
 * 空 → dataURL → http(s) → 裸 base64(补 png 前缀) → 其余一律当支付链接前端编码。
 * weixin:// 等非 http 协议不能当 img src(浏览器无法加载,恒空白),必须走 encode。
 */
export function classifyQrPayload(codeUrl: string): QrPayload {
  const value = codeUrl.trim()
  if (!value) return { kind: 'empty' }
  if (value.startsWith('data:image/')) return { kind: 'image', src: value }
  if (/^https?:\/\//i.test(value)) return { kind: 'image', src: value }
  if (value.length > 100 && BARE_BASE64_RE.test(value)) {
    return { kind: 'image', src: `data:image/png;base64,${value}` }
  }
  return { kind: 'encode', value }
}

// ── Token 用量视图(R2) ──

export type UsageSortKey = 'tokens' | 'requests'

export type UsageView = {
  /** 全量合计(不受搜索过滤影响,总览始终反映全局)。 */
  totals: { requests: number; tokens: number }
  /** 主要消耗分组 Top 3(按 tokens 降序,占全局总量比)。 */
  top3: Array<{ tokenName: string; sharePct: number }>
  /** 过滤 → 排序 → limit 截断后的表格行。 */
  rows: Array<Claude360TokenStat & { sharePct: number }>
  /** rows 截断后剩余条数(0 = 无需「展开更多」)。 */
  hiddenCount: number
}

const sortValue = (row: Claude360TokenStat, key: UsageSortKey): number =>
  key === 'tokens' ? row.totalTokens : row.requestCount

/**
 * 把 token 用量统计整形为「总览行 + 紧凑表格」视图数据。
 * 纯函数:搜索(大小写不敏感包含)、双键排序、Top N 截断都在此处,组件零业务逻辑。
 */
export function buildUsageView(
  stats: Claude360TokenStat[],
  opts: { query: string; sortKey: UsageSortKey; sortDesc: boolean; limit: number | null }
): UsageView {
  const totals = stats.reduce(
    (acc, row) => {
      acc.requests += row.requestCount
      acc.tokens += row.totalTokens
      return acc
    },
    { requests: 0, tokens: 0 }
  )
  const shareOf = (row: Claude360TokenStat): number =>
    totals.tokens > 0 ? Math.round((row.totalTokens / totals.tokens) * 100) : 0

  const top3 = [...stats]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 3)
    .map((row) => ({ tokenName: row.tokenName, sharePct: shareOf(row) }))

  const query = opts.query.trim().toLowerCase()
  const filtered = query
    ? stats.filter((row) => row.tokenName.toLowerCase().includes(query))
    : stats
  const sorted = [...filtered].sort((a, b) => {
    const diff = sortValue(a, opts.sortKey) - sortValue(b, opts.sortKey)
    return opts.sortDesc ? -diff : diff
  })
  const rows = (opts.limit == null ? sorted : sorted.slice(0, opts.limit)).map((row) => ({
    ...row,
    sharePct: shareOf(row)
  }))

  return { totals, top3, rows, hiddenCount: sorted.length - rows.length }
}
