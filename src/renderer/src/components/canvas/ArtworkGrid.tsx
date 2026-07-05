import type { ReactElement } from 'react'
import { ClipboardType, Download, Images, Maximize2, RefreshCw, Trash2 } from 'lucide-react'
import type { CanvasArtwork } from '../../canvas/canvas-store'
import { imageDataUrl } from '../../canvas/image-result-utils'
import { useLocalAssetSrc } from '../../lib/use-local-asset-src'
import { Button, Card, EmptyState } from '../ui'
import { TaskCard, type TaskCardStatus } from '../task'
import { ImageCard } from './ImageCard'

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
  /** 当前工作空间根（07-05 本地资产优先展示；缺省回退远程/内存 src）。 */
  workspaceRoot?: string
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

/** 作品状态 → TaskCard 三态映射（阶段4 design §4：纯函数收敛，便于测试）。 */
export function toTaskCardStatus(status: CanvasArtwork['status']): TaskCardStatus {
  if (status === 'pending') return 'running'
  if (status === 'failed') return 'error'
  return 'success'
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
      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** 批量选择角标（图片区右上角覆盖层）。 */
function SelectBox({ selected }: { selected: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-testid="artwork-select-box"
      className={`absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-[var(--radius-sm)] border text-[11px] ${
        selected
          ? 'border-ds-accent bg-ds-accent text-white'
          : 'border-ds-border bg-ds-card text-transparent'
      }`}
    >
      ✓
    </span>
  )
}

// 作品宫格（纯展示）：生成任务全链路走统一视觉——
//   pending → TaskCard（running 呼吸 + 不确定进度扫动）
//   failed  → TaskCard（error 态 + 错误信息 + 重新生成/删除）
//   success → ImageCard（interactive 大圆角焦点块 + 操作行）
// 状态映射用纯函数 toTaskCardStatus；卡间距 16px（Calm Blue 语义常量）。
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
  workspaceRoot,
  t
}: Props): ReactElement {
  if (artworks.length === 0) {
    return (
      <Card
        data-testid="artwork-grid-empty"
        className="flex min-h-[220px] flex-1 items-center justify-center border-dashed"
      >
        <EmptyState icon={Images} title={t(emptyKey)} />
      </Card>
    )
  }
  return (
    <div
      data-testid="artwork-grid"
      className="grid items-start gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
    >
      {artworks.map((artwork) => {
        const selected = Boolean(selectedIds[artwork.id])
        const meta = [
          artwork.model,
          artwork.size,
          artwork.quality,
          artwork.outputFormat,
          formatArtworkTime(artwork.createdAt)
        ].filter(Boolean) as string[]

        // 非 success：统一 TaskCard 表达（running 呼吸 / error 重试）
        if (artwork.status !== 'success') {
          const failed = artwork.status === 'failed'
          return (
            <div
              key={artwork.id}
              data-testid="artwork-card"
              data-status={artwork.status}
              onClick={selectMode ? () => onToggleSelected(artwork.id) : undefined}
              className={`relative ${
                selected ? 'rounded-xl ring-2 ring-ds-accent' : ''
              } ${selectMode ? 'cursor-pointer' : ''}`}
            >
              <TaskCard
                status={toTaskCardStatus(artwork.status)}
                title={artwork.prompt || t('canvasArtworkNoPrompt')}
                meta={artwork.model || undefined}
              >
                {failed ? (
                  <div className="flex flex-col gap-2">
                    <p className="line-clamp-3 text-[12px] leading-[18px] text-ds-danger">
                      {artwork.error || t('canvasArtworkFailed')}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {/* TaskCard 内置 Retry 文案未接 i18n，操作在展开区用本地化按钮表达 */}
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="artwork-regenerate-button"
                        disabled={busy || !artwork.prompt}
                        onClick={() => onRegenerate(artwork)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                        {t('canvasActionRegenerate')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="artwork-delete-button"
                        onClick={() => onRemove(artwork)}
                        className="text-ds-danger hover:text-ds-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                        {t('canvasActionDelete')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] text-ds-muted">
                    {t('canvasArtworkGenerating', { count: artwork.n })}
                  </p>
                )}
              </TaskCard>
              {selectMode ? <SelectBox selected={selected} /> : null}
            </div>
          )
        }

        // success：ImageCard 焦点块（本地资产优先，见 SuccessArtworkCard）
        return (
          <SuccessArtworkCard
            key={artwork.id}
            artwork={artwork}
            meta={meta}
            selected={selected}
            selectMode={selectMode}
            busy={busy}
            workspaceRoot={workspaceRoot}
            onToggleSelected={onToggleSelected}
            onView={onView}
            onCopyPrompt={onCopyPrompt}
            onDownload={onDownload}
            onRegenerate={onRegenerate}
            onRemove={onRemove}
            t={t}
          />
        )
      })}
    </div>
  )
}

/**
 * success 作品卡（07-05 抽出为组件以使用 hook）：本地落盘文件优先展示，
 * 本地缺失回退远程/内存 src；两者皆无（文件被手动删除且无远程回退）时
 * ImageCard 走其自身的空 src 占位，不崩溃。
 */
function SuccessArtworkCard({
  artwork,
  meta,
  selected,
  selectMode,
  busy,
  workspaceRoot,
  onToggleSelected,
  onView,
  onCopyPrompt,
  onDownload,
  onRegenerate,
  onRemove,
  t
}: {
  artwork: CanvasArtwork
  meta: string[]
  selected: boolean
  selectMode: boolean
  busy: boolean
  workspaceRoot?: string
  onToggleSelected: (id: string) => void
  onView: (artwork: CanvasArtwork) => void
  onCopyPrompt: (artwork: CanvasArtwork) => void
  onDownload: (artwork: CanvasArtwork) => void
  onRegenerate: (artwork: CanvasArtwork) => void
  onRemove: (artwork: CanvasArtwork) => void
  t: TFn
}): ReactElement {
  const fallbackSrc = artwork.image ? imageDataUrl(artwork.image) : null
  const src = useLocalAssetSrc(workspaceRoot, artwork.localPath, fallbackSrc) || null
  const missingLocal = artwork.fileMissing === true
  return (
          <ImageCard
            data-testid="artwork-card"
            data-status={artwork.status}
            src={src}
            alt={t('canvasImageAlt', { prompt: artwork.prompt })}
            prompt={artwork.prompt || t('canvasArtworkNoPrompt')}
            metaItems={meta}
            selected={selected}
            openLabel={selectMode ? t('canvasBatchToggle') : t('canvasActionView')}
            onOpen={() => (selectMode ? onToggleSelected(artwork.id) : onView(artwork))}
            onImageError={() => {
              // 打印加载失败的真实 URL（截断 data URL），排查鉴权/CSP/字段映射问题。
              console.error('[claude360-canvas] artwork image load failed', {
                artworkId: artwork.id,
                src: src && src.startsWith('data:') ? `${src.slice(0, 64)}...` : src
              })
            }}
            overlay={
              <>
                <span
                  data-testid="artwork-status-badge"
                  className="absolute left-1.5 top-1.5 rounded-[var(--radius-sm)] bg-ds-card px-1.5 py-0.5 text-[10.5px] font-medium text-ds-success"
                >
                  {missingLocal ? t('canvasAssetMissing') : t(`canvasStatus_${artwork.status}`)}
                </span>
                {selectMode ? <SelectBox selected={selected} /> : null}
              </>
            }
            actions={
              <>
                <ActionButton
                  label={t('canvasActionView')}
                  testId="artwork-view-button"
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
                  onClick={() => onDownload(artwork)}
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
                <ActionButton
                  label={t('canvasActionRegenerate')}
                  testId="artwork-regenerate-button"
                  disabled={busy || !artwork.prompt}
                  onClick={() => onRegenerate(artwork)}
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
                <ActionButton
                  label={t('canvasActionDelete')}
                  testId="artwork-delete-button"
                  onClick={() => onRemove(artwork)}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </ActionButton>
              </>
            }
          />
  )
}
