import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, LogOut } from 'lucide-react'
import type {
  Claude360Me,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder
} from '@shared/claude360'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { MyAccountOverview } from './MyAccountOverview'
import { MyBillingPanel, type BillingPollPhase } from './MyBillingPanel'
import { MyUsagePanel } from './MyUsagePanel'
import { pollTopupOrderUntilComplete } from './my-page-actions'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onBack: () => void
  /** 退出登录（清账号态并回登录框）。由容器注入，MyPage 只负责触发。 */
  onLogout: () => void
}

// 「我的」页容器:账号 / 余额 / 今日用量概览 + 充值 + 退出登录。
// API Key 的分组管理已归口到「设置 → 分组及 Key」，本页不再展示 Key 分组表。
// 所有 window.kunGui 调用都做存在性守卫。
export function MyPage({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onBack,
  onLogout
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [me, setMe] = useState<Claude360Me | null>(null)
  const [usageStats, setUsageStats] = useState<Claude360TokenStat[]>([])

  const [topupOptions, setTopupOptions] = useState<Claude360TopupOptions | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [order, setOrder] = useState<Claude360TopupOrder | null>(null)
  const [pollPhase, setPollPhase] = useState<BillingPollPhase>('idle')
  const [submittingTopup, setSubmittingTopup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 组件卸载后中断订单轮询,避免对已卸载组件 setState。
  const abortedRef = useRef(false)
  useEffect(() => {
    abortedRef.current = false
    return () => {
      abortedRef.current = true
    }
  }, [])

  const refreshMe = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    const next = await window.kunGui.claude360BillingMe()
    if (!abortedRef.current) setMe(next)
  }, [])

  const loadAll = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    try {
      const [meResult, statsResult, optionsResult] = await Promise.all([
        window.kunGui.claude360BillingMe(),
        window.kunGui.claude360BillingTokenStats({}),
        window.kunGui.claude360BillingTopupOptions()
      ])
      if (abortedRef.current) return
      setMe(meResult)
      setUsageStats(statsResult)
      setTopupOptions(optionsResult)
      setSelectedAmount((prev) => prev ?? optionsResult.amountOptions[0] ?? null)
      setError(null)
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleCreateWechatTopup = useCallback(async () => {
    if (typeof window.kunGui === 'undefined' || submittingTopup || selectedAmount == null) return
    setSubmittingTopup(true)
    try {
      const created = await window.kunGui.claude360BillingTopupWechat({ amount: selectedAmount })
      if (abortedRef.current) return
      setOrder(created)
      setPollPhase('pending')
      const result = await pollTopupOrderUntilComplete(window.kunGui, created.orderId, {
        shouldAbort: () => abortedRef.current
      })
      if (abortedRef.current) return
      if (result.ok && result.completed) {
        setPollPhase('completed')
        // 订单完成后刷新余额,让「我的」页余额即时反映充值结果。
        await refreshMe()
      } else if (result.ok && !result.completed) {
        // 轮询跑满上限仍未完成:复位为可重试态并提示超时,避免二维码永久停在「等待支付」。
        setPollPhase('idle')
        setError(t('myTopupTimeout'))
      } else if (!result.ok) {
        setError(result.message)
        setPollPhase('idle')
      }
    } catch (e) {
      if (!abortedRef.current) {
        setError(e instanceof Error ? e.message : String(e))
        setPollPhase('idle')
      }
    } finally {
      if (!abortedRef.current) setSubmittingTopup(false)
    }
  }, [selectedAmount, submittingTopup, refreshMe, t])

  const scrollToBilling = useCallback(() => {
    if (typeof document === 'undefined') return
    document.getElementById('my-billing-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const headerInset = useMemo(
    () => (leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''),
    [leftSidebarCollapsed]
  )

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div className={`flex min-w-0 items-center gap-2.5 ${headerInset}`}>
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <button
                type="button"
                onClick={onBack}
                className="ds-no-drag flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('myBackToWorkbench')}
              </button>
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">{t('myPage')}</h1>
              <button
                type="button"
                data-testid="my-logout"
                onClick={onLogout}
                className="ds-no-drag flex shrink-0 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-500/40 dark:hover:bg-red-950/30 dark:hover:text-red-300"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('myLogout')}
              </button>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5">
          {error ? (
            <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <MyAccountOverview me={me} onTopup={scrollToBilling} t={t} />

          <div id="my-billing-panel">
            <MyBillingPanel
              options={topupOptions}
              selectedAmount={selectedAmount}
              order={order}
              pollPhase={pollPhase}
              submitting={submittingTopup}
              onSelectAmount={setSelectedAmount}
              onCreateWechatTopup={() => void handleCreateWechatTopup()}
              t={t}
            />
          </div>

          <MyUsagePanel stats={usageStats} t={t} />
        </div>
      </main>
    </div>
  )
}
