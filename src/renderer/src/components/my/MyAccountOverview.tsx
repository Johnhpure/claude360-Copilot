import type { ReactElement } from 'react'
import { Wallet, Activity, AlertTriangle } from 'lucide-react'
import type { Claude360Me } from '@shared/claude360'

type Translate = (key: string, params?: Record<string, unknown>) => string

// 账号 / 余额 / 今日用量概览。低余额时展示充值入口(onTopup)。
export function MyAccountOverview({
  me,
  onTopup,
  t
}: {
  me: Claude360Me | null
  onTopup: () => void
  t: Translate
}): ReactElement {
  if (!me) {
    return (
      <div className="rounded-2xl border border-ds-border bg-ds-card p-5 text-[13px] text-ds-faint shadow-sm">
        {t('myLoading')}
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-ds-faint">{t('myAccount')}</p>
          <p className="mt-1 truncate text-[16px] font-semibold text-ds-ink">
            {me.displayName || me.username}
          </p>
          <p className="truncate text-[12.5px] text-ds-muted">@{me.username}</p>
          {me.email ? <p className="truncate text-[12.5px] text-ds-faint">{me.email}</p> : null}
          {me.group ? (
            <span className="mt-2 inline-flex items-center rounded-full border border-ds-border bg-ds-main px-2.5 py-0.5 text-[11.5px] font-medium text-ds-muted">
              {t('myGroup')}: {me.group}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-ds-faint">
            <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('myBalance')}
          </span>
          <span className="text-[20px] font-semibold text-ds-ink">{me.balanceDisplay || '—'}</span>
          <span className="text-[12px] text-ds-faint">
            {t('myUsedTotal')}: {me.usedDisplay || '—'}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
          label={t('myTodayTokens')}
          value={me.todayTokens.toLocaleString()}
        />
        <StatTile
          icon={<Activity className="h-4 w-4" strokeWidth={1.75} />}
          label={t('myTodayRequests')}
          value={me.todayRequests.toLocaleString()}
        />
        <StatTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label={t('myTodayUsage')}
          value={me.todayUsageDisplay || '—'}
        />
      </div>

      {me.lowBalance ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
            {t('myLowBalance')}
          </span>
          <button
            type="button"
            onClick={onTopup}
            className="rounded-lg border border-amber-400 bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-amber-700 shadow-sm transition hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-500/10"
          >
            {t('myTopupNow')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function StatTile({ icon, label, value }: { icon: ReactElement; label: string; value: string }): ReactElement {
  return (
    <div className="rounded-xl border border-ds-border bg-ds-main px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
        {icon}
        {label}
      </span>
      <p className="mt-1 text-[16px] font-semibold text-ds-ink">{value}</p>
    </div>
  )
}
