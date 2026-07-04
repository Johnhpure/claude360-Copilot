import type { ComponentType, ReactElement, ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import { Button } from './Button'

/**
 * Calm Blue 三态组件基类（父任务 design §5：Empty / Loading / Error）。
 *
 * 阶段2 交付基类，阶段6 全量铺开到各页面。
 * 布局统一：居中、图标 40px、一句标题 + 一句说明 + 可选操作按钮。
 */

type StateLayoutProps = {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

function StateLayout({ icon, title, description, action }: StateLayoutProps): ReactElement {
  return (
    <div className="flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <div aria-hidden>{icon}</div>
      <p className="text-[14px] font-medium text-ds-ink">{title}</p>
      {description ? (
        <p className="max-w-[36ch] text-[13px] leading-relaxed text-ds-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

type EmptyStateProps = {
  /** lucide 图标组件，默认 Inbox */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  title: string
  description?: string
  /** 可选主操作（如「新建」） */
  action?: ReactNode
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action
}: EmptyStateProps): ReactElement {
  return (
    <StateLayout
      icon={<Icon className="h-10 w-10 text-ds-faint" strokeWidth={1.5} />}
      title={title}
      description={description}
      action={action}
    />
  )
}

type LoadingStateProps = {
  /** 骨架行数，默认 3 */
  lines?: number
  /** 无障碍标签 */
  label?: string
}

/** 骨架屏优先于 spinner（§5 LoadingState）：surface 上微光扫过（linear）。 */
export function LoadingState({ lines = 3, label }: LoadingStateProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex w-full flex-col gap-3 p-6"
    >
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="ds-ui-skeleton h-4 rounded-[var(--radius-sm)] bg-ds-subtle"
          style={{ width: `${100 - i * 18}%` }}
        />
      ))}
    </div>
  )
}

type ErrorStateProps = {
  title: string
  description?: string
  /** 重试回调；提供时渲染 secondary「重试」按钮 */
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = 'Retry'
}: ErrorStateProps): ReactElement {
  return (
    <StateLayout
      icon={<AlertCircle className="h-10 w-10 text-ds-danger" strokeWidth={1.5} />}
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  )
}
