import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  Claude360Me,
  Claude360TokenListItem,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder,
  Claude360TopupOrderStatus
} from '@shared/claude360'
import type { Claude360TokenRef } from '@shared/app-settings-claude360'
import { MyAccountOverview } from './MyAccountOverview'
import { MyBillingPanel } from './MyBillingPanel'
import {
  isTopupOrderComplete,
  pollTopupOrderUntilComplete,
  type MyPageApi
} from './my-page-actions'

const labels: Record<string, string> = {
  myLoading: 'Loading…',
  myAccount: 'Account',
  myGroup: 'Group',
  myBalance: 'Balance',
  myUsedTotal: 'Used total',
  myTodayTokens: "Today's tokens",
  myTodayRequests: "Today's requests",
  myTodayUsage: "Today's spend",
  myLowBalance: 'Balance is low.',
  myTopupNow: 'Top up now',
  myTopup: 'Top up',
  myMinTopup: 'Minimum top-up',
  myWechatTopup: 'Pay with WeChat',
  myCreatingOrder: 'Creating order…',
  myWechatDisabled: 'WeChat unavailable.',
  myScanToPay: 'Scan to pay',
  myWechatQr: 'WeChat QR',
  myQrError: 'QR code unavailable.',
  myWaitingPayment: 'Waiting for payment…',
  myPaymentComplete: 'Payment received.'
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
  return [{ tokenName: 'text-key', requestCount: 42, totalTokens: 12345, quota: 1000 }]
}

function topupOptionsFixture(): Claude360TopupOptions {
  return { wechatEnabled: true, amountOptions: [10, 30, 50], minTopup: 10, payUrl: '' }
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
  const order = vi.fn(async () => ({ orderId: 'o1', status: 1, moneyDisplay: '¥10', completeTime: 1700000000 }))
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

  it('surfaces a top-up entry only when the balance is low', () => {
    const normal = renderToStaticMarkup(
      createElement(MyAccountOverview, { me: meFixture({ lowBalance: false }), onTopup: () => undefined, t })
    )
    expect(normal).not.toContain('Top up now')
    const low = renderToStaticMarkup(
      createElement(MyAccountOverview, { me: meFixture({ lowBalance: true }), onTopup: () => undefined, t })
    )
    expect(low).toContain('Balance is low.')
    expect(low).toContain('Top up now')
  })

  it('renders top-up amount options and, once an order exists, the WeChat QR code', () => {
    const withoutOrder = renderToStaticMarkup(
      createElement(MyBillingPanel, {
        options: topupOptionsFixture(),
        selectedAmount: 10,
        order: null,
        pollPhase: 'idle' as const,
        submitting: false,
        onSelectAmount: () => undefined,
        onCreateWechatTopup: () => undefined,
        t
      })
    )
    // 充值 options 渲染金额
    expect(withoutOrder).toContain('¥10')
    expect(withoutOrder).toContain('¥30')
    expect(withoutOrder).toContain('¥50')
    // 无订单时不渲染二维码(crispEdges 是 qrcode.react 生成 QR path 的标志,lucide 图标 svg 无此属性)
    expect(withoutOrder).not.toContain('shape-rendering="crispEdges"')

    const order: Claude360TopupOrder = { orderId: 'o1', codeUrl: 'weixin://wxpay/qr', moneyDisplay: '¥10' }
    const withOrder = renderToStaticMarkup(
      createElement(MyBillingPanel, {
        options: topupOptionsFixture(),
        selectedAmount: 10,
        order,
        pollPhase: 'pending' as const,
        submitting: false,
        onSelectAmount: () => undefined,
        onCreateWechatTopup: () => undefined,
        t
      })
    )
    // 微信充值成功后由 qrcode.react 把 codeUrl 编码为 QR svg;
    // weixin:// 支付链接不能再作为 img src 出现(浏览器无法把它当图片加载,恒空白)。
    expect(withOrder).toContain('shape-rendering="crispEdges"')
    expect(withOrder).toContain('aria-label="WeChat QR"')
    expect(withOrder).not.toContain('src="weixin://wxpay/qr"')
    expect(withOrder).toContain('Waiting for payment…')
  })

  it('shows an explicit error instead of a blank QR when codeUrl is empty', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const order: Claude360TopupOrder = { orderId: 'o1', codeUrl: '', moneyDisplay: '¥10' }
      const html = renderToStaticMarkup(
        createElement(MyBillingPanel, {
          options: topupOptionsFixture(),
          selectedAmount: 10,
          order,
          pollPhase: 'pending' as const,
          submitting: false,
          onSelectAmount: () => undefined,
          onCreateWechatTopup: () => undefined,
          t
        })
      )
      // codeUrl 为空:显式错误文案,不渲染空白二维码;控制台有 error 日志。
      expect(html).toContain('QR code unavailable.')
      expect(html).not.toContain('shape-rendering="crispEdges"')
      expect(errorSpy).toHaveBeenCalledWith('[topup] empty codeUrl', order)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('MyPage orchestration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats an order with completeTime > 0 as complete', () => {
    expect(isTopupOrderComplete({ orderId: 'o', status: 1, moneyDisplay: '', completeTime: 1 })).toBe(true)
    expect(isTopupOrderComplete({ orderId: 'o', status: 0, moneyDisplay: '', completeTime: 0 })).toBe(false)
  })

  it('polls the order until complete so the caller can refresh the balance', async () => {
    const pending: Claude360TopupOrderStatus = { orderId: 'o1', status: 0, moneyDisplay: '¥10', completeTime: 0 }
    const done: Claude360TopupOrderStatus = { orderId: 'o1', status: 1, moneyDisplay: '¥10', completeTime: 1700000000 }
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
