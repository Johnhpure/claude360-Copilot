import type {
  InputHTMLAttributes,
  ReactElement,
  Ref,
  TextareaHTMLAttributes
} from 'react'

/**
 * Calm Blue 输入原语（父任务 design §5）。
 *
 * surface 底、--radius-md(12px) 圆角、1px border；
 * focus = accent 描边 + accent-soft 外发光；invalid = error 描边。
 * 颜色/圆角全走 token。
 */

const fieldBaseClass =
  'w-full rounded-[var(--radius-md)] border bg-ds-card text-[13px] text-ds-ink placeholder:text-ds-faint outline-none transition-[border-color,box-shadow] duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-50'

const fieldStateClass = (invalid: boolean): string =>
  invalid
    ? 'border-ds-danger focus:border-ds-danger focus:shadow-[0_0_0_3px_var(--ds-danger-soft)]'
    : 'border-ds-border focus:border-accent focus:shadow-[0_0_0_3px_var(--ds-accent-soft)]'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean
  ref?: Ref<HTMLInputElement>
}

export function Input({
  invalid = false,
  className = '',
  ref,
  ...rest
}: InputProps): ReactElement {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`h-9 px-3 ${fieldBaseClass} ${fieldStateClass(invalid)} ${className}`}
      {...rest}
    />
  )
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({
  invalid = false,
  className = '',
  ref,
  ...rest
}: TextareaProps): ReactElement {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`min-h-[72px] px-3 py-2 leading-relaxed ${fieldBaseClass} ${fieldStateClass(invalid)} ${className}`}
      {...rest}
    />
  )
}
