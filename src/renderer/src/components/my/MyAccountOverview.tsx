import type { ReactElement } from 'react'
import { Wallet, Activity, AlertTriangle } from 'lucide-react'
import type { Claude360Me } from '@shared/claude360'
import { Button, Card } from '../ui'

type Translate = (key: string, params?: Record<string, unknown>) => string

// 账号 / 余额 / 今日用量概览。充值入口常驻(onTopup 打开充值弹窗),
// 低余额时额外展示警示条(其按钮同样触发 onTopup)。
// Calm Blue 换肤（父任务 07-03-oneui-redesign design §4.7）：账户卡 = focus block
// （ui/Card：16px 圆角、不透明 surface、无投影），头像/套餐胶囊 chip 保持单色克制,
// 强色（accent 图表）只出现在用量卡;充值主按钮为 ui/Button primary(accent 蓝)。
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
    return <Card className="text-[13px] text-ds-faint">{t('myLoading')}</Card>
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] border border-ds-border bg-ds-subtle text-[16px] font-semibold uppercase text-ds-ink"
          >
            {(me.displayName || me.username).slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-wide text-ds-faint">{t('myAccount')}</p>
            <p className="mt-1 truncate text-[16px] font-semibold text-ds-ink">
              {me.displayName || me.username}
            </p>
            <p className="truncate text-[12.5px] text-ds-muted">@{me.username}</p>
            {me.email ? <p className="truncate text-[12.5px] text-ds-faint">{me.email}</p> : null}
            {me.group ? (
              <span className="mt-2 inline-flex items-center rounded-[var(--radius-pill)] border border-ds-border bg-ds-subtle px-2.5 py-0.5 text-[11.5px] font-medium text-ds-muted">
                {t('myGroup')}: {me.group}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-ds-faint">
            <Wallet className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('myBalance')}
          </span>
          <span className="text-[20px] font-semibold text-ds-ink">{me.balanceDisplay || '—'}</span>
          <span className="text-[12px] text-ds-faint">
            {t('myUsedTotal')}: {me.usedDisplay || '—'}
          </span>
          {/* 常驻充值入口(R1):不再依赖 lowBalance 条件,首屏顶部即可见。 */}
          <Button size="sm" className="mt-1.5" data-testid="my-topup-open" onClick={onTopup}>
            {t('myTopupNow')}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          icon={<Activity className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          label={t('myTodayTokens')}
          value={me.todayTokens.toLocaleString()}
        />
        <StatTile
          icon={<Activity className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          label={t('myTodayRequests')}
          value={me.todayRequests.toLocaleString()}
        />
        <StatTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          label={t('myTodayUsage')}
          value={me.todayUsageDisplay || '—'}
        />
      </div>

      {me.lowBalance ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--ds-warning)_35%,transparent)] bg-ds-warning-soft px-4 py-3 text-[13px] text-ds-warning">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t('myLowBalance')}
          </span>
          <Button variant="secondary" size="sm" onClick={onTopup}>
            {t('myTopupNow')}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}

function StatTile({ icon, label, value }: { icon: ReactElement; label: string; value: string }): ReactElement {
  return (
    <div className="rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-main px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
        {icon}
        {label}
      </span>
      <p className="mt-1 text-[16px] font-semibold text-ds-ink">{value}</p>
    </div>
  )
}
