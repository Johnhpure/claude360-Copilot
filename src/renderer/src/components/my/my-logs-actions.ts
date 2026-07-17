// 「我的」页 · 调用日志的纯逻辑层（07-17 my-newapi-call-logs）。
//
// 与 my-page-actions.ts 同思路：筛选草稿 → 查询参数、时间/用时格式化、类型徽章
// 映射、页码序列、列显隐持久化全部拆成纯函数，node 环境直接单测；
// MyLogsPanel 组件只做编排与渲染，不承载业务规则。
import type { Claude360LogBilling, Claude360LogItem, Claude360LogsQuery } from '@shared/claude360'
import { browserStorage, type BrowserStorageLike } from '../../lib/browser-storage'

// ── 时间预设与筛选草稿 ──

export type LogsPresetKey = 'hour1' | 'today' | 'day7' | 'day30' | 'custom'

/** 每页条数可选值与默认值（确认稿分页页脚口径）。 */
export const LOGS_PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_LOGS_PAGE_SIZE = 20

/** 筛选草稿（UI 编辑态）；点「查询」后经 buildLogsQuery 固化为请求参数。 */
export type LogsFilterDraft = {
  preset: LogsPresetKey
  /** unix 秒；null = 不限（custom 下允许清空）。 */
  startTimestamp: number | null
  endTimestamp: number | null
  /** 0=全部（构建查询时剔除，后端「无参数=不过滤」）。 */
  type: number
  tokenName: string
  group: string
  modelName: string
  requestId: string
}

const HOUR_SECONDS = 3_600
const DAY_SECONDS = 86_400

/**
 * 预设 chips → 起止时间戳（unix 秒）。custom 返回 null：保留用户手动输入的区间。
 * today 取本地时区当日 00:00，与用户对「今天」的直觉一致（后端按 unix 秒过滤，
 * 不感知时区，语义由客户端定）。
 */
export function presetRange(
  key: LogsPresetKey,
  now: Date
): { startTimestamp: number; endTimestamp: number } | null {
  const endTimestamp = Math.floor(now.getTime() / 1000)
  switch (key) {
    case 'hour1':
      return { startTimestamp: endTimestamp - HOUR_SECONDS, endTimestamp }
    case 'today': {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return { startTimestamp: Math.floor(midnight.getTime() / 1000), endTimestamp }
    }
    case 'day7':
      return { startTimestamp: endTimestamp - 7 * DAY_SECONDS, endTimestamp }
    case 'day30':
      return { startTimestamp: endTimestamp - 30 * DAY_SECONDS, endTimestamp }
    case 'custom':
      return null
  }
}

/** 默认草稿：今天 / 全部类型 / 无文本筛选（prd：进入 Tab 即按此自动首查）。 */
export function defaultLogsDraft(now: Date): LogsFilterDraft {
  const range = presetRange('today', now)
  return {
    preset: 'today',
    startTimestamp: range?.startTimestamp ?? null,
    endTimestamp: range?.endTimestamp ?? null,
    type: 0,
    tokenName: '',
    group: '',
    modelName: '',
    requestId: ''
  }
}

/**
 * 草稿 → IPC 查询参数：空串 / type=0 / 非正时间戳一律剔除，时间取整秒、
 * 文本 trim 后携带 —— 与后端「无参数=不过滤」语义一一对应。
 */
export function buildLogsQuery(
  draft: LogsFilterDraft,
  page: number,
  pageSize: number
): Claude360LogsQuery {
  const query: Claude360LogsQuery = { page, pageSize }
  if (Number.isFinite(draft.type) && draft.type > 0) query.type = Math.floor(draft.type)
  if (draft.startTimestamp != null && draft.startTimestamp > 0) {
    query.startTimestamp = Math.floor(draft.startTimestamp)
  }
  if (draft.endTimestamp != null && draft.endTimestamp > 0) {
    query.endTimestamp = Math.floor(draft.endTimestamp)
  }
  const tokenName = draft.tokenName.trim()
  if (tokenName) query.tokenName = tokenName
  const group = draft.group.trim()
  if (group) query.group = group
  const modelName = draft.modelName.trim()
  if (modelName) query.modelName = modelName
  const requestId = draft.requestId.trim()
  if (requestId) query.requestId = requestId
  return query
}

// ── 展示格式化 ──

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** unix 秒 → 「MM-DD」+「HH:mm:ss」两段（本地时区），UI 对日期段做弱化配色。 */
export function formatLogTime(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000)
  return {
    date: `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }
}

/**
 * unix 秒 → `<input type="datetime-local">` 的本地时间串（分钟精度）。
 * null/非法/非正值返回 ''（datetime-local 的「空」态），与 LogsFilterDraft
 * 的「null = 不限」语义对齐。
 */
export function timestampToDatetimeLocal(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * datetime-local 输入值 → unix 秒。空串/非法输入返回 null（清空 = 不限）。
 * 无时区后缀的 ISO 串按 ES 规范解析为本地时间，恰是 datetime-local 的语义。
 */
export function datetimeLocalToTimestamp(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/** 秒数 → 至多 1 位小数、整数去尾零的短文本（"3" / "3.2" / "0.8"）。 */
function formatSecondsShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0'
  const rounded = Math.round(seconds * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * 用时徽章文本：「3.2s」或流式带首字耗时的「3.2s · 首0.8s」。
 * firstLabel 由调用方注入 i18n 文案（默认中文「首」），纯函数不依赖 i18n 运行时；
 * 首字耗时只对流式请求有意义，非流式即使带 frt 也不展示。
 */
export function formatDuration(
  useTimeSeconds: number,
  firstTokenMs: number | null,
  isStream: boolean,
  firstLabel = '首'
): string {
  const total = `${formatSecondsShort(useTimeSeconds)}s`
  if (!isStream || firstTokenMs == null || !Number.isFinite(firstTokenMs) || firstTokenMs < 0) {
    return total
  }
  return `${total} · ${firstLabel}${formatSecondsShort(firstTokenMs / 1000)}s`
}

/** 用时快慢配色：≤10s 视为正常（success），更慢给 warning（确认稿口径）。 */
export function durationTone(seconds: number): 'success' | 'warning' {
  return seconds <= 10 ? 'success' : 'warning'
}

// ── 计费过程（详情区多行价格明细） ──

/**
 * formatBillingProcess 的原子文案（注入式，便于 node 单测不依赖 i18n 运行时）。
 * 公式行由这些词拼接，不依赖 t() 插值能力。
 */
export type BillingProcessLabels = {
  inputPrice: string
  outputPrice: string
  cacheReadPrice: string
  cacheWritePrice: string
  modelPrice: string
  groupRatio: string
  /** 每百万 tokens 单位后缀（如「1M tokens」）。 */
  perMillion: string
  input: string
  cache: string
  output: string
  disclaimer: string
}

const MILLION = 1_000_000

/** 单价（¥/1M）：≥1 用 4 位小数，更小用 6 位（对齐 newapi 前端 digitsLarge:4/digitsSmall:6）。 */
function formatCnyRate(value: number): string {
  return value >= 1 ? value.toFixed(4) : value.toFixed(6)
}

/** 倍率展示：4 位小数 + x（对齐 newapi 前端 effectiveGR.toFixed(4)+'x'）。 */
function formatRatio(value: number): string {
  return `${value.toFixed(4)}x`
}

/**
 * 计费过程 → 多行文本（string[]，空数组=整块隐藏）。数据取 main 现算的 billing：
 * 单价行按值非 null 输出（缓存行额外要求对应 tokens>0，无缓存不显示缓存价以减噪）；
 * 按次计费(perCall)只出「模型价格」+分组倍率，不出 token 公式；
 * 常规计费在输入单价齐备且至少一段 tokens>0 时追加公式行（总价展示层自算 ¥%.6f，
 * 与后端 quota 算法同构）；尾行免责声明恒随非空块出现，兜底取整差异。
 */
export function formatBillingProcess(
  item: Pick<Claude360LogItem, 'billing' | 'promptTokens' | 'completionTokens' | 'cacheTokens' | 'cacheCreationTokens'>,
  labels: BillingProcessLabels
): string[] {
  const billing = item.billing
  if (billing == null) return []
  const lines: string[] = []

  if (billing.perCall) {
    if (billing.modelPriceCny != null) {
      lines.push(`${labels.modelPrice} ¥${formatCnyRate(billing.modelPriceCny)}`)
    }
  } else {
    if (billing.inputPricePerMCny != null) {
      lines.push(`${labels.inputPrice} ¥${formatCnyRate(billing.inputPricePerMCny)} / ${labels.perMillion}`)
    }
    if (billing.outputPricePerMCny != null) {
      lines.push(`${labels.outputPrice} ¥${formatCnyRate(billing.outputPricePerMCny)} / ${labels.perMillion}`)
    }
    if (billing.cacheReadPricePerMCny != null && (item.cacheTokens ?? 0) > 0) {
      lines.push(`${labels.cacheReadPrice} ¥${formatCnyRate(billing.cacheReadPricePerMCny)} / ${labels.perMillion}`)
    }
    if (billing.cacheWritePricePerMCny != null && (item.cacheCreationTokens ?? 0) > 0) {
      lines.push(`${labels.cacheWritePrice} ¥${formatCnyRate(billing.cacheWritePricePerMCny)} / ${labels.perMillion}`)
    }
  }

  if (billing.groupRatio != null) {
    lines.push(`${labels.groupRatio} ${formatRatio(billing.groupRatio)}`)
  }

  if (!billing.perCall && billing.inputPricePerMCny != null) {
    const formula = buildBillingFormula(item, billing, labels)
    if (formula != null) lines.push(formula)
  }

  if (lines.length === 0) return []
  lines.push(labels.disclaimer)
  return lines
}

/**
 * token 计费公式行：「Σ 各段 tokens/1M × 单价 [× 分组倍率] = ¥总价」。
 * normalInput = max(0, prompt − 缓存读 − 缓存写)；tokens 为 0 的段不进公式；
 * 无任何段可算返回 null（不出公式行）。
 */
function buildBillingFormula(
  item: Pick<Claude360LogItem, 'promptTokens' | 'completionTokens' | 'cacheTokens' | 'cacheCreationTokens'>,
  billing: Claude360LogBilling,
  labels: BillingProcessLabels
): string | null {
  const cacheTokens = item.cacheTokens ?? 0
  const cacheCreationTokens = item.cacheCreationTokens ?? 0
  const normalInput = Math.max(0, item.promptTokens - cacheTokens - cacheCreationTokens)
  const terms: string[] = []
  let total = 0
  const pushTerm = (atom: string, count: number, price: number | null): void => {
    if (count <= 0 || price == null) return
    terms.push(`${atom} ${count.toLocaleString()} × ¥${formatCnyRate(price)} / ${labels.perMillion}`)
    total += (count / MILLION) * price
  }
  pushTerm(labels.input, normalInput, billing.inputPricePerMCny)
  pushTerm(labels.cache, cacheTokens, billing.cacheReadPricePerMCny)
  pushTerm(labels.output, item.completionTokens, billing.outputPricePerMCny)
  if (terms.length === 0) return null
  const groupRatio = billing.groupRatio
  if (groupRatio != null) total *= groupRatio
  const head = terms.length > 1 ? `(${terms.join(' + ')})` : terms[0]
  const groupPart = groupRatio != null ? ` × ${labels.groupRatio} ${formatRatio(groupRatio)}` : ''
  return `${head}${groupPart} = ¥${total.toFixed(6)}`
}

// ── 日志类型徽章 ──

/**
 * 是否「API 调用类」日志：消费(2)与错误(5)行携带模型/用时/输入输出/IP 数据
 * （确认稿的错误行照常展示这些列）；充值/管理/系统/退款不适用，表格显示「—」。
 */
export function isCallLogType(type: number): boolean {
  return type === 2 || type === 5
}

export type LogTypeTone = 'accent' | 'success' | 'danger' | 'warning' | 'skill' | 'muted'

/**
 * newapi LogType 常量 → i18n labelKey + 语义色（prd 徽章配色口径：消费=accent、
 * 充值=success、错误=danger、系统/管理=warning、退款=skill）。
 * 未知取值兜底 muted，后端新增类型时前端不至于渲染崩坏。
 */
export function logTypeMeta(type: number): { labelKey: string; tone: LogTypeTone } {
  switch (type) {
    case 1:
      return { labelKey: 'myLogsTypeTopup', tone: 'success' }
    case 2:
      return { labelKey: 'myLogsTypeConsume', tone: 'accent' }
    case 3:
      return { labelKey: 'myLogsTypeAdmin', tone: 'warning' }
    case 4:
      return { labelKey: 'myLogsTypeSystem', tone: 'warning' }
    case 5:
      return { labelKey: 'myLogsTypeError', tone: 'danger' }
    case 6:
      return { labelKey: 'myLogsTypeRefund', tone: 'skill' }
    default:
      return { labelKey: 'myLogsTypeUnknown', tone: 'muted' }
  }
}

// ── 分页 ──

/** 总页数（展示用，至少 1 页，避免「第 1 / 0 页」）。 */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) return 1
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1
  return Math.ceil(total / pageSize)
}

export type PagerItem = number | 'ellipsis'

/**
 * 页码按钮序列（含省略号），固定 7 槽位：边缘整段展开、中段两侧省略，
 * 保证首末页恒可直达且序列长度稳定（翻页时按钮不跳动）。
 */
export function pagerItems(current: number, count: number): PagerItem[] {
  if (!Number.isFinite(count) || count <= 0) return []
  const clamped = Math.min(Math.max(1, Math.floor(current)), count)
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  if (clamped <= 4) return [1, 2, 3, 4, 5, 'ellipsis', count]
  if (clamped >= count - 3) {
    return [1, 'ellipsis', count - 4, count - 3, count - 2, count - 1, count]
  }
  return [1, 'ellipsis', clamped - 1, clamped, clamped + 1, 'ellipsis', count]
}

// ── 列显隐偏好（localStorage） ──

/** 可隐藏列；核心列（时间/令牌/类型/模型/输入/输出/花费/详情）固定不可配。 */
export type LogColumnKey = 'group' | 'duration' | 'ip' | 'requestId'

export type LogColumnPrefs = Record<LogColumnKey, boolean>

export const LOG_COLUMN_PREFS_STORAGE_KEY = 'c360.myLogs.columns'

/** 默认显隐：Request ID 列默认隐藏（11 列已占满 960 容器，该列按需开启）。 */
export function defaultLogColumnPrefs(): LogColumnPrefs {
  return { group: true, duration: true, ip: true, requestId: false }
}

/**
 * 读取列偏好。storage 参数便于单测注入，默认取真实 localStorage；
 * 键缺失/坏 JSON/类型不对都逐键回落默认值，坏数据不放大。
 */
export function loadColumnPrefs(
  storage: BrowserStorageLike | null = browserStorage()
): LogColumnPrefs {
  const defaults = defaultLogColumnPrefs()
  if (!storage) return defaults
  try {
    const raw = storage.getItem(LOG_COLUMN_PREFS_STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed == null) return defaults
    const record = parsed as Record<string, unknown>
    const next = { ...defaults }
    for (const key of Object.keys(defaults) as LogColumnKey[]) {
      const value = record[key]
      if (typeof value === 'boolean') next[key] = value
    }
    return next
  } catch {
    return defaults
  }
}

/** 持久化列偏好；localStorage 不可用（隐私模式等）时静默忽略，退化为会话内状态。 */
export function saveColumnPrefs(
  prefs: LogColumnPrefs,
  storage: BrowserStorageLike | null = browserStorage()
): void {
  if (!storage) return
  try {
    storage.setItem(LOG_COLUMN_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // 忽略持久化失败：偏好丢失只影响下次启动的默认显隐。
  }
}
