import type { ReactElement, ReactNode } from 'react'
import { Button, Card } from '../ui'

/**
 * 生成任务卡（Feature，父任务 07-03-oneui-redesign design §4.8 / 阶段4 design §2.1）。
 *
 * 全局生成任务的统一表达，chat / canvas / music 三工作台共用：
 *   左侧状态环（蓝=进行中呼吸、绿=成功、红=失败）+ 标题 + 进度线。
 *
 * 约束：
 *   - 纯展示组件，不订阅任何 store——各工作台自行 select 后以 props 注入。
 *   - 进行中呼吸是全应用唯一持续动效；keyframes 复用
 *     ui-primitives.css 的 ds-ui-breathe / ds-ui-progress-sweep（与 ImageCard 共用）。
 *   - 颜色/圆角/动效一律走 token（accent / ds-success / ds-danger / --motion-*）。
 */
export type TaskCardStatus = 'running' | 'success' | 'error'

type TaskCardProps = {
  status: TaskCardStatus
  title: string
  /** 0-1；undefined = 不确定进度（进度线呼吸扫动） */
  progress?: number
  /** 右侧附注（耗时/模型名等） */
  meta?: ReactNode
  /** running 态显示取消按钮 */
  onCancel?: () => void
  /** error 态显示重试按钮 */
  onRetry?: () => void
  /** 展开区（缩略图/错误信息等） */
  children?: ReactNode
}

/** 状态环配色：running=accent 呼吸 / success=绿 / error=红（色相恒定，token 按主题调明度） */
const ringClass: Record<TaskCardStatus, string> = {
  running: 'border-accent ds-ui-breathe',
  success: 'border-ds-success',
  error: 'border-ds-danger'
}

export function TaskCard({
  status,
  title,
  progress,
  meta,
  onCancel,
  onRetry,
  children
}: TaskCardProps): ReactElement {
  const clamped = progress === undefined ? undefined : Math.min(1, Math.max(0, progress))

  return (
    <Card unpadded className="overflow-hidden" data-status={status}>
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${ringClass[status]}`}
        />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink">{title}</p>
        {meta ? <div className="shrink-0 text-[12px] text-ds-muted">{meta}</div> : null}
        {status === 'running' && onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {status === 'error' && onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      {children ? <div className="px-4 pb-3">{children}</div> : null}
      {status === 'running' ? (
        clamped !== undefined ? (
          /* 确定进度：accent 进度条，宽度过渡走 motion token + oneui 曲线 */
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamped * 100)}
            className="h-[3px] w-full bg-ds-subtle"
          >
            <div
              className="h-full bg-accent transition-[width] duration-[var(--motion-base)] ease-[var(--ease-oneui)]"
              style={{ width: `${clamped * 100}%` }}
            />
          </div>
        ) : (
          /* 不确定进度：accent 短条呼吸扫动（keyframes 见 ui-primitives.css） */
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[3px] w-full overflow-hidden bg-ds-subtle"
          >
            <div className="ds-ui-progress-sweep h-full w-2/5 bg-accent" />
          </div>
        )
      ) : null}
    </Card>
  )
}
