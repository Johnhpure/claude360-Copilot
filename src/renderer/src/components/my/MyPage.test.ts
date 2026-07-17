import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  Claude360LogItem,
  Claude360Me,
  Claude360TokenListItem,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder,
  Claude360TopupOrderStatus
} from '@shared/claude360'
import type { Claude360TokenRef } from '@shared/app-settings-claude360'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import { MyAccountOverview } from './MyAccountOverview'
import { MyLogsPanel, MyLogsTable } from './MyLogsPanel'
import { MyPage } from './MyPage'
import { MySegTabs } from './MySegTabs'
import { MyTopupModalContent, type MyTopupModalContentProps } from './MyTopupModal'
import { MyUsagePanel } from './MyUsagePanel'
import { defaultLogColumnPrefs } from './my-logs-actions'
import {
  buildUsageView,
  classifyQrPayload,
  isTopupOrderComplete,
  pollTopupOrderUntilComplete,
  type MyPageApi
} from './my-page-actions'

const labels: Record<string, string> = {
  myLoading: 'Loading…',
  myAccount: 'Account',
  myGroup: 'Group tag',
  myBalance: 'Balance',
  myUsedTotal: 'Used total',
  myTodayTokens: "Today's tokens",
  myTodayRequests: "Today's requests",
  myTodayUsage: "Today's spend",
  myLowBalance: 'Balance is low.',
  myTopupNow: 'Top up now',
  myTopupModalTitle: 'Account top-up',
  myMinTopup: 'Minimum top-up',
  myWechatTopup: 'Pay with WeChat',
  myCreatingOrder: 'Creating order…',
  myWechatDisabled: 'WeChat unavailable.',
  myScanToPay: 'Scan to pay',
  myWechatQr: 'WeChat QR',
  myQrError: 'QR code unavailable.',
  myQrImageError: 'QR image failed to load.',
  myWaitingPayment: 'Waiting for payment…',
  myPaymentComplete: 'Payment received.',
  myTopupTimeout: 'Order timed out.',
  myOrderStatusFailed: 'Payment failed.',
  myRegenerateQr: 'Regenerate QR code',
  myDone: 'Done',
  close: 'Close',
  myUsage: 'Token usage',
  myNoUsage: 'No usage data yet.',
  myUsageGroupName: 'Group',
  myUsageRequests: 'Requests',
  myUsageTokens: 'Tokens',
  myUsageCost: 'Cost',
  myUsageTotalRequests: 'Total requests',
  myUsageTotalTokens: 'Total tokens',
  myUsageTop3: 'Top groups',
  myUsageShare: 'Share',
  myUsageSearchPlaceholder: 'Search group name',
  myUsageShowMore: 'Show more',
  myUsageShowLess: 'Show less',
  myLogsTitle: 'Call logs',
  myLogsColumns: 'Columns',
  myLogsColTime: 'Time',
  myLogsColRequestId: 'Request ID',
  myLogsTypeTopup: 'Top-up',
  myLogsTypeConsume: 'Consume',
  myLogsTypeError: 'Error',
  myLogsFirstTokenPrefix: 'first ',
  myLogsDetailExpand: 'Expand detail',
  myLogsDetailCollapse: 'Collapse detail',
  myLogsDetailContent: 'Content',
  myLogsDetailFirstToken: 'First token',
  myLogsDetailFirstTokenNone: '— (no stream)',
  myLogsDetailCopy: 'Copy details'
}

function t(key: string): string {
  return labels[key] ?? key
}

function meFixture(overrides: Partial<Claude360Me> = {}): Claude360Me {
  return {
    username: 'alice',
    displayName: 'Alice Zhang',
    email: 'alice@example.com',
    group: 'vip',
    balanceDisplay: '¥88.50',
    usedDisplay: '¥11.50',
    lowBalance: false,
    todayTokens: 12345,
    todayRequests: 42,
    todayUsageDisplay: '¥3.20',
    ...overrides
  }
}

function tokenListFixture(): Claude360TokenListItem[] {
  return [
    { id: 1, name: 'text-key', maskedKey: 'sk-****aaaa', status: 1, group: 'text', remainQuota: 1000, unlimitedQuota: false },
    { id: 2, name: 'image-key', maskedKey: 'sk-****bbbb', status: 1, group: 'image', remainQuota: 0, unlimitedQuota: true }
  ]
}

function tokenStatsFixture(): Claude360TokenStat[] {
  return [{ tokenName: 'text-key', requestCount: 42, totalTokens: 12345, quota: 1000, costCny: 0.01 }]
}

/** 构造 count 个分组:key-01..key-NN,tokens/requests 随序号递增,便于断言排序/截断。 */
function usageStatsFixture(count: number): Claude360TokenStat[] {
  return Array.from({ length: count }, (_, i) => ({
    tokenName: `key-${String(i + 1).padStart(2, '0')}`,
    requestCount: (i + 1) * 2,
    totalTokens: (i + 1) * 100,
    quota: 0,
    costCny: 0
  }))
}

function topupOptionsFixture(): Claude360TopupOptions {
  return { wechatEnabled: true, amountOptions: [10, 30, 50], minTopup: 10, payUrl: '' }
}

/** 消费型流式日志行基准;局部覆盖构造错误/充值等变体。 */
function logItemFixture(overrides: Partial<Claude360LogItem> = {}): Claude360LogItem {
  return {
    createdAt: Math.floor(new Date(2026, 6, 17, 20, 41, 52).getTime() / 1000),
    type: 2,
    content: '模型倍率 3.0，分组倍率 1.0',
    tokenName: 'Claude360 CLI',
    modelName: 'claude-sonnet-4-5',
    group: 'vip-group',
    ip: '203.0.113.24',
    requestId: 'req_1c8a4f92db306e71',
    quota: 69100,
    promptTokens: 12480,
    completionTokens: 1536,
    useTimeSeconds: 3,
    isStream: true,
    firstTokenMs: 800,
    costDisplay: '¥0.138200',
    ...overrides
  }
}

function modalContentProps(overrides: Partial<MyTopupModalContentProps> = {}): MyTopupModalContentProps {
  return {
    options: topupOptionsFixture(),
    selectedAmount: 10,
    order: null,
    pollPhase: 'idle',
    submitting: false,
    error: null,
    onSelectAmount: () => undefined,
    onCreateWechatTopup: () => undefined,
    onRegenerate: () => undefined,
    onClose: () => undefined,
    t,
    ...overrides
  }
}

/** 构造一个 mock 的 MyPageApi + window.kunGui,用于编排函数测试。 */
function buildApiMock(overrides: Partial<Record<keyof MyPageApi, unknown>> = {}): {
  api: MyPageApi
  calls: {
    create: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    me: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    wechat: ReturnType<typeof vi.fn>
  }
} {
  const createRef: Claude360TokenRef = { tokenId: 9, name: 'new-key', group: 'text' }
  const create = vi.fn(async () => createRef)
  const list = vi.fn(async () => tokenListFixture())
  const me = vi.fn(async () => meFixture({ balanceDisplay: '¥188.50' }))
  const order = vi.fn(async () => ({ orderId: 'o1', status: 'success', moneyDisplay: '¥10', completeTime: 1700000000 }))
  const wechat = vi.fn(async () => ({ orderId: 'o1', codeUrl: 'weixin://wxpay/qr', moneyDisplay: '¥10' }))
  const api = {
    claude360BillingMe: me,
    claude360TokensList: list,
    claude360TokensCreate: create,
    claude360TokensReveal: vi.fn(async () => ({ key: 'sk-plain' })),
    claude360BillingTopupOptions: vi.fn(async () => topupOptionsFixture()),
    claude360BillingTopupWechat: wechat,
    claude360BillingTopupOrder: order,
    claude360BillingTokenStats: vi.fn(async () => tokenStatsFixture()),
    ...overrides
  } as unknown as MyPageApi
  return { api, calls: { create, list, me, order, wechat } }
}

describe('MyPage presentational panels', () => {
  it('shows the account, balance, and today tokens/requests', () => {
    const html = renderToStaticMarkup(
      createElement(MyAccountOverview, { me: meFixture(), onTopup: () => undefined, t })
    )
    expect(html).toContain('Alice Zhang') // 账号
    expect(html).toContain('@alice')
    expect(html).toContain('¥88.50') // 余额
    expect(html).toContain('12,345') // 今日 tokens
    expect(html).toContain('42') // 今日 requests
    expect(html).toContain('vip') // 分组
  })

  it('always shows a resident primary top-up button; low balance adds the warning strip', () => {
    // R1:「立即充值」为常驻主按钮,不再依赖 lowBalance 条件。
    const normal = renderToStaticMarkup(
      createElement(MyAccountOverview, { me: meFixture({ lowBalance: false }), onTopup: () => undefined, t })
    )
    expect(normal).toContain('Top up now')
    expect(normal).toContain('data-testid="my-topup-open"')
    expect(normal).toContain('bg-accent') // ui/Button primary(accent 蓝)
    expect(normal).not.toContain('Balance is low.')

    const low = renderToStaticMarkup(
      createElement(MyAccountOverview, { me: meFixture({ lowBalance: true }), onTopup: () => undefined, t })
    )
    expect(low).toContain('Balance is low.')
    expect(low).toContain('Top up now')
  })

  it('renders a compact usage table capped at 10 rows with overview stats and show-more', () => {
    const html = renderToStaticMarkup(createElement(MyUsagePanel, { stats: usageStatsFixture(12), t }))
    // 总览行:全量合计 + Top3。
    expect(html).toContain('Total requests')
    expect(html).toContain('Total tokens')
    expect(html).toContain('Top groups')
    // 紧凑表格,默认 tokens 降序:key-12 在列,aria-sort 标注方向。
    expect(html).toContain('<table')
    expect(html).toContain('aria-sort="descending"')
    expect(html).toContain('key-12')
    // Top10 截断:tokens 最小的 key-01/key-02 不在默认视图,由「展开更多」承载。
    expect(html).not.toContain('key-01')
    expect(html).not.toContain('key-02')
    expect(html).toContain('Show more')
    expect(html).toContain('data-testid="my-usage-show-more"')
  })

  it('renders usage costs as CNY and keeps missing costs explicit', () => {
    const stats: Claude360TokenStat[] = [
      { tokenName: 'paid-key', requestCount: 7, totalTokens: 4567890, quota: 860000, costCny: 12.556 },
      { tokenName: 'unknown-key', requestCount: 1, totalTokens: 10, quota: 0, costCny: null }
    ]
    const html = renderToStaticMarkup(createElement(MyUsagePanel, { stats, t }))

    expect(html).toContain('Cost')
    expect(html).toContain('¥12.56')
    expect(html).toContain('4,567,890')
    expect(html).toMatch(/<td[^>]*>\s*-\s*<\/td>/)
  })
})

describe('MyTopupModalContent', () => {
  it('renders API-provided amount chips and the WeChat button in the amount view', () => {
    const html = renderToStaticMarkup(createElement(MyTopupModalContent, modalContentProps()))
    expect(html).toContain('Account top-up')
    // 金额档位以接口返回为准(不前端写死)。
    expect(html).toContain('¥10')
    expect(html).toContain('¥30')
    expect(html).toContain('¥50')
    expect(html).toContain('Pay with WeChat')
    // 无订单时不渲染二维码(crispEdges 是 qrcode.react 生成 QR path 的标志)。
    expect(html).not.toContain('shape-rendering="crispEdges"')
  })

  it('encodes weixin:// pay links into a QR svg, never as an img src', () => {
    const order: Claude360TopupOrder = { orderId: 'o1', codeUrl: 'weixin://wxpay/qr', moneyDisplay: '¥10' }
    const html = renderToStaticMarkup(
      createElement(MyTopupModalContent, modalContentProps({ order, pollPhase: 'pending' }))
    )
    // weixin:// 支付链接必须前端编码成 QR svg;不能当 img src(浏览器无法加载,恒空白)。
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).toContain('aria-label="WeChat QR"')
    expect(html).not.toContain('src="weixin://wxpay/qr"')
    expect(html).toContain('Scan to pay')
    expect(html).toContain('¥10') // 支付金额
    expect(html).toContain('Waiting for payment…')
  })

  it('renders image-flavored codeUrl values via <img> at 200×200', () => {
    const httpOrder: Claude360TopupOrder = {
      orderId: 'o2',
      codeUrl: 'https://pay.example.com/qr.png',
      moneyDisplay: '¥10'
    }
    const httpHtml = renderToStaticMarkup(
      createElement(MyTopupModalContent, modalContentProps({ order: httpOrder, pollPhase: 'pending' }))
    )
    expect(httpHtml).toContain('src="https://pay.example.com/qr.png"')
    expect(httpHtml).toContain('width="200"')
    expect(httpHtml).toContain('height="200"')
    expect(httpHtml).not.toContain('shape-rendering="crispEdges"')

    // 裸 base64(无前缀)补 data:image/png;base64, 前缀后走 <img>。
    const bare = 'A'.repeat(120)
    const bareHtml = renderToStaticMarkup(
      createElement(
        MyTopupModalContent,
        modalContentProps({ order: { orderId: 'o3', codeUrl: bare, moneyDisplay: '¥10' }, pollPhase: 'pending' })
      )
    )
    expect(bareHtml).toContain(`src="data:image/png;base64,${bare}"`)
  })

  it('shows success + Done when completed, and failure/timeout + regenerate on failed/expired', () => {
    const order: Claude360TopupOrder = { orderId: 'o1', codeUrl: 'weixin://wxpay/qr', moneyDisplay: '¥10' }

    const completed = renderToStaticMarkup(
      createElement(MyTopupModalContent, modalContentProps({ order, pollPhase: 'completed' }))
    )
    expect(completed).toContain('Payment received.')
    expect(completed).toContain('data-testid="my-topup-done"')
    expect(completed).toContain('Done')
    expect(completed).not.toContain('shape-rendering="crispEdges"') // 终态不再展示二维码

    const failed = renderToStaticMarkup(
      createElement(MyTopupModalContent, modalContentProps({ order, pollPhase: 'failed' }))
    )
    expect(failed).toContain('Payment failed.')
    expect(failed).toContain('Regenerate QR code')
    expect(failed).toContain('data-testid="my-topup-regenerate"')

    const expired = renderToStaticMarkup(
      createElement(MyTopupModalContent, modalContentProps({ order, pollPhase: 'expired' }))
    )
    expect(expired).toContain('Order timed out.')
    expect(expired).toContain('Regenerate QR code')
  })

  it('shows an explicit error instead of a blank QR when codeUrl is empty', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const order: Claude360TopupOrder = { orderId: 'o1', codeUrl: '', moneyDisplay: '¥10' }
      const html = renderToStaticMarkup(
        createElement(MyTopupModalContent, modalContentProps({ order, pollPhase: 'pending' }))
      )
      // codeUrl 为空:显式错误文案,不渲染空白二维码;控制台有 error 日志。
      expect(html).toContain('QR code unavailable.')
      expect(html).not.toContain('shape-rendering="crispEdges"')
      expect(errorSpy).toHaveBeenCalledWith('[topup] empty codeUrl', order)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('surfaces in-modal top-up errors', () => {
    const html = renderToStaticMarkup(
      createElement(MyTopupModalContent, modalContentProps({ error: 'network down' }))
    )
    expect(html).toContain('network down')
  })
})

describe('my-page-actions pure helpers', () => {
  it('classifies codeUrl payloads by content (R4 five branches)', () => {
    // 1. 空/空白 → empty
    expect(classifyQrPayload('')).toEqual({ kind: 'empty' })
    expect(classifyQrPayload('   ')).toEqual({ kind: 'empty' })
    // 2. dataURL → 直接 img
    expect(classifyQrPayload('data:image/png;base64,AAAA')).toEqual({
      kind: 'image',
      src: 'data:image/png;base64,AAAA'
    })
    // 3. http(s) URL → 直接 img
    expect(classifyQrPayload('https://x.test/qr.png')).toEqual({ kind: 'image', src: 'https://x.test/qr.png' })
    expect(classifyQrPayload('http://x.test/qr.png')).toEqual({ kind: 'image', src: 'http://x.test/qr.png' })
    // 4. 裸 base64(>100 字符) → 补 png 前缀
    const bare = 'A'.repeat(120)
    expect(classifyQrPayload(bare)).toEqual({ kind: 'image', src: `data:image/png;base64,${bare}` })
    // 5. 其余(weixin:// 等支付链接) → 前端编码;短 base64 样字符串不误判为图片
    expect(classifyQrPayload('weixin://wxpay/bizpayurl?pr=abc')).toEqual({
      kind: 'encode',
      value: 'weixin://wxpay/bizpayurl?pr=abc'
    })
    expect(classifyQrPayload('abc123')).toEqual({ kind: 'encode', value: 'abc123' })
  })

  it('builds the usage view with sorting, filtering, truncation, and global totals/top3', () => {
    const stats = usageStatsFixture(12) // tokens 100..1200,总量 7800;requests 2..24,总量 156

    const byTokens = buildUsageView(stats, { query: '', sortKey: 'tokens', sortDesc: true, limit: 10 })
    expect(byTokens.totals).toEqual({ requests: 156, tokens: 7800 })
    expect(byTokens.rows).toHaveLength(10)
    expect(byTokens.hiddenCount).toBe(2)
    expect(byTokens.rows[0].tokenName).toBe('key-12')
    expect(byTokens.rows[0].sharePct).toBe(15) // 1200/7800 ≈ 15%
    expect(byTokens.top3.map((x) => x.tokenName)).toEqual(['key-12', 'key-11', 'key-10'])

    // 排序键切换 + 升序。
    const byRequestsAsc = buildUsageView(stats, { query: '', sortKey: 'requests', sortDesc: false, limit: 10 })
    expect(byRequestsAsc.rows[0].tokenName).toBe('key-01')

    // 搜索:大小写不敏感包含;totals/top3 仍反映全局。
    const filtered = buildUsageView(stats, { query: 'KEY-01', sortKey: 'tokens', sortDesc: true, limit: 10 })
    expect(filtered.rows).toHaveLength(1)
    expect(filtered.rows[0].tokenName).toBe('key-01')
    expect(filtered.hiddenCount).toBe(0)
    expect(filtered.totals.tokens).toBe(7800)
    expect(filtered.top3[0].tokenName).toBe('key-12')

    // limit=null 展开全部。
    const expandedView = buildUsageView(stats, { query: '', sortKey: 'tokens', sortDesc: true, limit: null })
    expect(expandedView.rows).toHaveLength(12)
    expect(expandedView.hiddenCount).toBe(0)
  })

  it('sorts usage rows by known cost while keeping missing costs last', () => {
    const stats: Claude360TokenStat[] = [
      { tokenName: 'unknown', requestCount: 99, totalTokens: 999, quota: 0, costCny: null },
      { tokenName: 'small', requestCount: 1, totalTokens: 10, quota: 1000, costCny: 0.04 },
      { tokenName: 'large', requestCount: 2, totalTokens: 20, quota: 100000, costCny: 12.34 }
    ]

    const desc = buildUsageView(stats, { query: '', sortKey: 'cost', sortDesc: true, limit: null })
    expect(desc.rows.map((row) => row.tokenName)).toEqual(['large', 'small', 'unknown'])

    const asc = buildUsageView(stats, { query: '', sortKey: 'cost', sortDesc: false, limit: null })
    expect(asc.rows.map((row) => row.tokenName)).toEqual(['small', 'large', 'unknown'])
  })
})

describe('MyPage orchestration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats an order with completeTime > 0 as complete', () => {
    expect(isTopupOrderComplete({ orderId: 'o', status: 'success', moneyDisplay: '', completeTime: 1 })).toBe(true)
    expect(isTopupOrderComplete({ orderId: 'o', status: 'pending', moneyDisplay: '', completeTime: 0 })).toBe(false)
  })

  it('polls the order until complete so the caller can refresh the balance', async () => {
    const pending: Claude360TopupOrderStatus = { orderId: 'o1', status: 'pending', moneyDisplay: '¥10', completeTime: 0 }
    const done: Claude360TopupOrderStatus = { orderId: 'o1', status: 'success', moneyDisplay: '¥10', completeTime: 1700000000 }
    const order = vi
      .fn<() => Promise<Claude360TopupOrderStatus>>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(done)
    const api = { claude360BillingTopupOrder: order } as unknown as MyPageApi
    const refreshMe = vi.fn(async () => undefined)

    const result = await pollTopupOrderUntilComplete(api, 'o1', {
      intervalMs: 0,
      sleep: async () => undefined
    })

    expect(order).toHaveBeenCalledTimes(3)
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ completed: true })

    // 完成后调用方刷新余额,断言余额刷新链路。
    if (result.ok && result.completed) await refreshMe()
    expect(refreshMe).toHaveBeenCalledTimes(1)
  })

  it('stops polling early with a distinct reason when the order fails or expires', async () => {
    // failed:第一次拿到终态即终止,不再傻等 60 次上限。
    const failedStatus: Claude360TopupOrderStatus = { orderId: 'o1', status: 'failed', moneyDisplay: '¥10', completeTime: 0 }
    const failedFn = vi.fn(async () => failedStatus)
    const failedResult = await pollTopupOrderUntilComplete(
      { claude360BillingTopupOrder: failedFn } as unknown as MyPageApi,
      'o1',
      { sleep: async () => undefined }
    )
    expect(failedFn).toHaveBeenCalledTimes(1)
    expect(failedResult).toEqual({ ok: true, completed: false, reason: 'failed' })

    // expired 同理。
    const expiredStatus: Claude360TopupOrderStatus = { orderId: 'o2', status: 'expired', moneyDisplay: '¥10', completeTime: 0 }
    const expiredFn = vi.fn(async () => expiredStatus)
    const expiredResult = await pollTopupOrderUntilComplete(
      { claude360BillingTopupOrder: expiredFn } as unknown as MyPageApi,
      'o2',
      { sleep: async () => undefined }
    )
    expect(expiredFn).toHaveBeenCalledTimes(1)
    expect(expiredResult).toEqual({ ok: true, completed: false, reason: 'expired' })
  })

  it('reports timeout after exhausting maxAttempts and aborted when cancelled', async () => {
    const pending: Claude360TopupOrderStatus = { orderId: 'o1', status: 'pending', moneyDisplay: '¥10', completeTime: 0 }
    const orderFn = vi.fn(async () => pending)
    const api = { claude360BillingTopupOrder: orderFn } as unknown as MyPageApi

    const timeoutResult = await pollTopupOrderUntilComplete(api, 'o1', {
      maxAttempts: 3,
      sleep: async () => undefined
    })
    expect(orderFn).toHaveBeenCalledTimes(3)
    expect(timeoutResult).toEqual({ ok: true, completed: false, reason: 'timeout' })

    // 关闭弹窗中止(shouldAbort):不再发请求,reason=aborted 供调用方静默处理。
    const abortedFn = vi.fn(async () => pending)
    const abortedResult = await pollTopupOrderUntilComplete(
      { claude360BillingTopupOrder: abortedFn } as unknown as MyPageApi,
      'o1',
      { shouldAbort: () => true, sleep: async () => undefined }
    )
    expect(abortedFn).not.toHaveBeenCalled()
    expect(abortedResult).toEqual({ ok: true, completed: false, reason: 'aborted' })
  })

  it('creating a wechat topup then polling completion drives a balance refresh via window.kunGui', async () => {
    const { api, calls } = buildApiMock()
    // 微信充值成功 → 拿到订单 → 轮询完成 → 刷新余额。
    const created = await api.claude360BillingTopupWechat({ amount: 10 })
    expect(calls.wechat).toHaveBeenCalledWith({ amount: 10 })
    expect(created.codeUrl).toBe('weixin://wxpay/qr')

    const poll = await pollTopupOrderUntilComplete(api, created.orderId, {
      intervalMs: 0,
      sleep: async () => undefined
    })
    expect(poll.ok).toBe(true)
    expect(poll).toMatchObject({ completed: true })

    if (poll.ok && poll.completed) {
      const refreshed = await api.claude360BillingMe()
      expect(refreshed.balanceDisplay).toBe('¥188.50')
    }
    expect(calls.me).toHaveBeenCalled()
  })
})

describe('MySegTabs', () => {
  const tabs = [
    { key: 'usage' as const, label: 'Usage stats' },
    { key: 'logs' as const, label: 'Call logs' }
  ]

  it('marks exactly the active tab as selected', () => {
    const usageActive = renderToStaticMarkup(
      createElement(MySegTabs, { tabs, active: 'usage' as const, onChange: () => undefined, ariaLabel: 'tabs' })
    )
    expect(usageActive).toContain('role="tablist"')
    expect(usageActive).toContain('aria-selected="true" data-testid="my-tab-usage"')
    expect(usageActive).toContain('aria-selected="false" data-testid="my-tab-logs"')
    // 选中项 = accent-soft 底 + accent 字(确认稿 .seg-tabs.on)。
    expect(usageActive).toContain('bg-accent-soft')

    const logsActive = renderToStaticMarkup(
      createElement(MySegTabs, { tabs, active: 'logs' as const, onChange: () => undefined, ariaLabel: 'tabs' })
    )
    expect(logsActive).toContain('aria-selected="false" data-testid="my-tab-usage"')
    expect(logsActive).toContain('aria-selected="true" data-testid="my-tab-logs"')
  })
})

describe('MyLogsTable', () => {
  const noop = (): void => undefined

  function tableHtml(
    items: Claude360LogItem[],
    columns = defaultLogColumnPrefs(),
    expandedRows: ReadonlySet<number> = new Set<number>()
  ): string {
    return renderToStaticMarkup(
      createElement(MyLogsTable, {
        items,
        columns,
        expandedRows,
        onToggleRow: noop,
        onCopyDetail: noop,
        t
      })
    )
  }

  it('renders consume rows with pills, stream duration badge and formatted numbers', () => {
    const html = tableHtml([logItemFixture()])
    expect(html).toContain('07-17')
    expect(html).toContain('20:41:52')
    expect(html).toContain('Claude360 CLI')
    expect(html).toContain('vip-group')
    expect(html).toContain('Consume')
    expect(html).toContain('bg-accent-soft') // 消费徽章 accent
    expect(html).toContain('claude-sonnet-4-5')
    expect(html).toContain('3s · first 0.8s') // 流式:总用时 + 首字耗时
    expect(html).toContain('bg-ds-success-soft') // ≤10s success
    expect(html).toContain('12,480')
    expect(html).toContain('1,536')
    expect(html).toContain('¥0.138200')
    expect(html).toContain('203.0.113.24')
    // Request ID 列默认隐藏,且未展开详情 → 全文不含 request id。
    expect(html).not.toContain('req_1c8a4f92db306e71')
    expect(html).toContain('Expand detail')
  })

  it('keeps model/duration/tokens/ip on error rows (mockup parity) and dashes non-call rows', () => {
    // 错误行(type=5)是 API 调用:确认稿照常展示模型/用时/输入输出/IP。
    const errorHtml = tableHtml([
      logItemFixture({
        type: 5,
        isStream: false,
        firstTokenMs: null,
        useTimeSeconds: 28,
        completionTokens: 0,
        costDisplay: '¥0.000000'
      })
    ])
    expect(errorHtml).toContain('Error')
    expect(errorHtml).toContain('bg-ds-danger-soft')
    expect(errorHtml).toContain('claude-sonnet-4-5')
    expect(errorHtml).toContain('28s')
    expect(errorHtml).toContain('bg-ds-warning-soft') // >10s warning
    expect(errorHtml).not.toContain('· first') // 非流式不展示首字

    // 充值行(type=1)不适用的列显示「—」,花费为 success 色 + 前缀 +。
    const topupHtml = tableHtml([
      logItemFixture({
        type: 1,
        tokenName: '',
        modelName: '',
        group: '',
        ip: '',
        requestId: '',
        promptTokens: 0,
        completionTokens: 0,
        useTimeSeconds: 0,
        isStream: false,
        firstTokenMs: null,
        costDisplay: '¥50.000000'
      })
    ])
    expect(topupHtml).toContain('Top-up')
    expect(topupHtml).toContain('+¥50.000000')
    expect(topupHtml).toContain('text-ds-success')
    expect(topupHtml).toContain('—')
    expect(topupHtml).not.toContain('claude-sonnet-4-5')
  })

  it('honors column prefs: toggleable columns hide and the request id column can be enabled', () => {
    const minimal = tableHtml([logItemFixture()], {
      group: false,
      duration: false,
      ip: false,
      requestId: false
    })
    expect(minimal).not.toContain('vip-group')
    expect(minimal).not.toContain('· first')
    expect(minimal).not.toContain('203.0.113.24')
    // 固定列不受影响。
    expect(minimal).toContain('claude-sonnet-4-5')
    expect(minimal).toContain('¥0.138200')

    const withReqId = tableHtml([logItemFixture()], { ...defaultLogColumnPrefs(), requestId: true })
    expect(withReqId).toContain('Request ID') // 表头
    expect(withReqId).toContain('req_1c8a4f92db306e71')
  })

  it('expands an inline detail row with full content, request id, first-token time and copy action', () => {
    const html = tableHtml(
      [logItemFixture({ content: '上游响应超时（read timeout after 28s），本次请求未计费。' })],
      defaultLogColumnPrefs(),
      new Set([0])
    )
    expect(html).toContain('上游响应超时（read timeout after 28s），本次请求未计费。')
    expect(html).toContain('req_1c8a4f92db306e71')
    expect(html).toContain('First token')
    expect(html).toContain('0.8s')
    expect(html).toContain('Copy details')
    expect(html).toContain('Collapse detail')
    // colspan = 可见列数(8 固定 + 分组/用时/IP;Request ID 默认隐藏)。
    expect(html).toContain('colSpan="11"')
  })
})

describe('MyPage tab shell (方案 B)', () => {
  // MyPage 直接消费 useTranslation:注册 en 资源以英文文案断言(AppShell.test 惯例)。
  beforeAll(() => setupI18nTestEnglish())

  const pageProps = {
    leftSidebarCollapsed: false,
    onToggleLeftSidebar: (): void => undefined,
    onBack: (): void => undefined,
    onLogout: (): void => undefined
  }

  it('defaults to the usage tab and keeps the logs panel mounted but hidden', () => {
    const html = renderToStaticMarkup(createElement(MyPage, pageProps))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true" data-testid="my-tab-usage"')
    expect(html).toContain('aria-selected="false" data-testid="my-tab-logs"')
    // 面板常挂载:日志面板 hidden,用量面板可见。
    expect(html).toContain('data-testid="my-tab-panel-logs" hidden=""')
    expect(html).not.toContain('data-testid="my-tab-panel-usage" hidden=""')
    // 用量面板照常渲染(迁移进 Tab 后行为不变;无数据时为空态文案)。
    expect(html).toContain('Token usage')
    // 日志面板筛选骨架已在 DOM(hidden 而非卸载)。
    expect(html).toContain('Start time')
  })

  it('activates the logs tab via initialTab and hides the usage panel', () => {
    const html = renderToStaticMarkup(createElement(MyPage, { ...pageProps, initialTab: 'logs' as const }))
    expect(html).toContain('aria-selected="true" data-testid="my-tab-logs"')
    expect(html).toContain('data-testid="my-tab-panel-usage" hidden=""')
    expect(html).not.toContain('data-testid="my-tab-panel-logs" hidden=""')
    // 筛选区关键控件在位:今天预设选中 / 类型下拉 / 查询与重置按钮。
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('All types')
    expect(html).toContain('data-testid="my-logs-search"')
    expect(html).toContain('data-testid="my-logs-reset"')
  })

  it('renders the logs panel filter skeleton standalone without issuing queries at render time', () => {
    // 静态渲染不跑 effect:面板只出筛选区(idle),无表格/分页/统计。
    const html = renderToStaticMarkup(createElement(MyLogsPanel, { active: false, t }))
    expect(html).toContain('Call logs')
    expect(html).toContain('Columns')
    expect(html).not.toContain('<table')
  })
})
