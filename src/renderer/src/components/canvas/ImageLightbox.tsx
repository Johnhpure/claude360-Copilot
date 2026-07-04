import type { ReactElement } from 'react'
import { ClipboardType, Copy, Download, Trash2, X } from 'lucide-react'
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
  if (!open || !src) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t('canvasActionView')}
      size="lg"
      className="overflow-hidden !p-0"
    >
      <div data-testid="canvas-lightbox" className="flex min-h-0 flex-col">
        {/* 无 padding 图片容器 */}
        <img
          src={src}
          alt={t('canvasImageAlt', { prompt })}
          className="max-h-[68vh] w-full bg-ds-main object-contain"
        />

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
