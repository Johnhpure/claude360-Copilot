import { describe, expect, it } from 'vitest'
import { Claude360BillingService, type Claude360ApiClientPort } from './claude360-billing-service'
import { type Claude360SecretStore } from './claude360-secret-store'

function fakeSecretStore(seed: Record<string, string> = { 'claude360:cli-token': 'cli-tok' }): Claude360SecretStore {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    saveSecret: async (r, v) => {
      map.set(r, v)
    },
    loadSecret: async (r) => map.get(r) ?? null,
    deleteSecret: async (r) => {
      map.delete(r)
    },
    clearClaude360Secrets: async () => map.clear(),
    isEncryptionActive: () => true
  }
}

function fakeApi(routes: Record<string, (body?: unknown) => unknown>, calls: string[] = []): Claude360ApiClientPort {
  const run = (path: string, body?: unknown): unknown => {
    calls.push(path)
    const key = Object.keys(routes).find((r) => path === r || path.startsWith(`${r}?`))
    if (!key) throw new Error(`no route ${path}`)
    return routes[key](body)
  }
  return {
    get: async <T>(path: string) => run(path) as T,
    post: async <T>(path: string, body?: unknown) => run(path, body) as T
  }
}

describe('Claude360BillingService', () => {
  it('maps account balance and today usage', async () => {
    const service = new Claude360BillingService({
      apiClient: fakeApi({
        '/api/cli/me': () => ({
          username: 'demo',
          display_name: 'Demo',
          email: 'd@x.test',
          group: 'default',
          balance_display: '¥12.30',
          low_balance: false,
          today_tokens: 1200,
          today_requests: 20,
          today_usage_display: '1.2k'
        })
      }),
      secretStore: fakeSecretStore()
    })
    const me = await service.getMe()
    expect(me).toMatchObject({
      username: 'demo',
      displayName: 'Demo',
      balanceDisplay: '¥12.30',
      lowBalance: false,
      todayTokens: 1200,
      todayRequests: 20
    })
  })

  it('returns topup options and creates a wechat order', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi(
        {
          '/api/cli/topup/options': () => ({ wechat_enabled: true, amount_options: [10, 50], min_topup: 5, pay_url: '' }),
          '/api/cli/topup/wechat': (body) => {
            expect(body).toMatchObject({ amount: 50 })
            return { order_id: 'ord_1', code_url: 'weixin://x', money_display: '¥50.00' }
          }
        },
        calls
      ),
      secretStore: fakeSecretStore()
    })
    const opts = await service.getTopupOptions()
    expect(opts).toMatchObject({ wechatEnabled: true, amountOptions: [10, 50], minTopup: 5 })
    const order = await service.createWechatTopup({ amount: 50 })
    expect(order).toMatchObject({ orderId: 'ord_1', codeUrl: 'weixin://x' })
  })

  it('polls a specific order by id', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi({ '/api/cli/topup/order': () => ({ order_id: 'ord_1', status: 1, money_display: '¥50.00', complete_time: 123 }) }, calls),
      secretStore: fakeSecretStore()
    })
    const status = await service.getTopupOrder('ord_1')
    expect(status).toMatchObject({ orderId: 'ord_1', status: 1 })
    expect(calls[0]).toContain('order_id=ord_1')
  })

  it('forwards token stats timestamps and maps rows', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi({ '/api/cli/token_stats': () => [{ token_name: 'text', request_count: 3, total_tokens: 100, quota: 10 }] }, calls),
      secretStore: fakeSecretStore()
    })
    const stats = await service.getTokenStats({ startTimestamp: 1000, endTimestamp: 2000 })
    expect(stats).toEqual([{ tokenName: 'text', requestCount: 3, totalTokens: 100, quota: 10 }])
    expect(calls[0]).toContain('start_timestamp=1000')
    expect(calls[0]).toContain('end_timestamp=2000')
  })

  it('throws when not logged in', async () => {
    const service = new Claude360BillingService({ apiClient: fakeApi({}), secretStore: fakeSecretStore({}) })
    await expect(service.getMe()).rejects.toThrow(/未登录/)
  })
})
