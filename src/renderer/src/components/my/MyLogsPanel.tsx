import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ListFilter,
  ScrollText,
  Search,
  Zap
} from 'lucide-react'
import type {
  Claude360LogItem,
  Claude360LogsPage,
  Claude360LogsQuery,
  Claude360LogsStat
} from '@shared/claude360'
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Popover, Select, toast } from '../ui'
import type { SelectOption } from '../ui'
import {
  DEFAULT_LOGS_PAGE_SIZE,
  LOGS_PAGE_SIZES,
  buildLogsQuery,
  datetimeLocalToTimestamp,
  defaultLogsDraft,
  durationTone,
  formatBillingProcess,
  formatDuration,
  formatLogTime,
  isCallLogType,
  loadColumnPrefs,
  logTypeMeta,
  pageCount,
  pagerItems,
  presetRange,
  saveColumnPrefs,
  timestampToDatetimeLocal,
  type BillingProcessLabels,
  type LogColumnKey,
  type LogColumnPrefs,
  type LogTypeTone,
  type LogsFilterDraft,
  type LogsPresetKey
} from './my-logs-actions'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** t → formatBillingProcess 的原子文案（集中在一处，供详情渲染与整体复制复用）。 */
function billingLabelsFromT(t: Translate): BillingProcessLabels {
  return {
    inputPrice: t('myLogsDetailInputPrice'),
    outputPrice: t('myLogsDetailOutputPrice'),
    cacheReadPrice: t('myLogsDetailCacheReadPrice'),
    cacheWritePrice: t('myLogsDetailCacheWritePrice'),
    modelPrice: t('myLogsDetailModelPrice'),
    groupRatio: t('myLogsDetailGroupRatio'),
    perMillion: t('myLogsDetailPerMillion'),
    input: t('myLogsDetailBillInput'),
    cache: t('myLogsDetailBillCache'),
    output: t('myLogsDetailBillOutput'),
    disclaimer: t('myLogsDetailDisclaimer')
  }
}

/** 缓存 Tokens 摘要：「读 X · 写 Y」（千分位与表格 tokens 列一致）；两者皆 0 返回 ''。 */
function formatCacheSummary(item: Claude360LogItem, t: Translate): string {
  const read = item.cacheTokens ?? 0
  const write = item.cacheCreationTokens ?? 0
  const parts: string[] = []
  if (read > 0) parts.push(`${t('myLogsDetailCacheRead')} ${read.toLocaleString()}`)
  if (write > 0) parts.push(`${t('myLogsDetailCacheWrite')} ${write.toLocaleString()}`)
  return parts.join(' · ')
}

// 「我的」页 · 调用日志面板(07-17 my-newapi-call-logs design §5.2,方案 B)。
// 结构对照确认稿:标题行(列设置 Popover)→ 时间预设 chips → 筛选网格 →
// 范围统计 tiles → 11+1 列表格(详情行内展开)→ 分页页脚;三态走 ui/states。
// 编排原则:业务规则全部在 my-logs-actions 纯函数层;本组件只持有
// draft(编辑态)/applied(已提交查询)/响应数据等 UI 状态并渲染。
// 懒首查:父层常挂载本面板,首次 active=true 才发默认查询(进「我的」页不多打接口)。
// 错误域独立:统计失败只隐藏统计区,列表照常;requestId 有值时统计区整体隐藏
// (后端 /api/log/self/stat 不支持该过滤,展示会造成口径误导,prd R3)。

// ── 表格列模型 ──

type LogsColumnId =
  | 'time'
  | 'token'
  | 'group'
  | 'type'
  | 'model'
  | 'duration'
  | 'input'
  | 'output'
  | 'cost'
  | 'ip'
  | 'requestId'
  | 'detail'

type LogsColumnDef = {
  id: LogsColumnId
  labelKey: string
  /** 表头对齐(数字列右对齐;表头与数据格同套对齐,MyUsagePanel 惯例)。 */
  headerAlign: 'text-left' | 'text-right'
  /** 有值 = 可经「列设置」隐藏;缺省 = 固定列。 */
  pref?: LogColumnKey
}

// 列顺序 = 确认稿 11 列;Request ID 为第 12 个可选列(默认隐藏),插在 IP 与详情之间。
const LOGS_COLUMNS: LogsColumnDef[] = [
  { id: 'time', labelKey: 'myLogsColTime', headerAlign: 'text-left' },
  { id: 'token', labelKey: 'myLogsColToken', headerAlign: 'text-left' },
  { id: 'group', labelKey: 'myLogsColGroup', headerAlign: 'text-left', pref: 'group' },
  { id: 'type', labelKey: 'myLogsColType', headerAlign: 'text-left' },
  { id: 'model', labelKey: 'myLogsColModel', headerAlign: 'text-left' },
  { id: 'duration', labelKey: 'myLogsColDuration', headerAlign: 'text-left', pref: 'duration' },
  { id: 'input', labelKey: 'myLogsColInput', headerAlign: 'text-right' },
  { id: 'output', labelKey: 'myLogsColOutput', headerAlign: 'text-right' },
  { id: 'cost', labelKey: 'myLogsColCost', headerAlign: 'text-right' },
  { id: 'ip', labelKey: 'myLogsColIp', headerAlign: 'text-left', pref: 'ip' },
  { id: 'requestId', labelKey: 'myLogsColRequestId', headerAlign: 'text-left', pref: 'requestId' },
  { id: 'detail', labelKey: 'myLogsColDetail', headerAlign: 'text-right' }
]

/** 「列设置」Popover 里可切换的列(其余为固定列,顺序同表格)。 */
const TOGGLEABLE_COLUMNS: { pref: LogColumnKey; labelKey: string }[] = [
  { pref: 'group', labelKey: 'myLogsColGroup' },
  { pref: 'duration', labelKey: 'myLogsColDuration' },
  { pref: 'ip', labelKey: 'myLogsColIp' },
  { pref: 'requestId', labelKey: 'myLogsColRequestId' }
]

function visibleColumns(prefs: LogColumnPrefs): LogsColumnDef[] {
  return LOGS_COLUMNS.filter((col) => col.pref == null || prefs[col.pref])
}

// ── 徽章/胶囊样式(确认稿 .badge/.pill 口径,全 token 类) ──

const BADGE_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-pill)] px-2 py-0.5 text-[11.5px] font-medium'

const TYPE_TONE_CLASS: Record<LogTypeTone, string> = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-ds-success-soft text-ds-success',
  danger: 'bg-ds-danger-soft text-ds-danger',
  warning: 'bg-ds-warning-soft text-ds-warning',
  skill: 'bg-ds-skill-soft text-ds-skill',
  muted: 'bg-ds-subtle text-ds-muted'
}

function Dash(): ReactElement {
  return <span className="text-ds-faint">—</span>
}

/** 令牌/模型/分组的小胶囊;strong=true 时内文加重(确认稿令牌/模型带 .strong)。 */
function CellPill({
  text,
  maxWidthClass,
  strong = false
}: {
  text: string
  maxWidthClass: string
  strong?: boolean
}): ReactElement {
  return (
    <span
      className={`inline-flex ${maxWidthClass} items-center rounded-[var(--radius-pill)] border border-ds-border bg-ds-subtle px-2 py-0.5 text-[11.5px] text-ds-muted`}
      title={text}
    >
      <span className={`truncate ${strong ? 'font-medium text-ds-ink' : ''}`}>{text}</span>
    </span>
  )
}

// ── 表格(独立可测的展示层:props 注入状态,不发请求) ──

export type MyLogsTableProps = {
  items: Claude360LogItem[]
  columns: LogColumnPrefs
  /** 已展开详情的行下标(同一时刻允许多行展开,design §5.3)。 */
  expandedRows: ReadonlySet<number>
  onToggleRow: (index: number) => void
  onCopyDetail: (item: Claude360LogItem) => void
  /** 复制任意文本(详情区 Request ID 行内复制按钮用,仅复制该值)。 */
  onCopyText: (text: string) => void
  t: Translate
}

export function MyLogsTable({
  items,
  columns,
  expandedRows,
  onToggleRow,
  onCopyDetail,
  onCopyText,
  t
}: MyLogsTableProps): ReactElement {
  const cols = visibleColumns(columns)
  return (
    // min-w 兜底:窄窗口横向滚动而不是挤压 11 列(prd 验收 6);面板已移出 960 容器,
    // 放宽到 1024 让各列有更充裕的呼吸空间。
    <div className="mt-3.5 overflow-x-auto" style={{ scrollbarGutter: 'stable' }}>
      <table className="w-full min-w-[1024px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-ds-border text-[11.5px] uppercase tracking-wide text-ds-faint">
            {cols.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={`whitespace-nowrap py-2 pl-2.5 font-medium first:pl-0 ${col.headerAlign}`}
              >
                {t(col.labelKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <MyLogsRow
              key={index}
              item={item}
              index={index}
              cols={cols}
              expanded={expandedRows.has(index)}
              onToggleRow={onToggleRow}
              onCopyDetail={onCopyDetail}
              onCopyText={onCopyText}
              t={t}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MyLogsRow({
  item,
  index,
  cols,
  expanded,
  onToggleRow,
  onCopyDetail,
  onCopyText,
  t
}: {
  item: Claude360LogItem
  index: number
  cols: LogsColumnDef[]
  expanded: boolean
  onToggleRow: (index: number) => void
  onCopyDetail: (item: Claude360LogItem) => void
  onCopyText: (text: string) => void
  t: Translate
}): ReactElement {
  // 展开行:底色提亮且本行下边框透明(分隔感交给 detail-box,确认稿口径)。
  const cellClass = `py-1.5 pl-2.5 align-middle first:pl-0 border-b ${
    expanded ? 'border-transparent' : 'border-ds-border-muted'
  }`
  const cacheSummary = formatCacheSummary(item, t)
  const billingLines = formatBillingProcess(item, billingLabelsFromT(t))
  return (
    <Fragment>
      <tr className={expanded ? 'bg-ds-hover' : 'hover:bg-ds-hover'}>
        {cols.map((col) => (
          <Fragment key={col.id}>
            {renderLogsCell(col.id, item, index, cellClass, expanded, onToggleRow, t)}
          </Fragment>
        ))}
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={cols.length} className="pb-2.5 pl-3.5">
            {/* 长内容(计费过程/超长 content)在 detail-box 内滚动,不撑坏表格行(design D3)。 */}
            <div className="flex max-h-[300px] flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-main px-3.5 py-2.5 text-[12px] text-ds-muted">
              {/* 1. Request ID(行内独立复制小按钮,仅复制该值) */}
              {item.requestId ? (
                <DetailKv
                  label={t('myLogsColRequestId')}
                  mono
                  action={
                    <button
                      type="button"
                      onClick={() => onCopyText(item.requestId)}
                      aria-label={t('myLogsDetailCopyRequestId')}
                      title={t('myLogsDetailCopyRequestId')}
                      className="shrink-0 rounded-[var(--radius-sm)] p-1 text-ds-faint transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <Copy className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                    </button>
                  }
                >
                  {item.requestId}
                </DetailKv>
              ) : null}
              {/* 2. 缓存 Tokens(读/写皆无则整行隐藏) */}
              {cacheSummary ? <DetailKv label={t('myLogsDetailCache')}>{cacheSummary}</DetailKv> : null}
              {/* 3. 日志详情(content 空即隐藏,不再显示占位「—」) */}
              {item.content ? <DetailKv label={t('myLogsDetailContent')}>{item.content}</DetailKv> : null}
              {/* 4. 计费过程(多行块;倍率键全缺失或无价格时 billingLines 为空,整块隐藏) */}
              {billingLines.length > 0 ? (
                <DetailKv label={t('myLogsDetailBilling')}>
                  <span className="flex flex-col gap-0.5">
                    {billingLines.map((line, i) => (
                      <span key={i}>{line}</span>
                    ))}
                  </span>
                </DetailKv>
              ) : null}
              {/* 5. Reasoning Effort(缺失即隐藏,复用徽章样式) */}
              {item.reasoningEffort ? (
                <DetailKv label={t('myLogsDetailReasoning')}>
                  <span className={`${BADGE_BASE} bg-ds-subtle uppercase text-ds-muted`}>{item.reasoningEffort}</span>
                </DetailKv>
              ) : null}
              {/* 6. 请求路径(缺失即隐藏) */}
              {item.requestPath ? (
                <DetailKv label={t('myLogsDetailPath')} mono>
                  {item.requestPath}
                </DetailKv>
              ) : null}
              {/* 7. 首字耗时(保持现状) */}
              {isCallLogType(item.type) ? (
                <DetailKv label={t('myLogsDetailFirstToken')}>
                  {item.isStream && item.firstTokenMs != null
                    ? formatDuration(item.firstTokenMs / 1000, null, false)
                    : t('myLogsDetailFirstTokenNone')}
                </DetailKv>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                className="mt-0.5 self-start"
                onClick={() => onCopyDetail(item)}
              >
                <Copy className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                {t('myLogsDetailCopy')}
              </Button>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

function DetailKv({
  label,
  mono = false,
  action,
  children
}: {
  label: string
  mono?: boolean
  action?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex gap-2.5">
      <span className="w-[96px] shrink-0 text-ds-faint">{label}</span>
      {/* 详情正文允许选中复制(select-text 抵消外层 select-none 类祖先)。 */}
      <span className={`min-w-0 flex-1 select-text break-all ${mono ? 'font-mono text-[11.5px]' : ''}`}>
        {children}
      </span>
      {action ?? null}
    </div>
  )
}

function renderLogsCell(
  id: LogsColumnId,
  item: Claude360LogItem,
  index: number,
  cellClass: string,
  expanded: boolean,
  onToggleRow: (index: number) => void,
  t: Translate
): ReactElement {
  // 「API 调用类」行(消费/错误)才有模型/用时/输入输出/IP;其余类型显示「—」。
  const callRow = isCallLogType(item.type)
  switch (id) {
    case 'time': {
      const time = formatLogTime(item.createdAt)
      return (
        <td className={`${cellClass} whitespace-nowrap tabular-nums text-ds-muted`}>
          <span className="mr-1.5 text-[11px] text-ds-faint">{time.date}</span>
          {time.time}
        </td>
      )
    }
    case 'token':
      return (
        <td className={cellClass}>
          {item.tokenName ? <CellPill text={item.tokenName} maxWidthClass="max-w-[140px]" strong /> : <Dash />}
        </td>
      )
    case 'group':
      return (
        <td className={cellClass}>
          {item.group ? <CellPill text={item.group} maxWidthClass="max-w-[112px]" /> : <Dash />}
        </td>
      )
    case 'type': {
      const meta = logTypeMeta(item.type)
      return (
        <td className={cellClass}>
          <span className={`${BADGE_BASE} ${TYPE_TONE_CLASS[meta.tone]}`}>{t(meta.labelKey)}</span>
        </td>
      )
    }
    case 'model':
      return (
        <td className={cellClass}>
          {callRow && item.modelName ? (
            <CellPill text={item.modelName} maxWidthClass="max-w-[200px]" strong />
          ) : (
            <Dash />
          )}
        </td>
      )
    case 'duration': {
      if (!callRow) {
        return (
          <td className={cellClass}>
            <Dash />
          </td>
        )
      }
      const toneClass =
        durationTone(item.useTimeSeconds) === 'success'
          ? 'bg-ds-success-soft text-ds-success'
          : 'bg-ds-warning-soft text-ds-warning'
      return (
        <td className={cellClass}>
          <span className={`${BADGE_BASE} tabular-nums ${toneClass}`}>
            {item.isStream ? (
              <Zap className="h-2.5 w-2.5 shrink-0" fill="currentColor" strokeWidth={0} aria-hidden />
            ) : null}
            {formatDuration(item.useTimeSeconds, item.firstTokenMs, item.isStream, t('myLogsFirstTokenPrefix'))}
          </span>
        </td>
      )
    }
    case 'input':
      return (
        <td className={`${cellClass} whitespace-nowrap text-right tabular-nums text-ds-muted`}>
          {callRow ? item.promptTokens.toLocaleString() : <Dash />}
        </td>
      )
    case 'output':
      return (
        <td className={`${cellClass} whitespace-nowrap text-right tabular-nums text-ds-muted`}>
          {callRow ? item.completionTokens.toLocaleString() : <Dash />}
        </td>
      )
    case 'cost': {
      // 充值行余额是「进账」:success 色 + 前缀 +,与消费花费视觉区分(确认稿)。
      const topup = item.type === 1
      return (
        <td className={`${cellClass} whitespace-nowrap text-right font-medium tabular-nums`}>
          {item.costDisplay ? (
            <span className={topup ? 'text-ds-success' : 'text-ds-ink'}>
              {topup ? `+${item.costDisplay}` : item.costDisplay}
            </span>
          ) : (
            <Dash />
          )}
        </td>
      )
    }
    case 'ip':
      return (
        <td className={`${cellClass} whitespace-nowrap text-[11px] tabular-nums text-ds-faint`}>
          {callRow && item.ip ? item.ip : <Dash />}
        </td>
      )
    case 'requestId':
      return (
        <td className={cellClass}>
          {item.requestId ? (
            <span
              className="block max-w-[160px] truncate font-mono text-[11px] text-ds-faint"
              title={item.requestId}
            >
              {item.requestId}
            </span>
          ) : (
            <Dash />
          )}
        </td>
      )
    case 'detail':
      return (
        <td className={`${cellClass} text-right`}>
          <button
            type="button"
            onClick={() => onToggleRow(index)}
            className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[12px] text-accent transition-colors duration-[var(--motion-fast)] hover:bg-accent-soft"
          >
            {expanded ? t('myLogsDetailCollapse') : t('myLogsDetailExpand')}
          </button>
        </td>
      )
  }
}

// ── 范围统计 tile ──

function LogsStatTile({
  label,
  value,
  sub,
  accent = false
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
}): ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-main px-3.5 py-3">
      <span className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">{label}</span>
      <p className={`mt-1 text-[16px] font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ds-ink'}`}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[11.5px] text-ds-faint">{sub}</p> : null}
    </div>
  )
}

/** 消耗额度:后端 quota 折算人民币,价格缺失(null)时显式「—」,不造假数据(prd R3)。 */
function formatStatQuota(quotaCny: number | null): string {
  if (quotaCny == null || !Number.isFinite(quotaCny)) return '—'
  return `¥${quotaCny.toFixed(4)}`
}

/** RPM/TPM:至多 1 位小数 + 千分位(大数值可读)。 */
function formatStatRate(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

// ── 面板主体 ──

const PRESET_CHIPS: { key: LogsPresetKey; labelKey: string }[] = [
  { key: 'hour1', labelKey: 'myLogsPresetHour1' },
  { key: 'today', labelKey: 'myLogsPresetToday' },
  { key: 'day7', labelKey: 'myLogsPresetDay7' },
  { key: 'day30', labelKey: 'myLogsPresetDay30' },
  { key: 'custom', labelKey: 'myLogsPresetCustom' }
]

type ListPhase = 'idle' | 'loading' | 'ready' | 'error'

export function MyLogsPanel({ active, t }: { active: boolean; t: Translate }): ReactElement {
  const fieldIdPrefix = useId()
  const [draft, setDraft] = useState<LogsFilterDraft>(() => defaultLogsDraft(new Date()))
  // applied = 已提交的查询(点「查询」/翻页/改每页条数才更新);变化即触发请求。
  const [applied, setApplied] = useState<Claude360LogsQuery | null>(null)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LOGS_PAGE_SIZE)
  const [pageData, setPageData] = useState<Claude360LogsPage | null>(null)
  const [listPhase, setListPhase] = useState<ListPhase>('idle')
  const [listError, setListError] = useState('')
  const [stat, setStat] = useState<Claude360LogsStat | null>(null)
  const [columns, setColumns] = useState<LogColumnPrefs>(() => loadColumnPrefs())
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(() => new Set())
  const [colsetOpen, setColsetOpen] = useState(false)
  const [tokenNames, setTokenNames] = useState<string[]>([])
  const [groupNames, setGroupNames] = useState<string[]>([])
  const colsetBtnRef = useRef<HTMLButtonElement | null>(null)

  // 卸载守卫 + 过期响应守卫(MyPage orderSeqRef 惯例):新查询自增 seq,旧响应丢弃。
  const abortedRef = useRef(false)
  const requestSeqRef = useRef(0)
  const activatedRef = useRef(false)
  const filtersLoadedRef = useRef(false)
  useEffect(() => {
    abortedRef.current = false
    return () => {
      abortedRef.current = true
    }
  }, [])

  // 懒首查:首次激活时以「现在」重算默认草稿(挂载时刻可能已过时)并提交默认查询。
  useEffect(() => {
    if (!active || activatedRef.current) return
    activatedRef.current = true
    const fresh = defaultLogsDraft(new Date())
    setDraft(fresh)
    setApplied(buildLogsQuery(fresh, 1, DEFAULT_LOGS_PAGE_SIZE))
  }, [active])

  // 令牌/分组下拉数据源(已有 IPC);失败降级为仅「全部」一个选项,不阻塞查询。
  useEffect(() => {
    if (!active || filtersLoadedRef.current) return
    filtersLoadedRef.current = true
    if (typeof window.kunGui === 'undefined') return
    const gui = window.kunGui
    void gui
      .claude360TokensList()
      .then((list) => {
        if (abortedRef.current) return
        setTokenNames([...new Set(list.map((item) => item.name).filter(Boolean))])
      })
      .catch(() => undefined)
    void gui
      .claude360GroupsList()
      .then((record) => {
        if (abortedRef.current) return
        const names = Object.values(record)
          .flat()
          .map((group) => group.name)
          .filter(Boolean)
        setGroupNames([...new Set(names)])
      })
      .catch(() => undefined)
  }, [active])

  // applied 变化 → list + stat 并行;共用一个 seq,新查询令两路旧响应同时失效。
  useEffect(() => {
    if (applied == null) return
    if (typeof window.kunGui === 'undefined') return
    const gui = window.kunGui
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    const isStale = (): boolean => abortedRef.current || requestSeqRef.current !== seq
    setListPhase('loading')
    void (async () => {
      try {
        const page = await gui.claude360BillingLogs(applied)
        if (isStale()) return
        setPageData(page)
        setExpandedRows(new Set())
        setListError('')
        setListPhase('ready')
      } catch (e) {
        if (isStale()) return
        setListError(e instanceof Error ? e.message : String(e))
        setListPhase('error')
      }
    })()
    if (applied.requestId) {
      // 后端统计接口不支持 request_id 过滤:整区隐藏,避免统计与列表口径不一致。
      setStat(null)
      return
    }
    void (async () => {
      try {
        const next = await gui.claude360BillingLogsStat(applied)
        if (isStale()) return
        setStat(next)
      } catch {
        // 统计错误域独立:失败只隐藏统计区,不影响列表(design §6)。
        if (isStale()) return
        setStat(null)
      }
    })()
  }, [applied])

  // 列偏好即改即存(localStorage 不可用时 saveColumnPrefs 内部静默忽略)。
  useEffect(() => {
    saveColumnPrefs(columns)
  }, [columns])

  const updateDraft = useCallback((patch: Partial<LogsFilterDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  // 预设 chips:滑动窗口预设即时填充起止时间;custom 只标记,保留手输区间。
  const handlePreset = useCallback((key: LogsPresetKey) => {
    const range = presetRange(key, new Date())
    setDraft((prev) => ({ ...prev, preset: key, ...(range ?? {}) }))
  }, [])

  const handleSearch = useCallback(() => {
    // 查询总是回到第一页;每页条数沿用当前选择。
    setApplied(buildLogsQuery(draft, 1, pageSize))
  }, [draft, pageSize])

  const handleReset = useCallback(() => {
    // 重置 = 恢复默认草稿(今天/全部/无文本筛选)并立即查询第一页(prd R2)。
    const fresh = defaultLogsDraft(new Date())
    setDraft(fresh)
    setApplied(buildLogsQuery(fresh, 1, pageSize))
  }, [pageSize])

  const handleRetry = useCallback(() => {
    // 以同参数重发:换对象引用触发 applied effect。
    setApplied((prev) => (prev ? { ...prev } : prev))
  }, [])

  const goToPage = useCallback((page: number) => {
    setApplied((prev) => (prev ? { ...prev, page } : prev))
  }, [])

  const handlePageSizeChange = useCallback((value: string) => {
    const size = Number(value)
    if (!LOGS_PAGE_SIZES.some((option) => option === size)) return
    setPageSize(size)
    // 改每页条数回到第一页,避免落在超出新页数的页码上。
    setApplied((prev) => (prev ? { ...prev, page: 1, pageSize: size } : prev))
  }, [])

  const toggleColumn = useCallback((key: LogColumnKey) => {
    setColumns((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const toggleRow = useCallback((index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const copyText = useCallback(
    async (text: string) => {
      // spec(electron-browser-api-restrictions):文本剪贴板可直接用 navigator.clipboard。
      try {
        await navigator.clipboard.writeText(text)
        toast.success(t('myLogsCopySuccess'))
      } catch {
        toast.error(t('myLogsCopyError'))
      }
    },
    [t]
  )

  const handleCopyDetail = useCallback(
    (item: Claude360LogItem) => {
      // 整体复制:按详情区行序拼接可用字段(缺失项跳过),计费过程多行原样并入。
      const parts: string[] = []
      if (item.requestId) parts.push(`${t('myLogsColRequestId')}: ${item.requestId}`)
      const cacheSummary = formatCacheSummary(item, t)
      if (cacheSummary) parts.push(`${t('myLogsDetailCache')}: ${cacheSummary}`)
      if (item.content) parts.push(`${t('myLogsDetailContent')}: ${item.content}`)
      const billingLines = formatBillingProcess(item, billingLabelsFromT(t))
      if (billingLines.length > 0) parts.push(`${t('myLogsDetailBilling')}:\n${billingLines.join('\n')}`)
      if (item.reasoningEffort) parts.push(`${t('myLogsDetailReasoning')}: ${item.reasoningEffort}`)
      if (item.requestPath) parts.push(`${t('myLogsDetailPath')}: ${item.requestPath}`)
      void copyText(parts.join('\n'))
    },
    [copyText, t]
  )

  const typeOptions = useMemo<SelectOption[]>(
    () => [
      { value: '0', label: t('myLogsTypeAll') },
      { value: '1', label: t('myLogsTypeTopup') },
      { value: '2', label: t('myLogsTypeConsume') },
      { value: '3', label: t('myLogsTypeAdmin') },
      { value: '4', label: t('myLogsTypeSystem') },
      { value: '5', label: t('myLogsTypeError') },
      { value: '6', label: t('myLogsTypeRefund') }
    ],
    [t]
  )
  const tokenOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('myLogsTokenAll') },
      ...tokenNames.map((name) => ({ value: name, label: name }))
    ],
    [t, tokenNames]
  )
  const groupOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('myLogsGroupAll') },
      ...groupNames.map((name) => ({ value: name, label: name }))
    ],
    [t, groupNames]
  )
  const pageSizeOptions = useMemo<SelectOption[]>(
    () => LOGS_PAGE_SIZES.map((size) => ({ value: String(size), label: t('myLogsPerPageOption', { count: size }) })),
    [t]
  )

  const fieldLabelClass = 'mb-1 ml-0.5 block text-[11.5px] font-medium uppercase tracking-wide text-ds-faint'
  const items = pageData?.items ?? []
  const totalPages = applied ? pageCount(pageData?.total ?? 0, applied.pageSize) : 1
  const currentPage = pageData?.page ?? applied?.page ?? 1

  return (
    <Card>
      {/* 标题行 + 列设置 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
          <ScrollText className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden />
          {t('myLogsTitle')}
        </h2>
        <div>
          <Button
            variant="ghost"
            size="sm"
            ref={colsetBtnRef}
            aria-haspopup="menu"
            aria-expanded={colsetOpen}
            onClick={() => setColsetOpen((v) => !v)}
          >
            <ListFilter className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('myLogsColumns')}
          </Button>
          <Popover
            open={colsetOpen}
            anchorEl={colsetBtnRef.current}
            onClose={() => setColsetOpen(false)}
            placement="bottom-end"
            matchAnchorWidth={false}
            className="w-48"
          >
            <div className="p-1.5">
              <p className="px-2 pb-1 pt-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
                {t('myLogsColumnsTitle')}
              </p>
              {TOGGLEABLE_COLUMNS.map((col) => {
                const checked = columns[col.pref]
                return (
                  <button
                    key={col.pref}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggleColumn(col.pref)}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12.5px] text-ds-ink transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover"
                  >
                    <span
                      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded border ${
                        checked ? 'border-accent bg-accent text-white' : 'border-ds-border'
                      }`}
                    >
                      {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden /> : null}
                    </span>
                    {t(col.labelKey)}
                  </button>
                )
              })}
              <p className="px-2 pb-1 pt-1.5 text-[11px] leading-relaxed text-ds-faint">
                {t('myLogsColumnsFixedHint')}
              </p>
            </div>
          </Popover>
        </div>
      </div>

      {/* 时间预设 chips */}
      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {PRESET_CHIPS.map((chip) => {
          const on = chip.key === draft.preset
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={on}
              onClick={() => handlePreset(chip.key)}
              className={`rounded-[var(--radius-pill)] border px-3 py-1 text-[12px] transition-colors duration-[var(--motion-fast)] ${
                on
                  ? 'border-[color-mix(in_srgb,var(--ds-accent)_35%,transparent)] bg-accent-soft font-medium text-accent'
                  : 'border-ds-border bg-ds-subtle text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              {t(chip.labelKey)}
            </button>
          )
        })}
      </div>

      {/* 筛选网格(确认稿 12 栅格:3/3/3/3 + 3/3/2/4) */}
      <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-12">
        <div className="md:col-span-3">
          <label htmlFor={`${fieldIdPrefix}-start`} className={fieldLabelClass}>
            {t('myLogsStartTime')}
          </label>
          <Input
            id={`${fieldIdPrefix}-start`}
            type="datetime-local"
            value={timestampToDatetimeLocal(draft.startTimestamp)}
            onChange={(e) =>
              // 手改时间即切到自定义预设,避免 chips 展示与实际区间不一致。
              updateDraft({ startTimestamp: datetimeLocalToTimestamp(e.target.value), preset: 'custom' })
            }
          />
        </div>
        <div className="md:col-span-3">
          <label htmlFor={`${fieldIdPrefix}-end`} className={fieldLabelClass}>
            {t('myLogsEndTime')}
          </label>
          <Input
            id={`${fieldIdPrefix}-end`}
            type="datetime-local"
            value={timestampToDatetimeLocal(draft.endTimestamp)}
            onChange={(e) =>
              updateDraft({ endTimestamp: datetimeLocalToTimestamp(e.target.value), preset: 'custom' })
            }
          />
        </div>
        <div className="md:col-span-3">
          <span className={fieldLabelClass}>{t('myLogsType')}</span>
          <Select
            value={String(draft.type)}
            options={typeOptions}
            onChange={(value) => updateDraft({ type: Number(value) })}
            aria-label={t('myLogsType')}
          />
        </div>
        <div className="md:col-span-3">
          <span className={fieldLabelClass}>{t('myLogsToken')}</span>
          <Select
            value={draft.tokenName}
            options={tokenOptions}
            onChange={(value) => updateDraft({ tokenName: value })}
            aria-label={t('myLogsToken')}
          />
        </div>
        <div className="md:col-span-3">
          <span className={fieldLabelClass}>{t('myLogsGroup')}</span>
          <Select
            value={draft.group}
            options={groupOptions}
            onChange={(value) => updateDraft({ group: value })}
            aria-label={t('myLogsGroup')}
          />
        </div>
        <div className="md:col-span-3">
          <label htmlFor={`${fieldIdPrefix}-model`} className={fieldLabelClass}>
            {t('myLogsModel')}
          </label>
          <Input
            id={`${fieldIdPrefix}-model`}
            value={draft.modelName}
            onChange={(e) => updateDraft({ modelName: e.target.value })}
            placeholder={t('myLogsModelPlaceholder')}
          />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${fieldIdPrefix}-reqid`} className={fieldLabelClass}>
            {t('myLogsRequestId')}
          </label>
          <Input
            id={`${fieldIdPrefix}-reqid`}
            value={draft.requestId}
            onChange={(e) => updateDraft({ requestId: e.target.value })}
            placeholder={t('myLogsRequestIdPlaceholder')}
          />
        </div>
        <div className="flex items-end justify-end gap-2 sm:col-span-2 md:col-span-4">
          <Button variant="secondary" onClick={handleReset} data-testid="my-logs-reset">
            {t('myLogsReset')}
          </Button>
          <Button onClick={handleSearch} data-testid="my-logs-search">
            <Search className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {t('myLogsSearch')}
          </Button>
        </div>
      </div>

      {/* 范围统计(stat=null 或 requestId 有值时整区隐藏;内联判空以获得 TS 收窄) */}
      {stat != null && applied != null && !applied.requestId ? (
        <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LogsStatTile label={t('myLogsStatQuota')} value={formatStatQuota(stat.quotaCny)} accent />
          <LogsStatTile label={t('myLogsStatRpm')} value={formatStatRate(stat.rpm)} sub={t('myLogsStatRpmSub')} />
          <LogsStatTile label={t('myLogsStatTpm')} value={formatStatRate(stat.tpm)} sub={t('myLogsStatTpmSub')} />
        </div>
      ) : null}

      {/* 列表三态 + 表格 + 分页 */}
      {listPhase === 'loading' ? (
        <div className="mt-3.5">
          <LoadingState lines={6} label={t('myLogsLoading')} />
        </div>
      ) : listPhase === 'error' ? (
        <div className="mt-3.5">
          <ErrorState
            title={t('myLogsError')}
            description={listError}
            onRetry={handleRetry}
            retryLabel={t('myLogsRetry')}
          />
        </div>
      ) : listPhase === 'ready' ? (
        items.length === 0 ? (
          <div className="mt-3.5">
            <EmptyState
              icon={Search}
              title={t('myLogsEmptyTitle')}
              description={t('myLogsEmptyDesc')}
              action={
                <Button variant="secondary" size="sm" onClick={handleReset}>
                  {t('myLogsEmptyReset')}
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <MyLogsTable
              items={items}
              columns={columns}
              expandedRows={expandedRows}
              onToggleRow={toggleRow}
              onCopyDetail={handleCopyDetail}
              onCopyText={(text) => void copyText(text)}
              t={t}
            />
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 text-[12px] text-ds-faint">
              <span>
                {t('myLogsPagerSummary', {
                  total: (pageData?.total ?? 0).toLocaleString(),
                  page: currentPage,
                  pages: totalPages
                })}
              </span>
              <div className="flex items-center gap-1.5">
                <span>{t('myLogsPerPage')}</span>
                <div className="w-[104px]">
                  <Select
                    value={String(applied?.pageSize ?? pageSize)}
                    options={pageSizeOptions}
                    onChange={handlePageSizeChange}
                    aria-label={t('myLogsPerPage')}
                  />
                </div>
                <div className="ml-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => goToPage(currentPage - 1)}
                    aria-label={t('myLogsPrevPage')}
                    className={pagerButtonClass(false)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  </button>
                  {pagerItems(currentPage, totalPages).map((item, i) =>
                    item === 'ellipsis' ? (
                      <span key={`ellipsis-${i}`} className="px-0.5 text-ds-faint">
                        …
                      </span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => goToPage(item)}
                        aria-current={item === currentPage ? 'page' : undefined}
                        className={pagerButtonClass(item === currentPage)}
                      >
                        {item}
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    aria-label={t('myLogsNextPage')}
                    className={pagerButtonClass(false)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </>
        )
      ) : null}
    </Card>
  )
}

function pagerButtonClass(current: boolean): string {
  return `flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-sm)] border px-1.5 text-[12px] tabular-nums transition-colors duration-[var(--motion-fast)] disabled:cursor-default disabled:opacity-40 ${
    current
      ? 'border-[color-mix(in_srgb,var(--ds-accent)_35%,transparent)] bg-accent-soft font-semibold text-accent'
      : 'border-ds-border bg-ds-subtle text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  }`
}
