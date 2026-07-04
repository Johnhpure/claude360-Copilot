import type { ReactElement } from 'react'
import { Wallet } from 'lucide-react'
import { Button } from '../ui'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  /** 余额是否偏低（来自 claude360BillingMe().lowBalance）。 */
  lowBalance: boolean
  onOpenMy: () => void
  t: TFn
}

// 工作台工具条（纯展示）：低余额 → 「去充值」入口（落到「我的」页的充值面板）。
// 分组模式下不再做「缺 image 分组 Key」的初始化报错；Key 在点生成时按所选分组检测/创建。
// 视觉走 warning 功能色 token（色相恒定、明度随主题，Calm Blue 原则 7）。
export function CanvasToolbar({ lowBalance, onOpenMy, t }: Props): ReactElement | null {
  if (!lowBalance) return null

  return (
    <div
      data-testid="canvas-lowbalance-banner"
      className="flex items-center justify-between gap-3 rounded-xl border border-ds-warning bg-ds-warning-soft px-4 py-3 text-[13px] text-ds-warning"
    >
      <span className="flex items-center gap-2">
        <Wallet className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t('canvasLowBalance')}
      </span>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={onOpenMy}>
        {t('canvasTopup')}
      </Button>
    </div>
  )
}
