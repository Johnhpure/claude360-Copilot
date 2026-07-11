import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react'
import { Check, ImagePlus, Images } from 'lucide-react'
import type { ImageAssetRecord } from '@shared/media-assets'
import { Button, EmptyState, LoadingState, Modal } from '../ui'
import { useLocalAssetSrc } from '../../lib/use-local-asset-src'
import { fileToDataUrl, type CanvasPersistenceApi } from '../../canvas/canvas-workbench-actions'

type TFn = (key: string, opts?: Record<string, unknown>) => string

/** 本地上传项（仅文件名 + 缩略图 dataURL；不上传像素到任何接口）。 */
export type AssetPickerUpload = { name: string; dataUrl: string }

type Props = {
  open: boolean
  workspaceRoot: string
  /** mediaAssetsList 依赖注入（容器传 window.kunGui 子集，便于测试）。 */
  api: Pick<CanvasPersistenceApi, 'mediaAssetsList'> | null
  /** 确认所选素材（仅元信息：id/prompt/localPath 等，不含像素数据）。 */
  onConfirm: (assets: ImageAssetRecord[]) => void
  /** 「上传」入口：本地文件 → 文件名 + dataURL 缩略图（fileToDataUrl 模式）。 */
  onUpload: (uploads: AssetPickerUpload[]) => void
  onClose: () => void
  t: TFn
}

/** success（completed 且有本地文件）优先展示的排序权重。 */
export function assetSortWeight(record: ImageAssetRecord): number {
  if (record.status === 'completed' && record.localPath) return 0
  if (record.status === 'completed') return 1
  return 2
}

function AssetThumb({
  record,
  workspaceRoot,
  selected,
  onToggle,
  t
}: {
  record: ImageAssetRecord
  workspaceRoot: string
  selected: boolean
  onToggle: () => void
  t: TFn
}): ReactElement {
  const src = useLocalAssetSrc(workspaceRoot, record.localPath, record.remoteUrl ?? null)
  return (
    <button
      type="button"
      data-testid="asset-picker-item"
      aria-pressed={selected}
      title={record.prompt || record.id}
      onClick={onToggle}
      className={`relative aspect-square overflow-hidden rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)] ${
        selected ? 'border-ds-accent ring-2 ring-ds-accent' : 'border-ds-border hover:border-ds-accent'
      }`}
    >
      {src ? (
        <img src={src} alt={record.prompt || record.id} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center bg-ds-main text-ds-faint">
          <Images className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
      )}
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ds-accent text-white"
        >
          <Check className="h-3 w-3" strokeWidth={2.5} />
        </span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 truncate bg-ds-card px-1.5 py-0.5 text-left text-[10px] text-ds-muted">
        {record.prompt || t('canvasArtworkNoPrompt')}
      </span>
    </button>
  )
}

// 「我的素材」选择器（design §7.6）：mediaAssetsList 宫格 + useLocalAssetSrc 缩略图，
// 多选后确认返回 ImageAssetRecord 元信息；另提供本地上传入口（fileToDataUrl 模式，
// 返回文件名 + dataURL 缩略图）。仅供 AI 创建弹窗取参考图元信息（不传像素）。
export function AssetPickerModal({
  open,
  workspaceRoot,
  api,
  onConfirm,
  onUpload,
  onClose,
  t
}: Props): ReactElement | null {
  const [records, setRecords] = useState<ImageAssetRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({})

  useEffect(() => {
    if (!open) return
    setSelectedIds({})
    setError(null)
    if (!api || !workspaceRoot.trim()) {
      setRecords([])
      return
    }
    let alive = true
    setLoading(true)
    api
      .mediaAssetsList({ workspaceRoot: workspaceRoot.trim() })
      .then((result) => {
        if (!alive) return
        if (result.ok) setRecords(result.images)
        else setError(t('canvasWorkflowAssetLoadFailed'))
      })
      .catch(() => {
        if (alive) setError(t('canvasWorkflowAssetLoadFailed'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open, api, workspaceRoot, t])

  const sorted = useMemo(
    () =>
      records
        .filter((record) => record.localPath || record.remoteUrl)
        .slice()
        .sort((a, b) => assetSortWeight(a) - assetSortWeight(b)),
    [records]
  )
  const selectedCount = Object.keys(selectedIds).length

  if (!open) return null

  const toggle = (id: string): void =>
    setSelectedIds((prev) => {
      if (prev[id]) {
        const { [id]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: true }
    })

  const handleConfirm = (): void => {
    onConfirm(sorted.filter((record) => selectedIds[record.id]))
  }

  const handleUploadInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    void Promise.all(
      files.map(async (file) => ({
        name: file.name,
        dataUrl: await fileToDataUrl(
          file,
          (f) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
              reader.onerror = () => reject(reader.error ?? new Error('read failed'))
              reader.readAsDataURL(f)
            })
        )
      }))
    )
      .then((uploads) => onUpload(uploads.filter((upload) => upload.dataUrl)))
      .catch(() => undefined)
  }

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={t('canvasWorkflowAssetPickerTitle')}
      size="lg"
      className="flex max-h-[80vh] flex-col"
    >
      <h2 className="pb-3 text-[15px] font-semibold text-ds-ink">
        {t('canvasWorkflowAssetPickerTitle')}
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <LoadingState lines={3} label={t('canvasWorkflowAssetPickerTitle')} />
        ) : error ? (
          <p role="alert" className="px-1 py-4 text-[12.5px] text-ds-danger">
            {error}
          </p>
        ) : sorted.length === 0 ? (
          <EmptyState icon={Images} title={t('canvasWorkflowAssetPickerEmpty')} />
        ) : (
          <div data-testid="asset-picker-grid" className="grid grid-cols-4 gap-2">
            {sorted.map((record) => (
              <AssetThumb
                key={record.id}
                record={record}
                workspaceRoot={workspaceRoot}
                selected={Boolean(selectedIds[record.id])}
                onToggle={() => toggle(record.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="mt-3 flex shrink-0 items-center gap-2 border-t border-ds-border pt-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-ds-border bg-ds-elevated px-3 py-1.5 text-[12px] font-medium text-ds-ink transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover">
          <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('canvasWorkflowAssetUpload')}
          <input
            type="file"
            accept="image/*"
            multiple
            data-testid="asset-picker-upload-input"
            onChange={handleUploadInput}
            className="hidden"
          />
        </label>
        <span className="flex-1" />
        <Button variant="secondary" size="md" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="md"
          data-testid="asset-picker-confirm"
          disabled={selectedCount === 0}
          onClick={handleConfirm}
        >
          {t('canvasWorkflowAssetPickerConfirm', { count: selectedCount })}
        </Button>
      </footer>
    </Modal>
  )
}
