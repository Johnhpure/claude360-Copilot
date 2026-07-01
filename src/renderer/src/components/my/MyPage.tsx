import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type {
  Claude360Me,
  Claude360TokenListItem,
  Claude360TokenStat,
  Claude360TopupOptions,
  Claude360TopupOrder
} from '@shared/claude360'
import type { Claude360ModelCache } from '@shared/app-settings-claude360'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { MyAccountOverview } from './MyAccountOverview'
import { MyBillingPanel, type BillingPollPhase } from './MyBillingPanel'
import { MyTokenGroupsTable } from './MyTokenGroupsTable'
import { MyModelGroupsTable } from './MyModelGroupsTable'
import { MyUsagePanel } from './MyUsagePanel'
import { createTokenAndRefresh, pollTopupOrderUntilComplete } from './my-page-actions'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onBack: () => void
}

// 「我的」页容器:拥有数据加载与异步编排(创建 Key / 充值 / 订单轮询),
// 具体展示交给 my/ 下的纯子面板。所有 window.kunGui 调用都做存在性守卫。
export function MyPage({ leftSidebarCollapsed, onToggleLeftSidebar, onBack }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [me, setMe] = useState<Claude360Me | null>(null)
  const [tokens, setTokens] = useState<Claude360TokenListItem[]>([])
  const [modelCache, setModelCache] = useState<Claude360ModelCache | null>(null)
  const [usageStats, setUsageStats] = useState<Claude360TokenStat[]>([])
  const [revealed, setRevealed] = useState<Record<number, string>>({})
  const [creatingKey, setCreatingKey] = useState(false)
  const [refreshingModels, setRefreshingModels] = useState(false)

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

  const refreshTokens = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    const next = await window.kunGui.claude360TokensList()
    if (!abortedRef.current) setTokens(next)
  }, [])

  const loadAll = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    try {
      const [meResult, tokenResult, modelResult, statsResult, optionsResult] = await Promise.all([
        window.kunGui.claude360BillingMe(),
        window.kunGui.claude360TokensList(),
        window.kunGui.claude360ModelsList(),
        window.kunGui.claude360BillingTokenStats({}),
        window.kunGui.claude360BillingTopupOptions()
      ])
      if (abortedRef.current) return
      setMe(meResult)
      setTokens(tokenResult)
      setModelCache(modelResult)
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

  const handleRefreshModels = useCallback(async () => {
    if (typeof window.kunGui === 'undefined' || refreshingModels) return
    setRefreshingModels(true)
    try {
      const result = await window.kunGui.claude360ModelsRefresh()
      if (!abortedRef.current) setModelCache(result.modelCache)
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!abortedRef.current) setRefreshingModels(false)
    }
  }, [refreshingModels])

  const handleCreateKey = useCallback(async () => {
    if (typeof window.kunGui === 'undefined' || creatingKey) return
    setCreatingKey(true)
    // Key 名称用固定非本地化前缀,避免把界面语言写进后端持久数据(与 token-service 命名对齐)。
    const name = `Claude360 Copilot-${Date.now()}`
    const result = await createTokenAndRefresh(window.kunGui, { name })
    if (abortedRef.current) return
    if (result.ok) {
      setTokens(result.tokens)
      setError(null)
    } else {
      setError(result.message)
    }
    setCreatingKey(false)
  }, [creatingKey])

  const handleReveal = useCallback(async (tokenId: number) => {
    if (typeof window.kunGui === 'undefined') return
    try {
      const { key } = await window.kunGui.claude360TokensReveal({ tokenId })
      if (!abortedRef.current) setRevealed((prev) => ({ ...prev, [tokenId]: key }))
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleCopy = useCallback((value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value)
    }
  }, [])

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
                onClick={() => void handleRefreshModels()}
                disabled={refreshingModels}
                className="ds-no-drag flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshingModels ? 'animate-spin' : ''}`}
                  strokeWidth={1.75}
                />
                {t('myRefreshModels')}
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

          <MyTokenGroupsTable
            tokens={tokens}
            revealed={revealed}
            creating={creatingKey}
            onReveal={(tokenId) => void handleReveal(tokenId)}
            onCopy={handleCopy}
            onCreate={() => void handleCreateKey()}
            t={t}
          />

          <MyModelGroupsTable modelCache={modelCache} t={t} />

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
