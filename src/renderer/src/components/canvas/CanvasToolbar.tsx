import type { ReactElement } from 'react'
import { Wallet } from 'lucide-react'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  /** 余额是否偏低（来自 claude360BillingMe().lowBalance）。 */
  lowBalance: boolean
  onOpenMy: () => void
  t: TFn
}

// 工作台工具条（纯展示）：低余额 → 「去充值」入口（落到「我的」页的充值面板）。
// 分组模式下不再做「缺 image 分组 Key」的初始化报错；Key 在点生成时按所选分组检测/创建。
export function CanvasToolbar({ lowBalance, onOpenMy, t }: Props): ReactElement | null {
  if (!lowBalance) return null

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
