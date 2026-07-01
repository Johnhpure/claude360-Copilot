import type { ReactElement } from 'react'
import { BarChart3 } from 'lucide-react'
import type { Claude360TokenStat } from '@shared/claude360'

type Translate = (key: string, params?: Record<string, unknown>) => string

// Token 用量统计(claude360BillingTokenStats)。纯展示。
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
  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
        <BarChart3 className="h-4 w-4" strokeWidth={1.75} />
        {t('myUsage')}
      </h2>

      {stats.length === 0 ? (
        <p className="mt-4 text-[13px] text-ds-faint">{t('myNoUsage')}</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-ds-border">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-ds-main text-[11.5px] uppercase tracking-wide text-ds-faint">
              <tr>
                <th className="px-3 py-2 font-medium">{t('myUsageToken')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('myUsageRequests')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('myUsageTokens')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr key={row.tokenName} className="border-t border-ds-border-muted">
                  <td className="px-3 py-2 text-ds-ink">{row.tokenName}</td>
                  <td className="px-3 py-2 text-right text-ds-muted">{row.requestCount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-ds-muted">{row.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ds-border bg-ds-main text-[12.5px] font-medium text-ds-ink">
                <td className="px-3 py-2">{t('myUsageTotal')}</td>
                <td className="px-3 py-2 text-right">{totals.requests.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{totals.tokens.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
