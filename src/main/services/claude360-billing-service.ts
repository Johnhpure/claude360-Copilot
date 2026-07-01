import type {
  Claude360Me,
  Claude360MeRawResponse,
  Claude360TokenStat,
  Claude360TokenStatRawResponse,
  Claude360TokenStatsQuery,
  Claude360TopupOptions,
  Claude360TopupOptionsRawResponse,
  Claude360TopupOrder,
  Claude360TopupOrderRawResponse,
  Claude360TopupOrderStatus,
  Claude360TopupOrderStatusRawResponse
} from '../../shared/claude360'
import { Claude360ApiError } from './claude360-api-client'
import { CLAUDE360_CLI_TOKEN_REF, type Claude360SecretStore } from './claude360-secret-store'

/**
 * Claude360 账单/充值/用量服务（plan-03 Task 3）。
 * 复用 `/api/cli/me`、`/api/cli/topup/*`、`/api/cli/token_stats`，
 * 充值金额必须来自后端 options / 满足 min_topup（由后端校验）。
 */

export type Claude360ApiClientPort = {
  get<T>(path: string, token?: string): Promise<T>
  post<T>(path: string, body?: unknown, token?: string): Promise<T>
}

export type Claude360BillingServiceDeps = {
  apiClient: Claude360ApiClientPort
  secretStore: Claude360SecretStore
}

export type Claude360WechatTopupInput = {
  amount: number
  discountCode?: string
}

export class Claude360BillingService {
  private readonly deps: Claude360BillingServiceDeps

  constructor(deps: Claude360BillingServiceDeps) {
    this.deps = deps
  }

  private async cliToken(): Promise<string> {
    const token = await this.deps.secretStore.loadSecret(CLAUDE360_CLI_TOKEN_REF)
    if (!token) throw new Claude360ApiError('未登录，请先登录 Claude360')
    return token
  }

  async getMe(): Promise<Claude360Me> {
    const token = await this.cliToken()
    const r = await this.deps.apiClient.get<Claude360MeRawResponse>('/api/cli/me', token)
    return {
      username: r.username ?? '',
      displayName: r.display_name ?? '',
      email: r.email ?? '',
      group: r.group ?? '',
      balanceDisplay: r.balance_display ?? '',
      usedDisplay: r.used_display ?? '',
      lowBalance: r.low_balance === true,
      todayTokens: r.today_tokens ?? 0,
      todayRequests: r.today_requests ?? 0,
      todayUsageDisplay: r.today_usage_display ?? ''
    }
  }

  async getTopupOptions(): Promise<Claude360TopupOptions> {
    const token = await this.cliToken()
    const r = await this.deps.apiClient.get<Claude360TopupOptionsRawResponse>('/api/cli/topup/options', token)
    return {
      wechatEnabled: r.wechat_enabled === true,
      amountOptions: Array.isArray(r.amount_options) ? r.amount_options : [],
      minTopup: r.min_topup ?? 0,
      payUrl: r.pay_url ?? ''
    }
  }

  async createWechatTopup(input: Claude360WechatTopupInput): Promise<Claude360TopupOrder> {
    const token = await this.cliToken()
    const r = await this.deps.apiClient.post<Claude360TopupOrderRawResponse>(
      '/api/cli/topup/wechat',
      { amount: input.amount, discount_code: input.discountCode ?? '' },
      token
    )
    return { orderId: r.order_id, codeUrl: r.code_url, moneyDisplay: r.money_display ?? '' }
  }

  async getTopupOrder(orderId: string): Promise<Claude360TopupOrderStatus> {
    const token = await this.cliToken()
    const r = await this.deps.apiClient.get<Claude360TopupOrderStatusRawResponse>(
      `/api/cli/topup/order?order_id=${encodeURIComponent(orderId)}`,
      token
    )
    return {
      orderId: r.order_id,
      status: r.status,
      moneyDisplay: r.money_display ?? '',
      completeTime: r.complete_time ?? 0
    }
  }

  async getTokenStats(query: Claude360TokenStatsQuery = {}): Promise<Claude360TokenStat[]> {
    const token = await this.cliToken()
    const params = new URLSearchParams()
    if (query.startTimestamp && query.startTimestamp > 0) {
      params.set('start_timestamp', String(query.startTimestamp))
    }
    if (query.endTimestamp && query.endTimestamp > 0) {
      params.set('end_timestamp', String(query.endTimestamp))
    }
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const rows = await this.deps.apiClient.get<Claude360TokenStatRawResponse[]>(
      `/api/cli/token_stats${suffix}`,
      token
    )
    return (rows ?? []).map((row) => ({
      tokenName: row.token_name,
      requestCount: row.request_count ?? 0,
      totalTokens: row.total_tokens ?? 0,
      quota: row.quota ?? 0
    }))
  }
}
