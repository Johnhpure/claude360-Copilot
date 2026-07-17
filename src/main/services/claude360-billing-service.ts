import type {
  Claude360LogItem,
  Claude360LogItemRawResponse,
  Claude360LogsPage,
  Claude360LogsPageRawResponse,
  Claude360LogsQuery,
  Claude360LogsStat,
  Claude360LogsStatRawResponse,
  Claude360Me,
  Claude360MeRawResponse,
  Claude360StatusRawResponse,
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
 * Claude360 账单/充值/用量服务（plan-03 Task 3；07-17 扩展调用日志）。
 * 复用 `/api/cli/me`、`/api/cli/topup/*`、`/api/cli/token_stats`、`/api/cli/logs`、
 * `/api/log/self/stat`，充值金额必须来自后端 options / 满足 min_topup（由后端校验）。
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

type TokenCostPricing = {
  quotaPerUnit: number
  price: number
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
    const [pricing, rows] = await Promise.all([
      this.loadTokenCostPricing(),
      this.deps.apiClient.get<Claude360TokenStatRawResponse[]>(`/api/cli/token_stats${suffix}`, token)
    ])
    return (rows ?? []).map((row) => ({
      tokenName: row.token_name,
      requestCount: row.request_count ?? 0,
      totalTokens: row.total_tokens ?? 0,
      quota: row.quota ?? 0,
      costCny: tokenStatCostCny(row, pricing)
    }))
  }

  private async loadTokenCostPricing(): Promise<TokenCostPricing | null> {
    try {
      const status = await this.deps.apiClient.get<Claude360StatusRawResponse>('/api/status')
      const quotaPerUnit = finitePositiveNumber(status.quota_per_unit)
      const price = finitePositiveNumber(status.price)
      if (quotaPerUnit == null || price == null) return null
      return { quotaPerUnit, price }
    } catch {
      return null
    }
  }

  /**
   * 分页查询本人调用日志（`/api/cli/logs`，CliAccessTokenAuth）。
   * 后端已做用户视角脱敏（清 channel_name、删 other.admin_info 等），
   * 这里只按 PageInfo 规整分页字段并逐条兜底缺省，不做本地过滤/排序
   * （后端按 id desc 返回）。失败直接 throw，由 renderer 决定错误展示。
   */
  async listLogs(query: Claude360LogsQuery): Promise<Claude360LogsPage> {
    const token = await this.cliToken()
    const params = new URLSearchParams()
    params.set('p', String(query.page))
    params.set('page_size', String(query.pageSize))
    appendLogsFilterParams(params, query)
    if (query.requestId) params.set('request_id', query.requestId)
    const r = await this.deps.apiClient.get<Claude360LogsPageRawResponse>(
      `/api/cli/logs?${params.toString()}`,
      token
    )
    return {
      items: (Array.isArray(r.items) ? r.items : []).map(mapLogItem),
      total: r.total ?? 0,
      page: r.page ?? query.page,
      pageSize: r.page_size ?? query.pageSize
    }
  }

  /**
   * 调用日志范围统计（`/api/log/self/stat`）。该路由的 authHelper 在无 session 时
   * 接受同一 Authorization access token（与 CliAccessTokenAuth 同用
   * ValidateAccessToken），故直接复用 CLI token。quota → ¥ 复用 /api/status 价格；
   * 价格拿不到只置 quotaCny=null（RPM/TPM 照常），统计接口本身失败则 throw，
   * 由 renderer 隐藏统计区（与列表错误域独立）。
   */
  async getLogsStat(query: Claude360LogsQuery): Promise<Claude360LogsStat> {
    const token = await this.cliToken()
    const params = new URLSearchParams()
    appendLogsFilterParams(params, query)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const [pricing, r] = await Promise.all([
      this.loadTokenCostPricing(),
      this.deps.apiClient.get<Claude360LogsStatRawResponse>(`/api/log/self/stat${suffix}`, token)
    ])
    const quota = finiteNonNegativeNumber(r.quota)
    return {
      quotaCny:
        pricing != null && quota != null ? (quota / pricing.quotaPerUnit) * pricing.price : null,
      rpm: finiteNonNegativeNumber(r.rpm) ?? 0,
      tpm: finiteNonNegativeNumber(r.tpm) ?? 0
    }
  }
}

/**
 * 追加 logs / stat 共用的过滤参数。type=0（全部）与空串一律不携带 —— 后端
 * 「无参数=不过滤」；request_id 只有 `/api/cli/logs` 支持，由 listLogs 单独追加，
 * stat 若携带会被后端忽略、造成统计与列表口径不一致的假象，故这里不放。
 */
function appendLogsFilterParams(params: URLSearchParams, query: Claude360LogsQuery): void {
  if (query.type && query.type > 0) params.set('type', String(query.type))
  if (query.startTimestamp && query.startTimestamp > 0) {
    params.set('start_timestamp', String(query.startTimestamp))
  }
  if (query.endTimestamp && query.endTimestamp > 0) {
    params.set('end_timestamp', String(query.endTimestamp))
  }
  if (query.tokenName) params.set('token_name', query.tokenName)
  if (query.modelName) params.set('model_name', query.modelName)
  if (query.group) params.set('group', query.group)
}

/** `/api/cli/logs` 单条原始响应 → 展示模型；数值/字符串逐字段缺省兜底。 */
function mapLogItem(raw: Claude360LogItemRawResponse): Claude360LogItem {
  return {
    createdAt: raw.created_at ?? 0,
    type: raw.type ?? 0,
    content: raw.content ?? '',
    tokenName: raw.token_name ?? '',
    modelName: raw.model_name ?? '',
    group: raw.group ?? '',
    ip: raw.ip ?? '',
    requestId: raw.request_id ?? '',
    quota: raw.quota ?? 0,
    promptTokens: raw.prompt_tokens ?? 0,
    completionTokens: raw.completion_tokens ?? 0,
    useTimeSeconds: raw.use_time ?? 0,
    isStream: raw.is_stream === true,
    firstTokenMs: parseFirstTokenMs(raw.other),
    costDisplay: raw.cost_display ?? ''
  }
}

/**
 * other 是后端内部 JSON 串（newapi 把 frt=首字毫秒写在其中），格式不受本端控制：
 * 解析必须 try/catch 且只认有限非负数，任何异常都归 null（UI 显示「—」），
 * renderer 因此永远不依赖该内部格式。
 */
function parseFirstTokenMs(other: string | undefined): number | null {
  if (!other) return null
  try {
    const parsed: unknown = JSON.parse(other)
    if (typeof parsed !== 'object' || parsed == null) return null
    const frt = (parsed as { frt?: unknown }).frt
    return typeof frt === 'number' && Number.isFinite(frt) && frt >= 0 ? frt : null
  } catch {
    return null
  }
}

function tokenStatCostCny(row: Claude360TokenStatRawResponse, pricing: TokenCostPricing | null): number | null {
  const directCost = firstFiniteNonNegativeNumber(
    row.cost_cny,
    row.amount_cny,
    row.fee_cny,
    row.price_cny,
    row.expense_cny,
    row.cost,
    row.amount,
    row.fee,
    row.price,
    row.expense
  )
  if (directCost != null) return directCost

  if (pricing == null) return null
  const quota = finiteNonNegativeNumber(row.quota)
  if (quota == null) return null
  return (quota / pricing.quotaPerUnit) * pricing.price
}

function firstFiniteNonNegativeNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNonNegativeNumber(value)
    if (parsed != null) return parsed
  }
  return null
}

function finitePositiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed != null && parsed > 0 ? parsed : null
}

function finiteNonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed != null && parsed >= 0 ? parsed : null
}

function finiteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(numberValue) ? numberValue : null
}
