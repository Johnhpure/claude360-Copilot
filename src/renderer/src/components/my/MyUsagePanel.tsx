import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3 } from 'lucide-react'
import type { Claude360TokenStat } from '@shared/claude360'
import { Button, Card, Input } from '../ui'
import { buildUsageView, type UsageSortKey } from './my-page-actions'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** 默认展示行数(R2.5):超出走「展开更多」,不做分页,分组再多页面也不无限拉长。 */
const USAGE_ROW_LIMIT = 10
const CNY_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

// Token 用量统计(claude360BillingTokenStats):总览行 + 紧凑表格
// (07-07-my-page-redesign-topup-modal design §5)。
// 视图数据全部来自 buildUsageView 纯函数;组件只持有 query/排序/展开四个本地 UI 态。
// Calm Blue:本卡仍是「我的」页唯一强色区域——占比列的 accent 迷你条形 + 蓝色百分比。
export function MyUsagePanel({
  stats,
  t
}: {
  stats: Claude360TokenStat[]
  t: Translate
}): ReactElement {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<UsageSortKey>('tokens')
  const [sortDesc, setSortDesc] = useState(true)
  const [expanded, setExpanded] = useState(false)

  // memo:视图整形含两次排序,父组件(轮询/余额刷新)re-render 时避免无谓重算。
  const view = useMemo(
    () =>
      buildUsageView(stats, {
        query,
        sortKey,
        sortDesc,
        limit: expanded ? null : USAGE_ROW_LIMIT
      }),
    [stats, query, sortKey, sortDesc, expanded]
  )

  // 点击当前排序列翻转方向;切换排序列时回到默认降序。
  const handleSort = (key: UsageSortKey): void => {
    if (sortKey === key) {
      setSortDesc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
          <BarChart3 className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden />
          {t('myUsage')}
        </h2>
        {stats.length > 0 ? (
          /* Input 内置 w-full,用外层容器限宽(直接加 w-48 会与 w-full 竞争,胜负取决于样式表顺序)。 */
          <div className="w-48">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('myUsageSearchPlaceholder')}
              aria-label={t('myUsageSearchPlaceholder')}
            />
          </div>
        ) : null}
      </div>

      {stats.length === 0 ? (
        <p className="mt-4 text-[13px] text-ds-faint">{t('myNoUsage')}</p>
      ) : (
        <>
          {/* 总览行:基于全量 stats,不受搜索过滤影响(design §5.1)。 */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <UsageStatTile label={t('myUsageTotalRequests')} value={view.totals.requests.toLocaleString()} />
            <UsageStatTile
              label={t('myUsageTotalTokens')}
              value={view.totals.tokens.toLocaleString()}
              accent
            />
            <div className="rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-main px-3.5 py-3">
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
                {t('myUsageTop3')}
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {view.top3.map((item) => (
                  <span
                    key={item.tokenName}
                    className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-pill)] border border-ds-border bg-ds-subtle px-2 py-0.5 text-[11.5px] text-ds-muted"
                  >
                    <span className="truncate font-medium text-ds-ink">{item.tokenName}</span>
                    <span className="shrink-0 tabular-nums">{item.sharePct}%</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {view.rows.length === 0 ? (
            <p className="mt-4 text-[13px] text-ds-faint">{t('myNoUsage')}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-ds-border text-[11.5px] uppercase tracking-wide text-ds-faint">
                    <th scope="col" className="min-w-[220px] py-2 pr-4 text-left font-medium">
                      {t('myUsageGroupName')}
                    </th>
                    <SortableHeader
                      label={t('myUsageRequests')}
                      active={sortKey === 'requests'}
                      desc={sortDesc}
                      onClick={() => handleSort('requests')}
                      className="w-[100px]"
                    />
                    <SortableHeader
                      label={t('myUsageTokens')}
                      active={sortKey === 'tokens'}
                      desc={sortDesc}
                      onClick={() => handleSort('tokens')}
                      className="w-[160px]"
                    />
                    <SortableHeader
                      label={t('myUsageCost')}
                      active={sortKey === 'cost'}
                      desc={sortDesc}
                      onClick={() => handleSort('cost')}
                      className="w-[110px]"
                    />
                    <th scope="col" className="w-[140px] py-2 pl-6 text-right font-medium">
                      {t('myUsageShare')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => {
                    const cost = formatUsageCost(row.costCny)
                    return (
                      <tr key={row.tokenName} className="border-b border-ds-border-muted last:border-0">
                        <td className="w-full max-w-0 truncate py-1.5 pr-4 font-medium text-ds-ink">
                          {row.tokenName}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pl-6 text-right tabular-nums text-ds-muted">
                          {row.requestCount.toLocaleString()}
                        </td>
                        <td
                          className="whitespace-nowrap py-1.5 pl-6 text-right tabular-nums text-ds-muted"
                          title={row.totalTokens.toLocaleString()}
                        >
                          {row.totalTokens.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pl-6 text-right tabular-nums text-ds-muted">
                          {cost}
                        </td>
                        <td className="py-1.5 pl-6 text-right tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-[var(--radius-pill)] bg-ds-subtle">
                              <div
                                className="h-full rounded-[var(--radius-pill)] bg-accent"
                                style={{ width: `${row.sharePct}%` }}
                              />
                            </div>
                            <span className="w-9 shrink-0 text-right text-[11.5px] font-medium tabular-nums text-accent">
                              {row.sharePct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {view.hiddenCount > 0 ? (
            <div className="mt-3 flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} data-testid="my-usage-show-more">
                {t('myUsageShowMore', { count: view.hiddenCount })}
              </Button>
            </div>
          ) : null}
          {expanded && view.rows.length > USAGE_ROW_LIMIT ? (
            <div className="mt-3 flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} data-testid="my-usage-show-less">
                {t('myUsageShowLess')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}

function formatUsageCost(costCny: number | null): string {
  if (typeof costCny !== 'number' || !Number.isFinite(costCny)) return '-'
  return `¥${CNY_FORMATTER.format(costCny)}`
}

function UsageStatTile({
  label,
  value,
  accent = false
}: {
  label: string
  value: string
  accent?: boolean
}): ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-main px-3.5 py-3">
      <span className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">{label}</span>
      <p className={`mt-1 text-[16px] font-semibold tabular-nums ${accent ? 'text-accent' : 'text-ds-ink'}`}>
        {value}
      </p>
    </div>
  )
}

/** 可排序表头:点击切换排序,aria-sort 标注当前方向(design §5.2)。
 *  className 仅用于列宽(07-08 布局优化:表头与数据列同套宽度/对齐/内边距)。 */
function SortableHeader({
  label,
  active,
  desc,
  onClick,
  className = ''
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
}): ReactElement {
  return (
    <th
      scope="col"
      aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
      className={`py-2 pl-6 text-right font-medium ${className}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors duration-[var(--motion-fast)] hover:text-ds-ink ${
          active ? 'text-ds-ink' : 'text-ds-faint'
        }`}
      >
        {label}
        {active ? (
          desc ? (
            <ArrowDown className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          ) : (
            <ArrowUp className="h-3 w-3" strokeWidth={1.75} aria-hidden />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </th>
  )
}
