import type { ReactElement, ReactNode } from 'react'

/**
 * PageHeader —— 统一页头 Pattern（父任务 design §5）。
 *
 * 规范：高 56px、大标题 20px/600、可选说明文字、右侧操作区。
 * 阶段2 交付组件本体；各页面顶栏全量迁移在阶段3–5 按页进行。
 *
 * 用法：
 * ```tsx
 * <PageHeader
 *   title={t('settings')}
 *   description={t('settingsDescription')}
 *   actions={<Button size="sm" onClick={onSave}>{t('save')}</Button>}
 * />
 * ```
 */
type PageHeaderProps = {
  title: string
  /** 标题右侧的补充说明（面包屑/副标题） */
  description?: string
  /** 右侧操作区（按钮/开关等） */
  actions?: ReactNode
  /** 标题左侧前置内容（返回按钮/图标） */
  leading?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  actions,
  leading,
  className = ''
}: PageHeaderProps): ReactElement {
  return (
    <header
      className={`ds-no-drag flex h-14 shrink-0 items-center gap-3 px-6 ${className}`}
    >
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="truncate text-[20px] font-semibold leading-tight text-ds-ink">{title}</h1>
        {description ? (
          <p className="hidden truncate text-[13px] text-ds-muted sm:block">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}
