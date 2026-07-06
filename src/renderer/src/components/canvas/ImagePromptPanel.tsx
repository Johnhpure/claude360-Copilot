import { useState, type ChangeEvent, type ReactElement } from 'react'
import { Sparkles, RefreshCw, ImagePlus, X } from 'lucide-react'
import {
  CLAUDE360_ASPECT_PRESETS,
  CLAUDE360_IMAGE_OUTPUT_FORMATS,
  CLAUDE360_IMAGE_QUALITIES,
  CLAUDE360_IMAGE_RESOLUTIONS,
  type Claude360ImageOutputFormat,
  type Claude360ImageQuality,
  type Claude360ImageResolution
} from '@shared/claude360-canvas'
import { Button, Card, Select, Textarea } from '../ui'

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

/** 胶囊 chip 组（Calm Blue：小控件走 pill；选中 = accent-soft 底 + accent 字）。 */
function ChipGroup<V extends string>({
  options,
  value,
  label,
  testIdPrefix,
  labelOf,
  onChange
}: {
  options: readonly V[]
  value: V
  label: string
  testIdPrefix: string
  labelOf?: (v: V) => string
  onChange: (v: V) => void
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            data-testid={`${testIdPrefix}-${option}`}
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-[var(--motion-fast)] ${
              active
                ? 'border-ds-accent bg-ds-accent-soft font-semibold text-ds-accent'
                : 'border-ds-border bg-ds-card font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
          >
            {labelOf ? labelOf(option) : option}
          </button>
        )
      })}
    </div>
  )
}

// 文本生图面板：按 Calm Blue focus block 分组（提示词 / 参数 / 操作，阶段4 design §3.1）——
// 提示词卡 = 模型 + prompt + 参考图；参数卡 = 宽高比 + 分辨率 + 张数 + 质量 + 输出格式；
// 操作 = 主生成按钮。控件全部走 components/ui/ 原语与胶囊 chip，无字面量色/圆角/动效。
// 模型下拉只来自 image 模型；无 image 模型时给出刷新入口。全程无独立登录 / API Key 配置。
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
  // 校验时机：默认不判错，仅当用户点击「生成图片」提交后（attempted）才对空 prompt 判红；
  // 用户开始输入有效内容即清除错误态。避免打开面板就显示红框。
  const [attempted, setAttempted] = useState(false)
  const promptEmpty = hasModels && !prompt.trim()
  const promptMissing = attempted && promptEmpty
  const handlePrompt = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    if (attempted && value.trim()) setAttempted(false)
    onChangePrompt(value)
  }
  const handleSubmit = (): void => {
    if (promptEmpty) {
      setAttempted(true)
      return
    }
    onSubmit()
  }
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
    <section data-testid="image-prompt-panel" className="flex min-h-0 flex-col gap-4">
      {/* ── 提示词组（focus block）：标题 + 模型 + prompt + 参考图 ── */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ds-muted" strokeWidth={1.75} aria-hidden />
          <h2 className="text-[14px] font-semibold text-ds-ink">{t('canvasCreateTitle')}</h2>
        </div>

        {/* 模型选择 —— 只来自 image 模型 */}
        {hasModels ? (
          <div data-testid="image-model-select" className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            <span>{t('canvasModelLabel')}</span>
            <Select
              value={model || null}
              options={imageModels.map((m) => ({ value: m, label: m }))}
              onChange={onChangeModel}
              aria-label={t('canvasModelLabel')}
            />
          </div>
        ) : (
          <div
            data-testid="image-no-models"
            className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-dashed border-ds-border bg-ds-main px-3 py-2 text-[12.5px] text-ds-muted"
          >
            <span>{t('canvasNoImageModels')}</span>
            <Button variant="secondary" size="sm" className="shrink-0" onClick={onRefreshModels}>
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              {t('canvasRefreshModels')}
            </Button>
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
          <Textarea
            data-testid="image-prompt-input"
            value={prompt}
            onChange={handlePrompt}
            rows={4}
            placeholder={t('canvasPromptPlaceholder')}
            aria-required="true"
            invalid={promptMissing}
            className="resize-none text-[12.5px]"
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
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-ds-border bg-ds-main p-2"
            >
              <img
                src={referenceImage}
                alt={t('canvasReferenceLabel')}
                className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] border border-ds-border object-cover"
              />
              <span className="flex-1 text-[11.5px] text-ds-faint">{t('canvasReferenceHint')}</span>
              <button
                type="button"
                onClick={onClearReference}
                aria-label={t('canvasReferenceRemove')}
                title={t('canvasReferenceRemove')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-ds-border bg-ds-card text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-ds-border bg-ds-main p-3 transition-colors duration-[var(--motion-fast)] hover:border-ds-accent">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-ds-card text-ds-muted">
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
      </Card>

      {/* ── 参数组（focus block）：宽高比 + 分辨率 + 张数 + 质量 + 输出格式 ── */}
      <Card className="flex flex-col gap-4">
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
                  className={`flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border px-1 py-2 transition-colors duration-[var(--motion-fast)] ${
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

        {/* 分辨率（胶囊 chip）+ 张数 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            <span>{t('canvasResolutionLabel')}</span>
            <ChipGroup
              options={CLAUDE360_IMAGE_RESOLUTIONS}
              value={resolution}
              label={t('canvasResolutionLabel')}
              testIdPrefix="image-resolution"
              onChange={onChangeResolution}
            />
          </div>
          <div data-testid="image-count-select" className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            <span>{t('canvasCountLabel')}</span>
            <Select
              value={String(n)}
              options={['1', '2', '3', '4'].map((c) => ({ value: c, label: c }))}
              onChange={(v) => onChangeCount(Number(v))}
              aria-label={t('canvasCountLabel')}
            />
          </div>
        </div>

        {/* 质量档位（胶囊 chip） */}
        <div className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          <span>{t('canvasQualityLabel')}</span>
          <ChipGroup
            options={CLAUDE360_IMAGE_QUALITIES}
            value={quality}
            label={t('canvasQualityLabel')}
            testIdPrefix="image-quality"
            labelOf={(q) => qualityLabels[q]}
            onChange={onChangeQuality}
          />
        </div>

        {/* 输出格式 */}
        <div data-testid="image-output-format-select" className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          <span>{t('canvasOutputFormatLabel')}</span>
          <Select
            value={outputFormat}
            options={CLAUDE360_IMAGE_OUTPUT_FORMATS.map((f) => ({ value: f, label: f }))}
            onChange={onChangeOutputFormat}
            aria-label={t('canvasOutputFormatLabel')}
          />
        </div>
      </Card>

      {/* ── 操作组：主生成按钮（胶囊 primary，独立于卡片避免空壳） ── */}
      <Button
        variant="primary"
        size="lg"
        data-testid="image-generate-button"
        onClick={handleSubmit}
        disabled={!hasModels}
        loading={generating}
        className="w-full"
      >
        {generating ? null : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        {generating ? t('canvasGenerating') : t('canvasGenerate')}
      </Button>
    </section>
  )
}
