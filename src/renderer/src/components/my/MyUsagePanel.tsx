import type { ReactElement } from 'react'
import { BarChart3 } from 'lucide-react'
import type { Claude360TokenStat } from '@shared/claude360'
import { Card } from '../ui'

type Translate = (key: string, params?: Record<string, unknown>) => string

// Token 用量统计(claude360BillingTokenStats)。纯展示。
// Calm Blue 换肤（父任务 07-03-oneui-redesign design §4.7）：本卡是「我的」页
// **唯一强色区域**——每个 Key 的用量占比用 accent 蓝色条形表达（纯 CSS div 条,
// 决策 D3：不引图表库）；条宽为该 Key tokens 相对最大值的比例，右侧百分比为占总量份额。
export function MyUsagePanel({
  stats,
  t
}: {
  stats: Claude360TokenStat[]
  t: Translate
}): ReactElement {
  const totals = stats.reduce(
    (acc, row) => {
      acc.requests += row.requestCount
      acc.tokens += row.totalTokens
      return acc
    },
    { requests: 0, tokens: 0 }
  )
  const maxTokens = stats.reduce((max, row) => Math.max(max, row.totalTokens), 0)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
          <BarChart3 className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden />
          {t('myUsage')}
        </h2>
        {stats.length > 0 ? (
          <span className="text-[12px] tabular-nums text-ds-faint">
            {t('myUsageTotal')}: {t('myUsageRequests')} {totals.requests.toLocaleString()} ·{' '}
            {t('myUsageTokens')} <span className="font-semibold text-accent">{totals.tokens.toLocaleString()}</span>
          </span>
        ) : null}
      </div>

      {stats.length === 0 ? (
        <p className="mt-4 text-[13px] text-ds-faint">{t('myNoUsage')}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3.5">
          {stats.map((row) => {
            // 条宽相对最大用量归一(最短保留 2% 可见)；百分比为占总 tokens 份额。
            const widthPct = maxTokens > 0 ? Math.max((row.totalTokens / maxTokens) * 100, 2) : 0
            const sharePct = totals.tokens > 0 ? Math.round((row.totalTokens / totals.tokens) * 100) : 0
            return (
              <li key={row.tokenName}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate font-medium text-ds-ink">{row.tokenName}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ds-muted">
                    {t('myUsageRequests')} {row.requestCount.toLocaleString()} · {t('myUsageTokens')}{' '}
                    {row.totalTokens.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-ds-subtle">
                    <div
                      className="h-full rounded-[var(--radius-pill)] bg-accent"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[11.5px] font-medium tabular-nums text-accent">
                    {sharePct}%
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
