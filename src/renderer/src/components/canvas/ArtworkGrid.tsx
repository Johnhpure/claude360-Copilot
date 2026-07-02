import type { ReactElement } from 'react'
import {
  ClipboardType,
  Download,
  Loader2,
  Maximize2,
  RefreshCw,
  TriangleAlert,
  Trash2
} from 'lucide-react'
import type { CanvasArtwork } from '../../canvas/canvas-store'
import { imageDataUrl } from '../../canvas/image-result-utils'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  artworks: CanvasArtwork[]
  /** 有批次飞行中（generating/editing）：禁用所有卡片的「重新生成」，防交错覆盖占位。 */
  busy?: boolean
  selectMode: boolean
  selectedIds: Record<string, true>
  onToggleSelected: (id: string) => void
  onView: (artwork: CanvasArtwork) => void
  onCopyPrompt: (artwork: CanvasArtwork) => void
  onDownload: (artwork: CanvasArtwork) => void
  onRegenerate: (artwork: CanvasArtwork) => void
  onRemove: (artwork: CanvasArtwork) => void
  /** 空态文案 key：真空态与「筛选无结果」可区分（默认真空态文案）。 */
  emptyKey?: string
  t: TFn
}

/** createdAt(ISO) → 本地短时间；非法/缺失返回空串。 */
export function formatArtworkTime(createdAt: string): string {
  if (!createdAt) return ''
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const STATUS_BADGE_CLASS: Record<CanvasArtwork['status'], string> = {
  success: 'bg-emerald-500/15 text-emerald-400',
  pending: 'bg-amber-500/15 text-amber-400',
  failed: 'bg-red-500/15 text-red-400'
}

function ActionButton({
  label,
  disabled,
  onClick,
  testId,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  testId: string
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

// 作品宫格（纯展示）：每个作品一张卡片 —— 图片/状态占位 + 状态标签 + 提示词摘要 +
// 元信息（模型/尺寸/质量/格式/时间）+ 操作行（大图/复制提示词/下载/重新生成/删除）。
// 生成中的批次以 loading 卡片占位，完成后由 store 原位替换为图片结果。
export function ArtworkGrid({
  artworks,
  busy = false,
  selectMode,
  selectedIds,
  onToggleSelected,
  onView,
  onCopyPrompt,
  onDownload,
  onRegenerate,
  onRemove,
  emptyKey = 'canvasArtworksEmpty',
  t
}: Props): ReactElement {
  if (artworks.length === 0) {
    return (
      <div
        data-testid="artwork-grid-empty"
        className="flex min-h-[220px] flex-1 items-center justify-center rounded-2xl border border-dashed border-ds-border bg-ds-card px-6 text-center text-[12.5px] text-ds-muted"
      >
        {t(emptyKey)}
      </div>
    )
  }
  return (
    <div
      data-testid="artwork-grid"
      className="grid gap-3.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
    >
      {artworks.map((artwork) => {
        const src = artwork.image ? imageDataUrl(artwork.image) : null
        const selected = Boolean(selectedIds[artwork.id])
        const meta = [
          artwork.model,
          artwork.size,
          artwork.quality,
          artwork.outputFormat,
          formatArtworkTime(artwork.createdAt)
        ].filter(Boolean)
        return (
          <article
            key={artwork.id}
            data-testid="artwork-card"
            data-status={artwork.status}
            className={`group flex flex-col overflow-hidden rounded-xl border bg-ds-card transition ${selected ? 'border-ds-ink ring-2 ring-ds-accent' : 'border-ds-border'}`}
          >
            {/* 图片 / 状态占位区（统一 1:1 比例避免高低不齐） */}
            <button
              type="button"
              onClick={() => (selectMode ? onToggleSelected(artwork.id) : onView(artwork))}
              aria-label={selectMode ? t('canvasBatchToggle') : t('canvasActionView')}
              className="relative block aspect-square w-full overflow-hidden bg-ds-main"
              title={artwork.prompt}
            >
              {artwork.status === 'success' && src ? (
                <img
                  src={src}
                  alt={t('canvasImageAlt', { prompt: artwork.prompt })}
                  className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                />
              ) : artwork.status === 'pending' ? (
                <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-ds-muted">
                  <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.9} />
                  <span className="text-[12px]">
                    {t('canvasArtworkGenerating', { count: artwork.n })}
                  </span>
                </span>
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-red-400">
                  <TriangleAlert className="h-6 w-6" strokeWidth={1.9} />
                  <span className="line-clamp-3 text-[11.5px] leading-4 text-ds-muted">
                    {artwork.error || t('canvasArtworkFailed')}
                  </span>
                </span>
              )}
              {/* 状态标签（图片角落） */}
              <span
                data-testid="artwork-status-badge"
                className={`absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium backdrop-blur ${STATUS_BADGE_CLASS[artwork.status]}`}
              >
                {t(`canvasStatus_${artwork.status}`)}
              </span>
              {selectMode ? (
                <span
                  aria-hidden="true"
                  data-testid="artwork-select-box"
                  className={`absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md border text-[11px] ${selected ? 'border-ds-accent bg-ds-accent text-white' : 'border-ds-border bg-black/40 text-transparent'}`}
                >
                  ✓
                </span>
              ) : null}
            </button>

            {/* 信息区：提示词摘要 + 元信息 + 操作行 */}
            <div className="flex flex-1 flex-col gap-1.5 p-2.5">
              <p className="line-clamp-2 text-[12px] leading-[18px] text-ds-ink" title={artwork.prompt}>
                {artwork.prompt || t('canvasArtworkNoPrompt')}
              </p>
              {meta.length > 0 ? (
                <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-ds-muted">
                  {meta.map((item, index) => (
                    <span key={`${item}-${index}`}>{item}</span>
                  ))}
                </p>
              ) : null}
              <div className="mt-auto flex items-center gap-0.5 pt-0.5">
                <ActionButton
                  label={t('canvasActionView')}
                  testId="artwork-view-button"
                  disabled={artwork.status !== 'success'}
                  onClick={() => onView(artwork)}
                >
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
                <ActionButton
                  label={t('canvasActionCopyPrompt')}
                  testId="artwork-copy-prompt-button"
                  disabled={!artwork.prompt}
                  onClick={() => onCopyPrompt(artwork)}
                >
                  <ClipboardType className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
                <ActionButton
                  label={t('canvasDownload')}
                  testId="artwork-download-button"
                  disabled={artwork.status !== 'success'}
                  onClick={() => onDownload(artwork)}
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
                <ActionButton
                  label={t('canvasActionRegenerate')}
                  testId="artwork-regenerate-button"
                  disabled={busy || artwork.status === 'pending' || !artwork.prompt}
                  onClick={() => onRegenerate(artwork)}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
                <ActionButton
                  label={t('canvasActionDelete')}
                  testId="artwork-delete-button"
                  disabled={artwork.status === 'pending'}
                  onClick={() => onRemove(artwork)}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
