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
import { Button } from '../ui'
import { MyAccountOverview } from './MyAccountOverview'
import { MyLogsPanel } from './MyLogsPanel'
import { MySegTabs } from './MySegTabs'
import { MyTopupModal } from './MyTopupModal'
import { MyUsagePanel } from './MyUsagePanel'
import { pollTopupOrderUntilComplete, type BillingPollPhase } from './my-page-actions'

/** 账户卡下方的分段 Tab(07-17 my-newapi-call-logs,方案 B)。 */
export type MyPageTab = 'usage' | 'logs'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onBack: () => void
  /** 退出登录（清账号态并回登录框）。由容器注入，MyPage 只负责触发。 */
  onLogout: () => void
  /** 初始激活 Tab,默认「用量统计」(首屏与改造前一致);测试/深链可指定。 */
  initialTab?: MyPageTab
}

// 「我的」页容器:账号 / 余额 / 今日用量概览 + 充值弹窗 + 退出登录。
// API Key 的分组管理已归口到「设置 → 分组及 Key」，本页不再展示 Key 分组表。
// 所有 window.kunGui 调用都做存在性守卫。
// 布局（07-17 my-newapi-call-logs design §5.1，方案 B）:
// 账户卡常驻 → [用量统计 | 调用日志] 分段 Tab;两个面板常挂载、非激活者 hidden
// （display:none）——切 Tab 不丢筛选/结果/滚动,也不重发请求;充值全流程仍在 MyTopupModal。
export function MyPage({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onBack,
  onLogout,
  initialTab = 'usage'
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [activeTab, setActiveTab] = useState<MyPageTab>(initialTab)
  const [me, setMe] = useState<Claude360Me | null>(null)
  const [usageStats, setUsageStats] = useState<Claude360TokenStat[]>([])

  const [topupOptions, setTopupOptions] = useState<Claude360TopupOptions | null>(null)
  const [topupOpen, setTopupOpen] = useState(false)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [order, setOrder] = useState<Claude360TopupOrder | null>(null)
  const [pollPhase, setPollPhase] = useState<BillingPollPhase>('idle')
  const [submittingTopup, setSubmittingTopup] = useState(false)
  // 全页 error 只承载加载类错误;充值过程错误走 topupError 在弹窗内展示,互不渗漏。
  const [error, setError] = useState<string | null>(null)
  const [topupError, setTopupError] = useState<string | null>(null)

  // 组件卸载后中断订单轮询,避免对已卸载组件 setState。
  const abortedRef = useRef(false)
  useEffect(() => {
    abortedRef.current = false
    return () => {
      abortedRef.current = true
    }
  }, [])

  // per-order 中止标记(会话语义,与卸载语义的 abortedRef 分离):
  // 关闭弹窗 / 重新生成时自增,使 in-flight 轮询的 shouldAbort 变真,
  // 且不会误伤之后新订单的轮询(新订单持有更新的 seq)。
  const orderSeqRef = useRef(0)

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
    const seq = orderSeqRef.current + 1
    orderSeqRef.current = seq
    const isStale = (): boolean => abortedRef.current || orderSeqRef.current !== seq
    setSubmittingTopup(true)
    setTopupError(null)
    let created: Claude360TopupOrder
    try {
      created = await window.kunGui.claude360BillingTopupWechat({ amount: selectedAmount })
      // 排障锚点:控制台可直接核对订单接口返回与解析出的二维码数据(orderId/codeUrl/moneyDisplay)。
      console.info('[topup] order created', created)
    } catch (e) {
      if (!abortedRef.current) {
        setTopupError(e instanceof Error ? e.message : String(e))
        setPollPhase('idle')
        setSubmittingTopup(false)
      }
      return
    }
    if (abortedRef.current) return
    // 订单已创建,提交态立即复位:等待支付期间弹窗保持可关闭(dismissable)。
    setSubmittingTopup(false)
    if (orderSeqRef.current !== seq) return
    setOrder(created)
    setPollPhase('pending')
    const result = await pollTopupOrderUntilComplete(window.kunGui, created.orderId, {
      shouldAbort: isStale
    })
    if (isStale()) return
    if (result.ok && result.completed) {
      setPollPhase('completed')
      // 订单完成后刷新余额,让「我的」页余额即时反映充值结果。
      await refreshMe()
    } else if (result.ok) {
      // reason → pollPhase 映射(design §2.3):超时与过期同展示「已超时」;aborted 静默(弹窗已关)。
      if (result.reason === 'failed') {
        setPollPhase('failed')
      } else if (result.reason === 'expired' || result.reason === 'timeout') {
        setPollPhase('expired')
      }
    } else {
      // 轮询请求本身失败(网络/登录态):回金额选择视图并在弹窗内报错。
      setTopupError(result.message)
      setOrder(null)
      setPollPhase('idle')
    }
  }, [selectedAmount, submittingTopup, refreshMe])

  const handleOpenTopup = useCallback(() => {
    setTopupOpen(true)
  }, [])

  // 关闭弹窗 = 放弃当前支付会话:中止在途轮询并整体复位,下次打开回金额选择视图。
  const handleCloseTopup = useCallback(() => {
    orderSeqRef.current += 1
    setTopupOpen(false)
    setOrder(null)
    setPollPhase('idle')
    setTopupError(null)
  }, [])

  // 失败/超时后重新生成:仅复位订单态回金额选择视图(金额保留),由用户再点「微信充值」。
  const handleRegenerateTopup = useCallback(() => {
    orderSeqRef.current += 1
    setOrder(null)
    setPollPhase('idle')
    setTopupError(null)
  }, [])

  const headerInset = useMemo(
    () => (leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''),
    [leftSidebarCollapsed]
  )

  const segTabs = useMemo(
    () => [
      { key: 'usage' as const, label: t('myTabUsage') },
      { key: 'logs' as const, label: t('myTabLogs') }
    ],
    [t]
  )

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[var(--radius-2xl)]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div className={`flex min-w-0 items-center gap-2.5 ${headerInset}`}>
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <Button
                variant="secondary"
                size="sm"
                className="ds-no-drag"
                onClick={onBack}
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('myBackToWorkbench')}
              </Button>
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">{t('myPage')}</h1>
              <Button
                variant="secondary"
                size="sm"
                data-testid="my-logout"
                className="ds-no-drag shrink-0 hover:text-ds-danger"
                onClick={onLogout}
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('myLogout')}
              </Button>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4">
          {error ? (
            <p className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft px-4 py-3 text-[13px] text-ds-danger">
              {error}
            </p>
          ) : null}

          <MyAccountOverview me={me} onTopup={handleOpenTopup} t={t} />

          {/* 方案 B:用量卡整体移入「用量统计」Tab(行为不变);两面板常挂载,
              hidden 切换保住调用日志的筛选/结果态,MyLogsPanel 由 active 懒发首查。 */}
          <MySegTabs tabs={segTabs} active={activeTab} onChange={setActiveTab} ariaLabel={t('myTabsAria')} />

          <div data-testid="my-tab-panel-usage" hidden={activeTab !== 'usage'}>
            <MyUsagePanel stats={usageStats} t={t} />
          </div>
        </div>
        {/* 调用日志面板移出 960 共享容器,单独放宽到 1400(账号卡/用量面板不受影响);
            mt-4 承接原 gap-4 的垂直节奏,hidden 切换与 active 懒查询逻辑保持不变。 */}
        <div
          data-testid="my-tab-panel-logs"
          hidden={activeTab !== 'logs'}
          className="mx-auto mt-4 w-full max-w-[1400px]"
        >
          <MyLogsPanel active={activeTab === 'logs'} t={t} />
        </div>
      </main>

      <MyTopupModal
        open={topupOpen}
        options={topupOptions}
        selectedAmount={selectedAmount}
        order={order}
        pollPhase={pollPhase}
        submitting={submittingTopup}
        error={topupError}
        onSelectAmount={setSelectedAmount}
        onCreateWechatTopup={() => void handleCreateWechatTopup()}
        onRegenerate={handleRegenerateTopup}
        onClose={handleCloseTopup}
        t={t}
      />
    </div>
  )
}
