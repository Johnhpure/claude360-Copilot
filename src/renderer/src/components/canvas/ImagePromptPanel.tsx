import type { ChangeEvent, ReactElement } from 'react'
import { Loader2, Sparkles, RefreshCw, ImagePlus, X } from 'lucide-react'
import {
  CLAUDE360_ASPECT_PRESETS,
  CLAUDE360_IMAGE_OUTPUT_FORMATS,
  CLAUDE360_IMAGE_QUALITIES,
  CLAUDE360_IMAGE_RESOLUTIONS,
  type Claude360ImageOutputFormat,
  type Claude360ImageQuality,
  type Claude360ImageResolution
} from '@shared/claude360-canvas'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  prompt: string
  model: string
  aspectPreset: string
  resolution: Claude360ImageResolution
  quality: Claude360ImageQuality
  outputFormat: Claude360ImageOutputFormat
  /** 由 aspectPreset + resolution 派生的具体像素串（如 2048x2048），用于预览。 */
  size: string
  n: number
  /** 参考图 dataURL（有值时提交走 editImage，不带 mask）。 */
  referenceImage: string | null
  /** 已过滤好的 image 模型 id 列表。 */
  imageModels: string[]
  generating: boolean
  onChangePrompt: (value: string) => void
  onChangeModel: (value: string) => void
  onChangeAspect: (value: string) => void
  onChangeResolution: (value: Claude360ImageResolution) => void
  onChangeQuality: (value: Claude360ImageQuality) => void
  onChangeOutputFormat: (value: Claude360ImageOutputFormat) => void
  onChangeCount: (value: number) => void
  onPickReference: (file: File) => void
  onClearReference: () => void
  onSubmit: () => void
  onRefreshModels: () => void
  t: TFn
}

// 按 ratio（如 "16:9"）画一个等比小矩形（最大边 24px），作为宽高比图标。
function ratioShapeStyle(ratio: string): { width: string; height: string } {
  const [w, h] = ratio.split(':').map(Number)
  const max = 24
  const rw = w >= h ? max : Math.round((max * w) / h)
  const rh = h >= w ? max : Math.round((max * h) / w)
  return { width: `${rw}px`, height: `${rh}px` }
}

// 文本生图面板（表单）：模型 + prompt + 可选参考图 + 宽高比图标网格 + 分辨率 + 张数 +
// 质量 + 输出格式 + 生成按钮。模型下拉只来自 image 模型；无 image 模型时给出刷新入口。
// 全程无独立登录 / API Key 配置。
export function ImagePromptPanel({
  prompt,
  model,
  aspectPreset,
  resolution,
  quality,
  outputFormat,
  size,
  n,
  referenceImage,
  imageModels,
  generating,
  onChangePrompt,
  onChangeModel,
  onChangeAspect,
  onChangeResolution,
  onChangeQuality,
  onChangeOutputFormat,
  onChangeCount,
  onPickReference,
  onClearReference,
  onSubmit,
  onRefreshModels,
  t
}: Props): ReactElement {
  const hasModels = imageModels.length > 0
  const handlePrompt = (e: ChangeEvent<HTMLTextAreaElement>): void => onChangePrompt(e.target.value)
  const promptMissing = hasModels && !prompt.trim()
  const handleReferenceInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) onPickReference(file)
    e.target.value = ''
  }
  const qualityLabels: Record<Claude360ImageQuality, string> = {
    auto: t('canvasQualityAuto'),
    high: t('canvasQualityHigh'),
    medium: t('canvasQualityMedium'),
    low: t('canvasQualityLow')
  }
  const activePreset = CLAUDE360_ASPECT_PRESETS.find((p) => p.id === aspectPreset) ?? CLAUDE360_ASPECT_PRESETS[0]

  return (
    <section
      data-testid="image-prompt-panel"
      className="flex min-h-0 flex-col gap-4 rounded-2xl border border-ds-border bg-ds-card p-4"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
        <h2 className="text-[14px] font-semibold text-ds-ink">{t('canvasCreateTitle')}</h2>
      </div>

      {/* 模型选择 —— 只来自 image 模型 */}
      {hasModels ? (
        <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          {t('canvasModelLabel')}
          <select
            data-testid="image-model-select"
            value={model}
            onChange={(e) => onChangeModel(e.target.value)}
            className="h-9 rounded-lg border border-ds-border bg-ds-main px-2.5 text-[12.5px] text-ds-ink"
          >
            {imageModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div
          data-testid="image-no-models"
          className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-ds-border bg-ds-main px-3 py-2 text-[12.5px] text-ds-muted"
        >
          <span>{t('canvasNoImageModels')}</span>
          <button
            type="button"
            onClick={onRefreshModels}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ds-border bg-ds-card px-2 py-1 text-[11.5px] text-ds-ink transition hover:bg-ds-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('canvasRefreshModels')}
          </button>
        </div>
      )}

      {/* prompt 输入 */}
      <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
        <span>
          {t('canvasPromptLabel')}
          <span className="text-ds-danger" aria-hidden="true">
            {' '}
            *
          </span>
        </span>
        <textarea
          data-testid="image-prompt-input"
          value={prompt}
          onChange={handlePrompt}
          rows={4}
          placeholder={t('canvasPromptPlaceholder')}
          aria-required="true"
          aria-invalid={promptMissing ? 'true' : undefined}
          className={`resize-none rounded-lg border bg-ds-main px-2.5 py-2 text-[12.5px] text-ds-ink ${promptMissing ? 'border-ds-danger' : 'border-ds-border'}`}
        />
        {promptMissing ? (
          <span role="alert" className="text-[11.5px] text-ds-danger">
            {t('canvasPromptRequired')}
          </span>
        ) : null}
      </label>

      {/* 参考图上传（可选，走 editImage 无 mask） */}
      <div className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
        <span>{t('canvasReferenceLabel')}</span>
        {referenceImage ? (
          <div
            data-testid="image-reference-preview"
            className="flex items-center gap-3 rounded-xl border border-ds-border bg-ds-main p-2"
          >
            <img
              src={referenceImage}
              alt={t('canvasReferenceLabel')}
              className="h-12 w-12 shrink-0 rounded-lg border border-ds-border object-cover"
            />
            <span className="flex-1 text-[11.5px] text-ds-faint">{t('canvasReferenceHint')}</span>
            <button
              type="button"
              onClick={onClearReference}
              aria-label={t('canvasReferenceRemove')}
              title={t('canvasReferenceRemove')}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-ds-border bg-ds-main p-3 transition hover:border-ds-accent">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ds-card text-ds-muted">
              <ImagePlus className="h-4.5 w-4.5" strokeWidth={1.75} />
            </span>
            <span className="flex flex-col">
              <span className="text-[12.5px] font-medium text-ds-ink">{t('canvasReferenceUpload')}</span>
              <span className="text-[11px] text-ds-faint">{t('canvasReferenceHint')}</span>
            </span>
            <input
              type="file"
              accept="image/*"
              data-testid="image-reference-input"
              onChange={handleReferenceInput}
              className="hidden"
            />
          </label>
        )}
      </div>

      {/* 宽高比图标网格 */}
      <div className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
        <span>{t('canvasAspectLabel')}</span>
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={t('canvasAspectLabel')}>
          {CLAUDE360_ASPECT_PRESETS.map((p) => {
            const active = p.id === aspectPreset
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`image-aspect-${p.id}`}
                aria-pressed={active}
                title={`${p.ratio} ${p.name}`}
                onClick={() => onChangeAspect(p.id)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition ${
                  active
                    ? 'border-ds-accent bg-ds-accent-soft text-ds-accent'
                    : 'border-ds-border bg-ds-main text-ds-muted hover:border-ds-accent hover:text-ds-ink'
                }`}
              >
                <span className="grid h-[26px] place-items-center">
                  <span
                    className="rounded-[3px] border-[1.6px] border-current"
                    style={ratioShapeStyle(p.ratio)}
                  />
                </span>
                <span className="text-[11px] font-semibold tabular-nums">{p.ratio}</span>
              </button>
            )
          })}
        </div>
        <span className="text-[11px] text-ds-faint">
          {activePreset.ratio} {activePreset.name} · {resolution} · {size.replace('x', '×')}
        </span>
      </div>

      {/* 分辨率 + 张数 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          {t('canvasResolutionLabel')}
          <div className="inline-flex rounded-lg border border-ds-border bg-ds-main p-0.5" role="group" aria-label={t('canvasResolutionLabel')}>
            {CLAUDE360_IMAGE_RESOLUTIONS.map((r) => (
              <button
                key={r}
                type="button"
                data-testid={`image-resolution-${r}`}
                aria-selected={r === resolution}
                onClick={() => onChangeResolution(r)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[12px] transition ${
                  r === resolution ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'font-medium text-ds-muted'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          {t('canvasCountLabel')}
          <select
            data-testid="image-count-select"
            value={n}
            onChange={(e) => onChangeCount(Number(e.target.value))}
            className="h-9 rounded-lg border border-ds-border bg-ds-main px-2.5 text-[12.5px] text-ds-ink"
          >
            {[1, 2, 3, 4].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 质量档位 */}
      <div className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
        {t('canvasQualityLabel')}
        <div className="inline-flex rounded-lg border border-ds-border bg-ds-main p-0.5" role="group" aria-label={t('canvasQualityLabel')}>
          {CLAUDE360_IMAGE_QUALITIES.map((q) => (
            <button
              key={q}
              type="button"
              data-testid={`image-quality-${q}`}
              aria-selected={q === quality}
              onClick={() => onChangeQuality(q)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[12px] transition ${
                q === quality ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'font-medium text-ds-muted'
              }`}
            >
              {qualityLabels[q]}
            </button>
          ))}
        </div>
      </div>

      {/* 输出格式 */}
      <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
        {t('canvasOutputFormatLabel')}
        <select
          data-testid="image-output-format-select"
          value={outputFormat}
          onChange={(e) => onChangeOutputFormat(e.target.value as Claude360ImageOutputFormat)}
          className="h-9 rounded-lg border border-ds-border bg-ds-main px-2.5 text-[12.5px] text-ds-ink"
        >
          {CLAUDE360_IMAGE_OUTPUT_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        data-testid="image-generate-button"
        onClick={onSubmit}
        disabled={generating || !hasModels}
        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-ds-ink px-4 text-[13px] font-semibold text-ds-main shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        )}
        {generating ? t('canvasGenerating') : t('canvasGenerate')}
      </button>
    </section>
  )
}
