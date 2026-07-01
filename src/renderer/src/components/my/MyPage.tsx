import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import type {
  Claude360Me,
  Claude360TokenListItem,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder
} from '@shared/claude360'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { MyAccountOverview } from './MyAccountOverview'
import { MyBillingPanel, type BillingPollPhase } from './MyBillingPanel'
import { MyTokenGroupsTable } from './MyTokenGroupsTable'
import { MyUsagePanel } from './MyUsagePanel'
import { pollTopupOrderUntilComplete } from './my-page-actions'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onBack: () => void
}

// reveal 出的明文 Key 只在本地短暂驻留：60s 后自动清除，复制后立即清除，
// 刷新列表/离开页面时清空——避免明文长期留在 renderer 内存里（P1-3 安全硬化）。
const REVEAL_TTL_MS = 60_000

// 「我的」页容器:拥有数据加载与异步编排(创建 Key / 充值 / 订单轮询),
// 具体展示交给 my/ 下的纯子面板。所有 window.kunGui 调用都做存在性守卫。
export function MyPage({ leftSidebarCollapsed, onToggleLeftSidebar, onBack }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [me, setMe] = useState<Claude360Me | null>(null)
  const [tokens, setTokens] = useState<Claude360TokenListItem[]>([])
  const [usageStats, setUsageStats] = useState<Claude360TokenStat[]>([])
  const [revealed, setRevealed] = useState<Record<number, string>>({})

  const [topupOptions, setTopupOptions] = useState<Claude360TopupOptions | null>(null)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [order, setOrder] = useState<Claude360TopupOrder | null>(null)
  const [pollPhase, setPollPhase] = useState<BillingPollPhase>('idle')
  const [submittingTopup, setSubmittingTopup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 组件卸载后中断订单轮询,避免对已卸载组件 setState。
  const abortedRef = useRef(false)
  // 每个已 reveal tokenId 的 TTL 定时器,卸载/清除时统一清理。
  const revealTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  useEffect(() => {
    abortedRef.current = false
    return () => {
      abortedRef.current = true
      // 离开页面：清掉所有 TTL 定时器（明文 state 随组件卸载一并释放）。
      for (const timer of Object.values(revealTimersRef.current)) clearTimeout(timer)
      revealTimersRef.current = {}
    }
  }, [])

  // 清除单个 tokenId 的明文与其 TTL 定时器。
  const clearRevealed = useCallback((tokenId: number) => {
    const timer = revealTimersRef.current[tokenId]
    if (timer) {
      clearTimeout(timer)
      delete revealTimersRef.current[tokenId]
    }
    setRevealed((prev) => {
      if (!(tokenId in prev)) return prev
      const next = { ...prev }
      delete next[tokenId]
      return next
    })
  }, [])

  // 清空全部明文（刷新列表时调用，避免旧明文残留）。
  const clearAllRevealed = useCallback(() => {
    for (const timer of Object.values(revealTimersRef.current)) clearTimeout(timer)
    revealTimersRef.current = {}
    setRevealed({})
  }, [])

  const refreshMe = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    const next = await window.kunGui.claude360BillingMe()
    if (!abortedRef.current) setMe(next)
  }, [])

  const refreshTokens = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    const next = await window.kunGui.claude360TokensList()
    if (!abortedRef.current) setTokens(next)
  }, [])

  const loadAll = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    try {
      const [meResult, tokenResult, statsResult, optionsResult] = await Promise.all([
        window.kunGui.claude360BillingMe(),
        window.kunGui.claude360TokensList(),
        window.kunGui.claude360BillingTokenStats({}),
        window.kunGui.claude360BillingTopupOptions()
      ])
      if (abortedRef.current) return
      setMe(meResult)
      setTokens(tokenResult)
      // 列表刷新：清空旧的 reveal 明文，避免与新列表错配或长期驻留。
      clearAllRevealed()
      setUsageStats(statsResult)
      setTopupOptions(optionsResult)
      setSelectedAmount((prev) => prev ?? optionsResult.amountOptions[0] ?? null)
      setError(null)
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [clearAllRevealed])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleReveal = useCallback(async (tokenId: number) => {
    if (typeof window.kunGui === 'undefined') return
    try {
      const { key } = await window.kunGui.claude360TokensReveal({ tokenId })
      if (abortedRef.current) return
      setRevealed((prev) => ({ ...prev, [tokenId]: key }))
      // 启动/重置该 tokenId 的 TTL：到期自动清除明文。
      const existing = revealTimersRef.current[tokenId]
      if (existing) clearTimeout(existing)
      revealTimersRef.current[tokenId] = setTimeout(() => clearRevealed(tokenId), REVEAL_TTL_MS)
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [clearRevealed])

  const handleCopy = useCallback((tokenId: number, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value)
    }
    // 复制后立即清除该 Key 的明文，不等 TTL。
    clearRevealed(tokenId)
  }, [clearRevealed])

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

          <MyTokenGroupsTable
            tokens={tokens}
            revealed={revealed}
            onReveal={(tokenId) => void handleReveal(tokenId)}
            onCopy={handleCopy}
            t={t}
          />

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
