import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Calm Blue 按钮原语（父任务 design §5）。
 *
 * 形态：胶囊（--radius-pill）；高度三档 sm=32 / md=36 / lg=40；hover 过渡 --motion-fast。
 * 变体：primary=accent 底白字 / secondary=elevated 面+描边 / ghost=无底 / danger=error 底白字。
 * 颜色一律走 token（Tailwind ds/accent 映射），组件内禁止字面量色。
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** true 时显示旋转指示并禁用点击（保持宽度稳定由调用方控制文案） */
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
  children?: ReactNode
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12px] gap-1',
  md: 'h-9 px-4 text-[13px] gap-1.5',
  lg: 'h-10 px-5 text-[14px] gap-2'
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white font-semibold shadow-sm hover:bg-[var(--c360-accent-hover)] disabled:hover:bg-accent',
  secondary:
    'bg-ds-elevated text-ds-ink font-medium border border-ds-border hover:bg-ds-hover',
  ghost: 'bg-transparent text-ds-muted font-medium hover:bg-ds-hover hover:text-ds-ink',
  danger:
    'bg-ds-danger text-white font-semibold shadow-sm hover:opacity-90 disabled:hover:opacity-100'
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  type = 'button',
  ref,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-full outline-none transition-[background-color,color,opacity,box-shadow] duration-[var(--motion-fast)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ds-accent)_50%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass[size]} ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}
