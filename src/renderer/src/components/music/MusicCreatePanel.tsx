import type { ChangeEvent, ReactElement } from 'react'
import { Loader2, Music2, Sparkles, Wand2 } from 'lucide-react'
import type { Claude360MusicCreateForm } from '@shared/claude360-music'
import { MODELS, supportsVocalGender } from '../../music/suno-params'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  form: Claude360MusicCreateForm
  submitting: boolean
  onChange: (patch: Partial<Claude360MusicCreateForm>) => void
  onSubmit: () => void
  onOpenLyricsAssistant: () => void
  errors: string[]
  t: TFn
}

// 必填标识：视觉 `*`（红色，aria-hidden）——供必填 label 复用。
function RequiredMark(): ReactElement {
  return (
    <span className="text-ds-danger" aria-hidden="true">
      {' '}
      *
    </span>
  )
}

// 字段级就近错误（role="alert"），未提交或校验通过时不渲染。
function FieldError({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null
  return (
    <span role="alert" className="text-[11.5px] text-ds-danger">
      {message}
    </span>
  )
}

// 创作面板（表单）：segmented control（模式）、switch（纯器乐/自定义）、
// slider（风格权重等）、input/textarea。全程无独立登录 / API Key 配置。
export function MusicCreatePanel({
  form,
  submitting,
  onChange,
  onSubmit,
  onOpenLyricsAssistant,
  errors,
  t
}: Props): ReactElement {
  const isSimple = form.mode === 'simple'
  const handleText =
    (field: keyof Claude360MusicCreateForm) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void =>
      onChange({ [field]: e.target.value } as Partial<Claude360MusicCreateForm>)
  const handleSlider =
    (field: 'styleWeight' | 'weirdness' | 'audioWeight') =>
    (e: ChangeEvent<HTMLInputElement>): void =>
      onChange({ [field]: Number(e.target.value) } as Partial<Claude360MusicCreateForm>)

  // 字段级校验：仅在用户尝试提交（顶部 errors 非空）后展示就近错误，避免初始态即报错。
  const attempted = errors.length > 0
  const descriptionMissing = isSimple && !form.description.trim()
  // 歌词在非纯器乐时必填（标准模式）；简单模式歌词可选。
  const lyricsRequired = !isSimple && !form.instrumental
  const lyricsMissing = lyricsRequired && !form.lyrics.trim()
  const showDescriptionError = attempted && descriptionMissing
  const showLyricsError = attempted && lyricsMissing

  return (
    <section
      data-testid="music-create-panel"
      className="flex min-h-0 flex-col gap-4 rounded-2xl border border-ds-border bg-ds-card p-4"
    >
      <div className="flex items-center gap-2">
        <Music2 className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
        <h2 className="text-[14px] font-semibold text-ds-ink">{t('musicCreateTitle')}</h2>
      </div>

      {/* 模式 radiogroup（原假 ARIA tablist 降级为 radiogroup + radio） */}
      <div
        className="inline-flex rounded-xl border border-ds-border bg-ds-main p-0.5"
        role="radiogroup"
        aria-label={t('musicModeLabel')}
      >
        <button
          type="button"
          role="radio"
          aria-checked={isSimple}
          onClick={() => onChange({ mode: 'simple' })}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] transition ${isSimple ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'font-medium text-ds-muted'}`}
        >
          {t('musicModeSimple')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!isSimple}
          onClick={() => onChange({ mode: 'standard' })}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] transition ${!isSimple ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'font-medium text-ds-muted'}`}
        >
          {t('musicModeStandard')}
        </button>
      </div>

      {/* 模型选择 */}
      <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
        {t('musicModelLabel')}
        <select
          value={form.model}
          onChange={(e) => onChange({ model: e.target.value as Claude360MusicCreateForm['model'] })}
          className="rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12.5px] text-ds-ink"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {isSimple ? (
        <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
          <span>
            {t('musicDescriptionLabel')}
            <RequiredMark />
          </span>
          <textarea
            value={form.description}
            onChange={handleText('description')}
            rows={3}
            placeholder={t('musicDescriptionPlaceholder')}
            aria-required="true"
            aria-invalid={showDescriptionError ? 'true' : undefined}
            className={`resize-none rounded-lg border bg-ds-main px-2.5 py-2 text-[12.5px] text-ds-ink ${showDescriptionError ? 'border-ds-danger' : 'border-ds-border'}`}
          />
          <FieldError message={showDescriptionError ? t('musicPromptRequired') : null} />
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            {t('musicTitleLabel')}
            <input
              value={form.title}
              onChange={handleText('title')}
              placeholder={t('musicTitlePlaceholder')}
              className="rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12.5px] text-ds-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            {t('musicStyleLabel')}
            <input
              value={form.style}
              onChange={handleText('style')}
              placeholder={t('musicStylePlaceholder')}
              className="rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12.5px] text-ds-ink"
            />
          </label>
        </>
      )}

      {/* 歌词 + 歌词助手入口 */}
      <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
        <span className="flex items-center justify-between">
          <span>
            {t('musicLyricsLabel')}
            {lyricsRequired ? <RequiredMark /> : null}
          </span>
          <button
            type="button"
            onClick={onOpenLyricsAssistant}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted hover:text-ds-ink"
          >
            <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('musicLyricsAssistant')}
          </button>
        </span>
        <textarea
          value={form.lyrics}
          onChange={handleText('lyrics')}
          rows={4}
          placeholder={t('musicLyricsPlaceholder')}
          aria-required={lyricsRequired ? 'true' : undefined}
          aria-invalid={showLyricsError ? 'true' : undefined}
          className={`resize-none rounded-lg border bg-ds-main px-2.5 py-2 text-[12.5px] text-ds-ink ${showLyricsError ? 'border-ds-danger' : 'border-ds-border'}`}
        />
        <FieldError message={showLyricsError ? t('musicPromptRequired') : null} />
      </label>

      {/* 纯器乐 switch（轨道 + 白色滑块，role=switch + aria-checked） */}
      <div className="flex items-center justify-between text-[12.5px] text-ds-muted">
        <span>{t('musicInstrumental')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={form.instrumental}
          aria-label={t('musicInstrumentalToggle')}
          onClick={() => onChange({ instrumental: !form.instrumental })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out ${
            form.instrumental ? 'bg-ds-accent' : 'bg-ds-faint'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
              form.instrumental ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {!isSimple ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            <span className="flex items-center justify-between">
              {t('musicStyleWeight')}
              <span className="tabular-nums text-ds-ink" aria-hidden="true">
                {form.styleWeight.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.styleWeight}
              onChange={handleSlider('styleWeight')}
              aria-label={t('musicStyleWeight')}
              className="accent-[color:var(--ds-accent)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            <span className="flex items-center justify-between">
              {t('musicWeirdness')}
              <span className="tabular-nums text-ds-ink" aria-hidden="true">
                {form.weirdness.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={form.weirdness}
              onChange={handleSlider('weirdness')}
              aria-label={t('musicWeirdness')}
              className="accent-[color:var(--ds-accent)]"
            />
          </label>
          {supportsVocalGender(form.model) ? (
            <label className="flex items-center justify-between text-[12.5px] text-ds-muted">
              {t('musicVocalGender')}
              <select
                value={form.vocalGender}
                onChange={(e) => onChange({ vocalGender: e.target.value as Claude360MusicCreateForm['vocalGender'] })}
                className="rounded-lg border border-ds-border bg-ds-main px-2 py-1 text-[12px] text-ds-ink"
              >
                <option value="">{t('musicVocalAuto')}</option>
                <option value="m">{t('musicVocalMale')}</option>
                <option value="f">{t('musicVocalFemale')}</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <ul className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-ds-ink px-4 py-2 text-[13px] font-semibold text-ds-main shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        )}
        {submitting ? t('musicGenerating') : t('musicGenerate')}
      </button>
    </section>
  )
}
