import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react'

/**
 * Calm Blue 卡片原语（父任务 design §5）：焦点块（focus block）。
 *
 * 基线：surface 底、--radius-lg(16px) 圆角、20px 内边距、无投影——靠明度差分层。
 * 变体：
 *   default     内容卡（无投影）
 *   elevated    浮动卡（+ --c360-shadow-sm 极轻投影）
 *   interactive 可点卡（hover 提亮 + 上浮 2px，--motion-fast）
 */
export type CardVariant = 'default' | 'elevated' | 'interactive'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant
  /** 关闭默认 20px 内边距（嵌套布局自管 padding 时用） */
  unpadded?: boolean
  ref?: Ref<HTMLDivElement>
  children?: ReactNode
}

const variantClass: Record<CardVariant, string> = {
  default: '',
  elevated: 'shadow-[var(--c360-shadow-sm)]',
  interactive:
    'cursor-pointer transition-[background-color,transform,box-shadow] duration-[var(--motion-fast)] hover:-translate-y-0.5 hover:bg-ds-elevated hover:shadow-[var(--c360-shadow-sm)]'
}

export function Card({
  variant = 'default',
  unpadded = false,
  className = '',
  ref,
  children,
  ...rest
}: CardProps): ReactElement {
  return (
    <div
      ref={ref}
      className={`rounded-xl border border-ds-border bg-ds-card text-ds-ink ${
        unpadded ? '' : 'p-5'
      } ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
