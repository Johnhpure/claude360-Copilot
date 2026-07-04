import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore } from './toast-store'
import type { ToastItem, ToastKind } from './toast-store'

/**
 * Toast 出口组件（父任务 design §4.8）。
 *
 * 右下角胶囊卡栈：blur(var(--blur-toast)) 半透明底（blur 允许场景之一）、
 * 功能色左侧 3px 竖条、默认 3.5s 自动消退。AppShell 挂载一次。
 */

const kindIcon: Record<ToastKind, ReactElement> = {
  success: <CheckCircle2 className="h-4 w-4 text-ds-success" strokeWidth={2} aria-hidden />,
  error: <AlertCircle className="h-4 w-4 text-ds-danger" strokeWidth={2} aria-hidden />,
  warning: <AlertTriangle className="h-4 w-4 text-ds-warning" strokeWidth={2} aria-hidden />,
  info: <Info className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
}

/** 左侧功能色竖条（色相恒定，强约束3） */
const kindBarClass: Record<ToastKind, string> = {
  success: 'bg-ds-success',
  error: 'bg-ds-danger',
  warning: 'bg-ds-warning',
  info: 'bg-accent'
}

function ToastCard({ item }: { item: ToastItem }): ReactElement {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    if (item.duration <= 0) return
    const id = window.setTimeout(() => dismiss(item.id), item.duration)
    return () => window.clearTimeout(id)
  }, [item.id, item.duration, dismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="ds-ui-anim-toast pointer-events-auto relative flex w-80 items-start gap-2.5 overflow-hidden rounded-[var(--radius-lg)] border border-ds-border bg-[color-mix(in_srgb,var(--ds-surface-elevated)_90%,transparent)] py-3 pl-4 pr-2 shadow-[var(--c360-shadow-overlay)] backdrop-blur-[var(--blur-toast)]"
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${kindBarClass[item.kind]}`} aria-hidden />
      <span className="mt-0.5 shrink-0">{kindIcon[item.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug text-ds-ink">{item.message}</p>
        {item.description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-ds-muted">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
        className="shrink-0 rounded-full p-1 text-ds-faint transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}

export function Toaster(): ReactElement | null {
  const items = useToastStore((s) => s.items)
  if (items.length === 0) return null

  return createPortal(
    <div className="ds-no-drag pointer-events-none fixed bottom-4 right-4 z-[120] flex flex-col-reverse gap-2">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body
  )
}
