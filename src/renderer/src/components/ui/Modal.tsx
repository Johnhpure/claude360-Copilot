import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Calm Blue 统一 Modal 基类（父任务 design §4.8）。
 *
 * 遮罩：rgba(0,0,0,.45) + blur(var(--blur-overlay))——轻玻璃唯一重用点之一；
 *       html[data-blur='off'] 时退化为纯色遮罩（blur 降级开关，AC2）。
 * 面板：surface-elevated + --radius-2xl(24px) + --c360-shadow-overlay。
 * 动画：面板 scale .96→1 + fade（--motion-base / --ease-oneui）；遮罩 fade（linear）。
 * 交互：Esc 关闭、点击遮罩关闭（dismissable=false 时均禁用）、打开时焦点移入面板。
 */
type ModalSize = 'sm' | 'md' | 'lg'

type ModalProps = {
  open: boolean
  onClose: () => void
  /** 无障碍名称（面板 aria-label） */
  ariaLabel: string
  size?: ModalSize
  /** false 时禁用 Esc / 遮罩点击关闭（如提交中防误关），默认 true */
  dismissable?: boolean
  className?: string
  children: ReactNode
}

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl'
}

export function Modal({
  open,
  onClose,
  ariaLabel,
  size = 'sm',
  dismissable = true,
  className = '',
  children
}: ModalProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    window.addEventListener('keydown', onKey)
    // 打开时把焦点移入面板，键盘用户从面板内开始 Tab。
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismissable, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="ds-ui-anim-overlay-fade ds-no-drag fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4 backdrop-blur-[var(--blur-overlay)]"
      role="presentation"
      onPointerDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`ds-ui-anim-modal-panel w-full rounded-3xl border border-ds-border bg-ds-elevated p-5 text-ds-ink shadow-[var(--c360-shadow-overlay)] outline-none ${sizeClass[size]} ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}
