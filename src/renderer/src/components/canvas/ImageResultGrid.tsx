import type { ReactElement } from 'react'
import { Check, Copy, Download, Link as LinkIcon } from 'lucide-react'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import { imageDataUrl, imageCopyUrl } from '../../canvas/image-result-utils'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  images: Claude360CanvasImage[]
  activeImageId: string | null
  onSelect: (id: string) => void
  onCopy: (image: Claude360CanvasImage) => void
  onDownload: (image: Claude360CanvasImage) => void
  /** 空态文案 key（结果区 vs 历史区可复用本组件）。 */
  emptyKey: string
  testId: string
  t: TFn
}

// 图片结果网格（纯展示）：每张图带复制 / 下载按钮（lucide 图标 + tooltip）。
// url 图片复制按钮显示「复制链接」；base64 图片显示「复制图片」。控件稳定尺寸。
export function ImageResultGrid({
  images,
  activeImageId,
  onSelect,
  onCopy,
  onDownload,
  emptyKey,
  testId,
  t
}: Props): ReactElement {
  if (images.length === 0) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className="flex min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-ds-border bg-ds-card text-[12.5px] text-ds-muted"
      >
        {t(emptyKey)}
      </div>
    )
  }
  return (
    <div data-testid={testId} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {images.map((image) => {
        const src = imageDataUrl(image)
        const isUrl = Boolean(imageCopyUrl(image))
        const active = image.id === activeImageId
        return (
          <figure
            key={image.id}
            data-testid="image-result-card"
            data-active={active ? 'true' : undefined}
            className={`group relative overflow-hidden rounded-xl border bg-ds-main ${active ? 'border-ds-ink ring-2 ring-ds-accent' : 'border-ds-border'}`}
          >
            <button
              type="button"
              onClick={() => onSelect(image.id)}
              aria-label={t('canvasSelectImage')}
              aria-pressed={active}
              className="block aspect-square w-full"
              title={image.prompt}
            >
              {src ? (
                <img
                  src={src}
                  alt={t('canvasImageAlt', { prompt: image.prompt })}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </button>
            {active ? (
              <span
                aria-hidden="true"
                data-testid="image-selected-badge"
                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ds-accent text-white shadow-sm"
              >
                <Check className="h-3 w-3" strokeWidth={2.5} />
              </span>
            ) : null}
            <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                data-testid="image-copy-button"
                data-focus-ring="on-media"
                onClick={() => onCopy(image)}
                title={isUrl ? t('canvasCopyUrl') : t('canvasCopyImage')}
                aria-label={isUrl ? t('canvasCopyUrl') : t('canvasCopyImage')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-ds-ink shadow-sm transition hover:bg-white"
              >
                {isUrl ? (
                  <LinkIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </button>
              <button
                type="button"
                data-testid="image-download-button"
                data-focus-ring="on-media"
                onClick={() => onDownload(image)}
                title={t('canvasDownload')}
                aria-label={t('canvasDownload')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-ds-ink shadow-sm transition hover:bg-white"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </figcaption>
          </figure>
        )
      })}
    </div>
  )
}
