// Claude360 中转站客户端共享类型（plan-02 Task 3）。
// 跨 main/preload/renderer 复用；renderer 永远拿不到 cli_token / API Key 明文。

/** newapi `{ success, data } | { success, message }` 信封。 */
export type Claude360Envelope<T> =
  | { success: true; data: T }
  | { success: false; message?: string }

/** `/api/cli/auth/password` 等返回的用户摘要。 */
export type Claude360UserSummary = {
  id: number
  username: string
  displayName: string
  group: string
}

/** 展示态会话（可安全下发 renderer，不含任何明文凭据）。 */
export type Claude360SessionResult = {
  loggedIn: boolean
  username: string
  displayName: string
  baseUrl: string
  message?: string
}

export type Claude360DeviceAuthStartResult =
  | {
      ok: true
      deviceCode: string
      userCode: string
      verificationUrl: string
      expiresIn: number
      interval: number
    }
  | { ok: false; message: string }

export type Claude360DeviceAuthStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'

export type Claude360DeviceAuthPollResult =
  | { ok: true; status: 'approved'; session: Claude360SessionResult }
  | { ok: true; status: Exclude<Claude360DeviceAuthStatus, 'approved'> }
  | { ok: false; message: string }

export type Claude360PasswordLoginPayload = {
  username: string
  password: string
}

export type Claude360PasswordLogin2FAPayload = {
  challengeId: string
  code: string
}

export type Claude360LoginResult =
  | { ok: true; require2fa: false; session: Claude360SessionResult }
  | { ok: true; require2fa: true; challengeId: string; expiresIn: number }
  | { ok: false; message: string }

export type Claude360LogoutResult = { ok: true }

export type Claude360SyncResult =
  | { ok: true; session: Claude360SessionResult }
  | { ok: false; message: string }

// ── newapi 原始响应 DTO（main 进程内部用，不直接下发 renderer） ──

export type Claude360PasswordLoginResponse =
  | {
      require_2fa: false
      cli_token: string
      user: { id: number; username: string; display_name: string; group: string }
    }
  | { require_2fa: true; challenge_id: string; expires_in: number }

export type Claude360DeviceAuthStartResponse = {
  device_code: string
  user_code: string
  verification_url: string
  expires_in: number
  interval: number
}

export type Claude360DeviceAuthPollResponse = {
  status: Claude360DeviceAuthStatus
  cli_token?: string
}

export type Claude360MeResponse = {
  id?: number
  username?: string
  display_name?: string
  group?: string
}

// ── Token / 分组 / 模型 / 充值 / 用量（plan-03） ──

export type Claude360TokenListItem = {
  id: number
  name: string
  maskedKey: string
  status: number
  group: string
  remainQuota: number
  unlimitedQuota: boolean
}

export type Claude360TokenPurpose = 'text' | 'image' | 'music'

/**
 * Claude360 分组标识的统一归一化（trim + 小写），仅用于「是否同一分组」的比较。
 * 背景：provider profile id 经 normalizeModelProviderId 会被 lowercase（分组 "Codex"
 * → id "claude360-codex"），而服务端 token.group / profile.name 保留原始大小写。
 * 分组 id 语义上唯一且大小写不敏感，所有跨端分组匹配必须经此归一；
 * 禁止裸 `===` 比较（曾导致已有 Key 的分组被误判无 Key 并重复创建 Key）。
 */
export function normalizeClaude360GroupKey(group: string | null | undefined): string {
  return (group ?? '').trim().toLowerCase()
}

/** 两个 Claude360 分组标识是否指向同一分组（大小写不敏感；空值不与任何分组相等）。 */
export function sameClaude360Group(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeClaude360GroupKey(a)
  return na !== '' && na === normalizeClaude360GroupKey(b)
}

/** newapi `/api/cli/tokens` 列表项原始响应。 */
export type Claude360TokenListResponseItem = {
  id: number
  name: string
  masked_key?: string
  status?: number
  group?: string
  remain_quota?: number
  unlimited_quota?: boolean
}

export type Claude360TokenListResponse = { items: Claude360TokenListResponseItem[] }

export type Claude360CreateTokenResponse = {
  id: number
  name: string
  key: string
  group: string
}

export type Claude360RevealTokenResponse = { key: string }

// ── 账单 / 充值 / 用量（plan-03 Task 3） ──

export type Claude360Me = {
  username: string
  displayName: string
  email: string
  group: string
  balanceDisplay: string
  usedDisplay: string
  lowBalance: boolean
  todayTokens: number
  todayRequests: number
  todayUsageDisplay: string
}

export type Claude360TopupOptions = {
  wechatEnabled: boolean
  amountOptions: number[]
  minTopup: number
  payUrl: string
}

export type Claude360TopupOrder = {
  orderId: string
  codeUrl: string
  moneyDisplay: string
}

export type Claude360TopupOrderStatus = {
  orderId: string
  /**
   * 后端订单状态为**字符串**枚举 `pending / success / failed / expired`
   * （newapi common/constants.go:244）。主进程透传原值；完成判断以 completeTime
   * 为准（isTopupOrderComplete），failed/expired 用于提前终止轮询。
   */
  status: string
  moneyDisplay: string
  completeTime: number
}

export type Claude360TokenStat = {
  tokenName: string
  requestCount: number
  totalTokens: number
  quota: number
}

export type Claude360TokenStatsQuery = {
  startTimestamp?: number
  endTimestamp?: number
}

// 原始响应（main 进程内部映射用）
export type Claude360MeRawResponse = {
  username?: string
  display_name?: string
  email?: string
  group?: string
  balance_display?: string
  used_display?: string
  low_balance?: boolean
  today_tokens?: number
  today_requests?: number
  today_usage_display?: string
}

export type Claude360TopupOptionsRawResponse = {
  wechat_enabled?: boolean
  amount_options?: number[]
  min_topup?: number
  pay_url?: string
}

export type Claude360TopupOrderRawResponse = {
  order_id: string
  code_url: string
  money_display?: string
}

export type Claude360TopupOrderStatusRawResponse = {
  order_id: string
  /** 字符串枚举 pending/success/failed/expired（见 Claude360TopupOrderStatus.status）。 */
  status: string
  money_display?: string
  complete_time?: number
}

export type Claude360TokenStatRawResponse = {
  token_name: string
  request_count?: number
  total_tokens?: number
  quota?: number
}

