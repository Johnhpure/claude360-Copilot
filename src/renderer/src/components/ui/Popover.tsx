import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Placement } from '@floating-ui/dom'

/**
 * Calm Blue 浮层基类（父任务 design §4.8/§5）。
 *
 * 视觉：surface-elevated + --radius-md(12px) + --c360-shadow-overlay +
 *       轻玻璃 blur(var(--blur-overlay))（唯一允许 blur 的场景之一，强约束5；
 *       html[data-blur='off'] 时自动退化为纯色面板）。
 * 定位：@floating-ui/dom computePosition + offset/flip/shift + autoUpdate。
 * 交互：Esc / 点击外部关闭；出现动画 scale .97→1 + fade（--motion-base / --ease-oneui）。
 *
 * 存量 picker（ModelPicker 等）迁移到本基类属阶段3。
 */
type PopoverProps = {
  open: boolean
  /** 锚点元素（触发器） */
  anchorEl: HTMLElement | null
  onClose: () => void
  placement?: Placement
  /** 与锚点的间距，默认 6px */
  gutter?: number
  /** 浮层最小宽度跟随锚点宽度，默认 true */
  matchAnchorWidth?: boolean
  className?: string
  children: ReactNode
}

export function Popover({
  open,
  anchorEl,
  onClose,
  placement = 'bottom-start',
  gutter = 6,
  matchAnchorWidth = true,
  className = '',
  children
}: PopoverProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0 })

  // 定位：autoUpdate 跟随滚动/resize；flip+shift 处理边缘翻转。
  useLayoutEffect(() => {
    if (!open || !anchorEl) return
    const panel = panelRef.current
    if (!panel) return
    const update = (): void => {
      void computePosition(anchorEl, panel, {
        placement,
        strategy: 'fixed',
        middleware: [offset(gutter), flip(), shift({ padding: 8 })]
      }).then(({ x, y }) => {
        setStyle({
          position: 'fixed',
          top: `${y}px`,
          left: `${x}px`,
          minWidth: matchAnchorWidth ? `${anchorEl.offsetWidth}px` : undefined
        })
      })
    }
    return autoUpdate(anchorEl, panel, update)
  }, [open, anchorEl, placement, gutter, matchAnchorWidth])

  // Esc + 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, anchorEl, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={`ds-ui-anim-popover ds-no-drag z-[110] overflow-hidden rounded-[var(--radius-md)] border border-ds-border bg-ds-elevated text-ds-ink shadow-[var(--c360-shadow-overlay)] backdrop-blur-[var(--blur-overlay)] ${className}`}
    >
      {children}
    </div>,
    document.body
  )
}
