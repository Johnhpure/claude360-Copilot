import type { ChangeEvent, ReactElement } from 'react'
import { ImagePlus, Loader2, Wand2 } from 'lucide-react'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  editPrompt: string
  /** 已上传源图的 dataURL（预览用）；空表示尚未上传。 */
  sourceDataUrl: string
  editing: boolean
  hasModels: boolean
  onChangePrompt: (value: string) => void
  onPickFile: (file: File) => void
  onSubmit: () => void
  t: TFn
}

// 图片编辑面板：上传源图 → 编辑 prompt → 编辑按钮。控件稳定尺寸避免布局跳动。
export function ImageEditorPanel({
  editPrompt,
  sourceDataUrl,
  editing,
  hasModels,
  onChangePrompt,
  onPickFile,
  onSubmit,
  t
}: Props): ReactElement {
  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) onPickFile(file)
  }
  const handlePrompt = (e: ChangeEvent<HTMLTextAreaElement>): void => onChangePrompt(e.target.value)
  const canEdit = Boolean(sourceDataUrl) && Boolean(editPrompt.trim()) && hasModels && !editing

  return (
    <section
      data-testid="image-editor-panel"
      className="flex min-h-0 flex-col gap-4 rounded-2xl border border-ds-border bg-ds-card p-4"
    >
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
        <h2 className="text-[14px] font-semibold text-ds-ink">{t('canvasEditTitle')}</h2>
      </div>

      {/* 上传源图（renderer 端读 File→dataURL，不用 Node API）。源图必填。 */}
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-ds-main p-4 text-[12.5px] text-ds-muted transition hover:bg-ds-hover ${
          sourceDataUrl ? 'border-ds-border' : 'border-ds-danger'
        }`}
      >
        {sourceDataUrl ? (
          <img
            data-testid="image-editor-preview"
            src={sourceDataUrl}
            alt={t('canvasEditTitle')}
            className="max-h-40 w-auto rounded-lg object-contain"
          />
        ) : (
          <>
            <ImagePlus className="h-5 w-5" strokeWidth={1.75} />
            <span>
              {t('canvasUploadImage')}
              <span className="text-ds-danger" aria-hidden="true">
                {' '}
                *
              </span>
            </span>
          </>
        )}
        <input
          data-testid="image-editor-file-input"
          type="file"
          accept="image/*"
          aria-required="true"
          aria-invalid={sourceDataUrl ? undefined : 'true'}
          onChange={handleFile}
          className="hidden"
        />
      </label>

      <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
        <span>
          {t('canvasEditPromptLabel')}
          <span className="text-ds-danger" aria-hidden="true">
            {' '}
            *
          </span>
        </span>
        <textarea
          data-testid="image-editor-prompt"
          value={editPrompt}
          onChange={handlePrompt}
          rows={3}
          placeholder={t('canvasEditPromptPlaceholder')}
          aria-required="true"
          className="resize-none rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[12.5px] text-ds-ink"
        />
      </label>

      {!sourceDataUrl ? (
        <p role="alert" className="text-[11.5px] text-ds-danger">
          {t('canvasEditNeedsImage')}
        </p>
      ) : null}

      <button
        type="button"
        data-testid="image-edit-button"
        onClick={onSubmit}
        disabled={!canEdit}
        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-4 text-[13px] font-semibold text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {editing ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Wand2 className="h-4 w-4" strokeWidth={1.75} />
        )}
        {editing ? t('canvasEditing') : t('canvasEditGenerate')}
      </button>
    </section>
  )
}
