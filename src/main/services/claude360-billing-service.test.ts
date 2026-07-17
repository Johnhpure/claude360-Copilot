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

  it('forwards token stats timestamps and maps rows with dynamic CNY cost', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi(
        {
          '/api/status': () => ({ quota_per_unit: 500_000, price: 7.3 }),
          '/api/cli/token_stats': () => [{ token_name: 'text', request_count: 3, total_tokens: 100, quota: 1000 }]
        },
        calls
      ),
      secretStore: fakeSecretStore()
    })
    const stats = await service.getTokenStats({ startTimestamp: 1000, endTimestamp: 2000 })
    expect(stats).toEqual([{ tokenName: 'text', requestCount: 3, totalTokens: 100, quota: 1000, costCny: 0.0146 }])
    expect(calls).toContain('/api/status')
    expect(calls[1]).toContain('start_timestamp=1000')
    expect(calls[1]).toContain('end_timestamp=2000')
  })

  it('keeps token stats cost unknown when status pricing is unavailable', async () => {
    const service = new Claude360BillingService({
      apiClient: fakeApi({
        '/api/status': () => ({ quota_per_unit: 500_000 }),
        '/api/cli/token_stats': () => [{ token_name: 'text', request_count: 3, total_tokens: 100, quota: 1000 }]
      }),
      secretStore: fakeSecretStore()
    })

    const stats = await service.getTokenStats()
    expect(stats[0]).toMatchObject({ tokenName: 'text', quota: 1000, costCny: null })
  })

  it('builds the full /api/cli/logs query string and normalizes the PageInfo payload', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi(
        {
          '/api/cli/logs': () => ({
            page: 2,
            page_size: 20,
            total: 41,
            items: [
              {
                created_at: 1_752_741_712,
                type: 2,
                content: '模型倍率 3.0',
                token_name: 'cli',
                model_name: 'claude-sonnet-4-5',
                quota: 69_100,
                prompt_tokens: 12_480,
                completion_tokens: 1_536,
                use_time: 3,
                is_stream: true,
                group: 'default',
                ip: '203.0.113.24',
                request_id: 'req_1',
                other: '{"frt":800}',
                cost_display: '¥0.138200'
              },
              // 后端字段全缺省（如充值行）：逐字段兜底，不抛错。
              {}
            ]
          })
        },
        calls
      ),
      secretStore: fakeSecretStore()
    })

    const pageData = await service.listLogs({
      page: 2,
      pageSize: 20,
      type: 2,
      startTimestamp: 1000,
      endTimestamp: 2000,
      tokenName: 'cli',
      modelName: 'claude',
      group: 'default',
      requestId: 'req_1'
    })

    const url = calls[0] ?? ''
    expect(url).toContain('p=2')
    expect(url).toContain('page_size=20')
    expect(url).toContain('type=2')
    expect(url).toContain('start_timestamp=1000')
    expect(url).toContain('end_timestamp=2000')
    expect(url).toContain('token_name=cli')
    expect(url).toContain('model_name=claude')
    expect(url).toContain('group=default')
    expect(url).toContain('request_id=req_1')

    expect(pageData).toMatchObject({ total: 41, page: 2, pageSize: 20 })
    expect(pageData.items[0]).toEqual({
      createdAt: 1_752_741_712,
      type: 2,
      content: '模型倍率 3.0',
      tokenName: 'cli',
      modelName: 'claude-sonnet-4-5',
      group: 'default',
      ip: '203.0.113.24',
      requestId: 'req_1',
      quota: 69_100,
      promptTokens: 12_480,
      completionTokens: 1_536,
      useTimeSeconds: 3,
      isStream: true,
      firstTokenMs: 800,
      costDisplay: '¥0.138200'
    })
    expect(pageData.items[1]).toMatchObject({
      createdAt: 0,
      type: 0,
      tokenName: '',
      quota: 0,
      isStream: false,
      firstTokenMs: null,
      costDisplay: ''
    })
  })

  it('omits empty log filters and tolerates invalid other JSON', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi(
        {
          '/api/cli/logs': () => ({
            page: 1,
            page_size: 20,
            total: 2,
            items: [
              { use_time: 5, other: 'not-json' },
              { use_time: 5, other: '{"frt":"fast"}' }
            ]
          })
        },
        calls
      ),
      secretStore: fakeSecretStore()
    })

    const pageData = await service.listLogs({ page: 1, pageSize: 20, type: 0 })
    // type=0（全部）与未填筛选一律不携带参数：后端「无参数=不过滤」。
    expect(calls[0]).toBe('/api/cli/logs?p=1&page_size=20')
    // other 非法 JSON / frt 非数值 → null，不抛错。
    expect(pageData.items.map((item) => item.firstTokenMs)).toEqual([null, null])
  })

  it('normalizes a malformed logs payload to an empty page', async () => {
    const service = new Claude360BillingService({
      apiClient: fakeApi({ '/api/cli/logs': () => ({}) }),
      secretStore: fakeSecretStore()
    })
    const pageData = await service.listLogs({ page: 3, pageSize: 50 })
    expect(pageData).toEqual({ items: [], total: 0, page: 3, pageSize: 50 })
  })

  it('converts self-stat quota to CNY and forwards shared filters without request_id', async () => {
    const calls: string[] = []
    const service = new Claude360BillingService({
      apiClient: fakeApi(
        {
          '/api/status': () => ({ quota_per_unit: 500_000, price: 7.3 }),
          '/api/log/self/stat': () => ({ quota: 1000, rpm: 6.2, tpm: 18_420 })
        },
        calls
      ),
      secretStore: fakeSecretStore()
    })

    const stat = await service.getLogsStat({
      page: 1,
      pageSize: 20,
      type: 2,
      startTimestamp: 1000,
      endTimestamp: 2000,
      tokenName: 'cli',
      modelName: 'claude',
      group: 'default',
      requestId: 'req_1'
    })

    expect(stat).toEqual({ quotaCny: 0.0146, rpm: 6.2, tpm: 18_420 })
    const statUrl = calls.find((c) => c.startsWith('/api/log/self/stat')) ?? ''
    expect(statUrl).toContain('type=2')
    expect(statUrl).toContain('token_name=cli')
    expect(statUrl).toContain('group=default')
    // 该接口不支持 request_id 过滤，也无分页概念：绝不携带，避免统计口径误导。
    expect(statUrl).not.toContain('request_id')
    expect(statUrl).not.toContain('page_size')
    expect(statUrl).not.toContain('?p=')
  })

  it('keeps logs stat quotaCny null when status pricing is unavailable', async () => {
    const service = new Claude360BillingService({
      apiClient: fakeApi({
        '/api/status': () => ({ quota_per_unit: 500_000 }),
        '/api/log/self/stat': () => ({ quota: 1000, rpm: 1.5, tpm: 42 })
      }),
      secretStore: fakeSecretStore()
    })
    const stat = await service.getLogsStat({ page: 1, pageSize: 20 })
    expect(stat).toEqual({ quotaCny: null, rpm: 1.5, tpm: 42 })
  })

  it('propagates logs and stat backend failures to the caller', async () => {
    const service = new Claude360BillingService({
      apiClient: fakeApi({
        '/api/status': () => ({ quota_per_unit: 500_000, price: 7.3 }),
        '/api/cli/logs': () => {
          throw new Error('日志接口不可用')
        },
        '/api/log/self/stat': () => {
          throw new Error('统计接口不可用')
        }
      }),
      secretStore: fakeSecretStore()
    })
    await expect(service.listLogs({ page: 1, pageSize: 20 })).rejects.toThrow('日志接口不可用')
    await expect(service.getLogsStat({ page: 1, pageSize: 20 })).rejects.toThrow('统计接口不可用')
  })

  it('requires login for logs queries', async () => {
    const service = new Claude360BillingService({ apiClient: fakeApi({}), secretStore: fakeSecretStore({}) })
    await expect(service.listLogs({ page: 1, pageSize: 20 })).rejects.toThrow(/未登录/)
    await expect(service.getLogsStat({ page: 1, pageSize: 20 })).rejects.toThrow(/未登录/)
  })

  it('throws when not logged in', async () => {
    const service = new Claude360BillingService({ apiClient: fakeApi({}), secretStore: fakeSecretStore({}) })
    await expect(service.getMe()).rejects.toThrow(/未登录/)
  })
})
