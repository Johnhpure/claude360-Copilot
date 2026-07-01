import type { ChangeEvent, ReactElement } from 'react'
import { Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { CLAUDE360_IMAGE_SIZES, type Claude360ImageSize } from '@shared/claude360-canvas'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  prompt: string
  model: string
  size: Claude360ImageSize
  n: number
  /** 已过滤好的 image 模型 id 列表（由容器用 isClaude360ImageModelId 过滤后传入）。 */
  imageModels: string[]
  generating: boolean
  onChangePrompt: (value: string) => void
  onChangeModel: (value: string) => void
  onChangeSize: (value: Claude360ImageSize) => void
  onChangeCount: (value: number) => void
  onSubmit: () => void
  /** 无 image 模型时刷新模型缓存。 */
  onRefreshModels: () => void
  t: TFn
}

// 文本生图面板（表单）：prompt 输入 + 模型选择 + 尺寸 + 张数 + 生成按钮。
// 模型下拉只来自 image 模型（Task7）；无 image 模型时显示「暂无可用生图模型」+ 刷新按钮，
// 不硬编码 gpt-image-2。全程无独立登录 / API Key 配置。
export function ImagePromptPanel({
  prompt,
  model,
  size,
  n,
  imageModels,
  generating,
  onChangePrompt,
  onChangeModel,
  onChangeSize,
  onChangeCount,
  onSubmit,
  onRefreshModels,
  t
}: Props): ReactElement {
  const hasModels = imageModels.length > 0
  const handlePrompt = (e: ChangeEvent<HTMLTextAreaElement>): void => onChangePrompt(e.target.value)
  // prompt 必填：有可用模型但 prompt 为空时给出就近提示（无模型时另有空态，不叠加）。
  const promptMissing = hasModels && !prompt.trim()

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

      {/* 尺寸 + 张数：稳定尺寸，避免生成态布局跳动 */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          {t('canvasSizeLabel')}
          <select
            data-testid="image-size-select"
            value={size}
            onChange={(e) => onChangeSize(e.target.value as Claude360ImageSize)}
            className="h-9 rounded-lg border border-ds-border bg-ds-main px-2.5 text-[12.5px] text-ds-ink"
          >
            {CLAUDE360_IMAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
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
