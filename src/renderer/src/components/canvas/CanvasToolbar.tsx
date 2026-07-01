import type { ReactElement } from 'react'
import { AlertTriangle, Wallet } from 'lucide-react'
import type { CanvasAccess } from '../../canvas/canvas-workbench-actions'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  access: CanvasAccess | null
  /** 余额是否偏低（来自 claude360BillingMe().lowBalance）。 */
  lowBalance: boolean
  onOpenMy: () => void
  t: TFn
}

// 工作台工具条（纯展示）：
// - 无 image Key / 未登录 → 「去我的页修复」；
// - 低余额 → 「去充值」入口（同样落到「我的」页）。
// access 为 null（探测中）时不渲染修复条。
export function CanvasToolbar({ access, lowBalance, onOpenMy, t }: Props): ReactElement | null {
  const showFix = access !== null && !(access.loggedIn && access.hasImageGroup)
  const showLowBalance = !showFix && lowBalance
  if (!showFix && !showLowBalance) return null

  if (showFix) {
    const message = !access!.loggedIn ? t('canvasNeedsLogin') : t('canvasNeedsGroup')
    return (
      <div
        data-testid="canvas-fix-banner"
        className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
          {message}
        </span>
        <button
          type="button"
          onClick={onOpenMy}
          className="shrink-0 rounded-lg border border-amber-400 bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-amber-700 shadow-sm transition hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-500/10"
        >
          {t('canvasGoToMy')}
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="canvas-lowbalance-banner"
      className="flex items-center justify-between gap-3 rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-[13px] text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200"
    >
      <span className="flex items-center gap-2">
        <Wallet className="h-4 w-4" strokeWidth={1.75} />
        {t('canvasLowBalance')}
      </span>
      <button
        type="button"
        onClick={onOpenMy}
        className="shrink-0 rounded-lg border border-sky-400 bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-sky-800 shadow-sm transition hover:bg-ds-hover dark:text-sky-200"
      >
        {t('canvasTopup')}
      </button>
    </div>
  )
}
