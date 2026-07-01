import type { ReactElement } from 'react'
import { History } from 'lucide-react'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import { ImageResultGrid } from './ImageResultGrid'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  history: Claude360CanvasImage[]
  activeImageId: string | null
  onSelect: (id: string) => void
  onCopy: (image: Claude360CanvasImage) => void
  onDownload: (image: Claude360CanvasImage) => void
  t: TFn
}

// 历史区（纯展示）：复用 ImageResultGrid 渲染历史缩略图 + 复制/下载。
export function ImageHistoryPanel({
  history,
  activeImageId,
  onSelect,
  onCopy,
  onDownload,
  t
}: Props): ReactElement {
  return (
    <section data-testid="image-history-panel" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
        <h2 className="text-[13px] font-semibold text-ds-ink">{t('canvasHistoryTitle')}</h2>
      </div>
      <ImageResultGrid
        images={history}
        activeImageId={activeImageId}
        onSelect={onSelect}
        onCopy={onCopy}
        onDownload={onDownload}
        emptyKey="canvasHistoryEmpty"
        testId="image-history-grid"
        t={t}
      />
    </section>
  )
}
