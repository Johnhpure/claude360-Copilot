import { useId, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './Popover'

/**
 * Calm Blue 单选 Select（父任务 design §5）。
 *
 * 触发器视觉同 Input（surface 底 / --radius-md / focus 蓝描边+外发光）；
 * 浮层复用 Popover 基类；选中项 = accent-soft 底 + accent 字 + 对勾。
 */
export type SelectOption<V extends string = string> = {
  value: V
  label: string
  description?: string
  disabled?: boolean
}

type SelectProps<V extends string = string> = {
  value: V | null
  options: ReadonlyArray<SelectOption<V>>
  onChange: (value: V) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
  className?: string
}

export function Select<V extends string = string>({
  value,
  options,
  onChange,
  placeholder = '',
  disabled = false,
  invalid = false,
  className = '',
  ...aria
}: SelectProps<V>): ReactElement {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listboxId = useId()
  const selected = options.find((o) => o.value === value) ?? null

  const stateClass = invalid
    ? 'border-ds-danger focus-visible:border-ds-danger focus-visible:shadow-[0_0_0_3px_var(--ds-danger-soft)]'
    : 'border-ds-border focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--ds-accent-soft)]'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border bg-ds-card px-3 text-[13px] outline-none transition-[border-color,box-shadow] duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${stateClass} ${className}`}
        {...aria}
      >
        <span className={`truncate ${selected ? 'text-ds-ink' : 'text-ds-faint'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ds-muted transition-transform duration-[var(--motion-fast)] ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      <Popover open={open} anchorEl={triggerRef.current} onClose={() => setOpen(false)}>
        <ul id={listboxId} role="listbox" className="max-h-72 overflow-y-auto p-1">
          {options.map((option) => {
            const isActive = option.value === value
            return (
              <li key={option.value} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ds-ink hover:bg-ds-hover'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-[12px] font-normal text-ds-muted">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {isActive ? (
                    <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </Popover>
    </>
  )
}
