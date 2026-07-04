import type { PointerEvent as ReactPointerEvent, ReactElement, WheelEvent as ReactWheelEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardType, Copy, Download, RotateCcw, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button, Modal } from '../ui'

/**
 * 生图 Lightbox（Feature，阶段4 design §2.3；父任务 §4.3）。
 *
 * 基于 ui/Modal 基类：遮罩 blur(var(--blur-overlay)) 与 html[data-blur='off']
 * 降级开关、Esc/遮罩点击关闭、出现动画全部由基类提供，不自绘遮罩。
 * 面板改为无 padding 图片容器 + 底部操作条（复制图片/复制提示词/下载/删除）。
 */
type TFn = (key: string, opts?: Record<string, unknown>) => string

type ImageLightboxProps = {
  open: boolean
  /** 大图地址（dataURL / URL）；null 时不渲染 */
  src: string | null
  prompt: string
  onClose: () => void
  onCopyImage?: () => void
  onCopyPrompt?: () => void
  onDownload?: () => void
  /** 删除当前作品（调用方负责关闭 + removeArtwork） */
  onDelete?: () => void
  t: TFn
}

type Point = { x: number; y: number }
type NaturalSize = { width: number; height: number }

const MIN_SCALE = 1
const MAX_SCALE = 4
const SCALE_STEP = 0.25

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100))
}

function nextZoom(value: number, direction: 'in' | 'out'): number {
  return clampScale(value + (direction === 'in' ? SCALE_STEP : -SCALE_STEP))
}

export function ImageLightbox({
  open,
  src,
  prompt,
  onClose,
  onCopyImage,
  onCopyPrompt,
  onDownload,
  onDelete,
  t
}: ImageLightboxProps): ReactElement | null {
  const [scale, setScale] = useState(MIN_SCALE)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null)
  const dragStartRef = useRef<Point | null>(null)
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 })

  const resetZoom = useCallback((): void => {
    setScale(MIN_SCALE)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    resetZoom()
    setNaturalSize(null)
  }, [resetZoom, src])

  const zoomBy = useCallback((direction: 'in' | 'out'): void => {
    setScale((current) => {
      const next = nextZoom(current, direction)
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 'in' : 'out')
  }, [zoomBy])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (scale <= MIN_SCALE) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    dragOffsetRef.current = offset
  }, [offset, scale])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = dragStartRef.current
    if (!start || scale <= MIN_SCALE) return
    setOffset({
      x: dragOffsetRef.current.x + event.clientX - start.x,
      y: dragOffsetRef.current.y + event.clientY - start.y
    })
  }, [scale])

  const stopDragging = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    dragStartRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  if (!open || !src) return null

  const canDrag = scale > MIN_SCALE
  const resolutionText = naturalSize ? `${naturalSize.width} × ${naturalSize.height}` : ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t('canvasActionView')}
      size="lg"
      className="overflow-hidden !p-0"
    >
      <div data-testid="canvas-lightbox" className="flex min-h-0 flex-col">
        <div
          data-testid="canvas-lightbox-viewport"
          className={`relative flex max-h-[68vh] min-h-[320px] w-full touch-none select-none items-center justify-center overflow-hidden bg-ds-main ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
        >
          <img
            src={src}
            alt={t('canvasImageAlt', { prompt })}
            className="max-h-[68vh] max-w-full object-contain will-change-transform"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            draggable={false}
            onLoad={(event) => {
              setNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight
              })
            }}
          />
          {resolutionText ? (
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-ds-border bg-black/45 px-2.5 py-1 text-[12px] font-medium text-white shadow-[var(--c360-shadow-sm)]">
              {resolutionText}
            </span>
          ) : null}
          <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-ds-border bg-black/45 p-1 shadow-[var(--c360-shadow-sm)]">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => zoomBy('out')}
              disabled={scale <= MIN_SCALE}
              title={t('canvasLightboxZoomOut')}
              aria-label={t('canvasLightboxZoomOut')}
            >
              <ZoomOut className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => zoomBy('in')}
              disabled={scale >= MAX_SCALE}
              title={t('canvasLightboxZoomIn')}
              aria-label={t('canvasLightboxZoomIn')}
            >
              <ZoomIn className="h-4 w-4" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={resetZoom}
              disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0}
              title={t('canvasLightboxResetZoom')}
              aria-label={t('canvasLightboxResetZoom')}
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* 底部操作条：提示词 + 动作按钮 */}
        <div className="flex flex-col gap-3 border-t border-ds-border p-4">
          {prompt ? (
            <p className="max-h-20 overflow-y-auto text-[12.5px] leading-5 text-ds-muted">
              {prompt}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {onCopyImage ? (
              <Button variant="secondary" size="sm" onClick={onCopyImage}>
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('canvasCopyImage')}
              </Button>
            ) : null}
            {onCopyPrompt ? (
              <Button variant="secondary" size="sm" onClick={onCopyPrompt} disabled={!prompt}>
                <ClipboardType className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('canvasActionCopyPrompt')}
              </Button>
            ) : null}
            {onDownload ? (
              <Button variant="secondary" size="sm" onClick={onDownload}>
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('canvasDownload')}
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="text-ds-danger hover:text-ds-danger"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('canvasActionDelete')}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">
              <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t('close')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
