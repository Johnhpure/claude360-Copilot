import type { ChangeEvent, ReactElement } from 'react'
import { Loader2, Music2, Sparkles, Wand2, SlidersHorizontal } from 'lucide-react'
import type { Claude360MusicCreateForm } from '@shared/claude360-music'
import { MODELS, STYLE_PRESETS, supportsVocalGender, supportsVoicePersona } from '../../music/suno-params'

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

// 创作面板（表单）：两模式（一句话生成 / 标准）。全程无独立登录 / API Key 配置。
// - 一句话生成：仅模型 + 一句话描述（custom_mode:false，模型自动扩写风格与歌词）。
// - 标准：标题 + 歌词(含 AI 写词助手) + 曲风(含预设 chips) + 排除风格 + 纯器乐 + 高级参数折叠。
export function MusicCreatePanel({
  form,
  submitting,
  onChange,
  onSubmit,
  onOpenLyricsAssistant,
  errors,
  t
}: Props): ReactElement {
  const isOneshot = form.mode === 'oneshot'
  const handleText =
    (field: keyof Claude360MusicCreateForm) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void =>
      onChange({ [field]: e.target.value } as Partial<Claude360MusicCreateForm>)
  const handleSlider =
    (field: 'styleWeight' | 'weirdness') =>
    (e: ChangeEvent<HTMLInputElement>): void =>
      onChange({ [field]: Number(e.target.value) } as Partial<Claude360MusicCreateForm>)

  // 曲风预设 chips ↔ form.style（逗号分隔串）双向联动（纯前端，迁移自 music-web toggleStyle）。
  const styleParts = form.style.split(',').map((s) => s.trim()).filter(Boolean)
  const toggleStyle = (s: string): void => {
    const next = styleParts.includes(s) ? styleParts.filter((x) => x !== s) : [...styleParts, s]
    onChange({ style: next.join(', ') })
  }

  // 字段级校验：仅在用户尝试提交（顶部 errors 非空）后展示就近错误，避免初始态即报错。
  const attempted = errors.length > 0
  const descriptionMissing = isOneshot && !form.description.trim()
  // 歌词在非纯器乐时必填（标准模式）。
  const lyricsRequired = !isOneshot && !form.instrumental
  const lyricsMissing = lyricsRequired && !form.lyrics.trim()
  const showDescriptionError = attempted && descriptionMissing
  const showLyricsError = attempted && lyricsMissing
  const vocalDisabled = !supportsVocalGender(form.model)
  const descriptionCount = Math.min(form.description.length, 500)

  return (
    <section
      data-testid="music-create-panel"
      className="flex min-h-0 flex-col gap-4 rounded-[18px] border border-white/10 bg-[#090909] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)]"
    >
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-3">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#f5c542]/12 text-[#f5c542]">
          <Music2 className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <h2 className="text-[16px] font-semibold text-ds-ink">{t('musicCreateTitle')}</h2>
      </div>

      {/* 模式 radiogroup：简单 / 标准。 */}
      <div
        className="grid grid-cols-2 rounded-xl border border-white/10 bg-black p-1"
        role="radiogroup"
        aria-label={t('musicModeLabel')}
      >
        <button
          type="button"
          role="radio"
          aria-checked={isOneshot}
          onClick={() => onChange({ mode: 'oneshot' })}
          className={`rounded-lg px-3 py-2 text-[12.5px] transition ${isOneshot ? 'bg-[#202020] font-semibold text-[#f5c542] shadow-sm' : 'font-medium text-ds-muted hover:text-ds-ink'}`}
        >
          {t('musicModeOneshot')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!isOneshot}
          onClick={() => onChange({ mode: 'standard' })}
          className={`rounded-lg px-3 py-2 text-[12.5px] transition ${!isOneshot ? 'bg-[#202020] font-semibold text-[#f5c542] shadow-sm' : 'font-medium text-ds-muted hover:text-ds-ink'}`}
        >
          {t('musicModeStandard')}
        </button>
      </div>

      {isOneshot ? (
        /* 简单模式：描述 + 可选歌词 */
        <>
          <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
            <span className="flex items-center justify-between">
              <span>
                {t('musicDescriptionLabel')}
                <RequiredMark />
              </span>
              <span className="text-[11px] tabular-nums text-ds-faint">{descriptionCount} / 500</span>
            </span>
            <textarea
              value={form.description}
              maxLength={500}
              onChange={handleText('description')}
              rows={4}
              placeholder={t('musicDescriptionPlaceholder')}
              aria-required="true"
              aria-invalid={showDescriptionError ? 'true' : undefined}
              className={`resize-none rounded-xl border bg-black/70 px-3 py-2.5 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#f5c542]/70 ${showDescriptionError ? 'border-ds-danger' : 'border-white/10'}`}
            />
            <FieldError message={showDescriptionError ? t('musicPromptRequired') : null} />
          </label>

          <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
            <span className="flex items-center justify-between gap-2">
              <span>{t('musicLyricsLabel')}</span>
              <button
                type="button"
                onClick={onOpenLyricsAssistant}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11.5px] text-ds-muted transition hover:border-[#f5c542]/40 hover:text-[#f5c542]"
              >
                <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t('musicLyricsAssistant')}
              </button>
            </span>
            <textarea
              value={form.lyrics}
              disabled={form.instrumental}
              onChange={handleText('lyrics')}
              rows={5}
              placeholder={t('musicLyricsPlaceholder')}
              className="resize-none rounded-xl border border-white/10 bg-black/70 px-3 py-2.5 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[#f5c542]/70 disabled:cursor-not-allowed disabled:opacity-45"
            />
            <span className="text-[11px] text-ds-faint">{form.instrumental ? t('musicInstrumentalHint') : t('musicLyricsOptionalHint')}</span>
          </label>
        </>
      ) : (
        /* 标准模式 */
        <>
          <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
            {t('musicTitleLabel')}
            <input
              value={form.title}
              onChange={handleText('title')}
              placeholder={t('musicTitlePlaceholder')}
              className="rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-[#f5c542]/70"
            />
          </label>

          {/* 歌词 + AI 写词助手入口 */}
          <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
            <span className="flex items-center justify-between">
              <span>
                {t('musicLyricsLabel')}
                {lyricsRequired ? <RequiredMark /> : null}
              </span>
              <button
                type="button"
                onClick={onOpenLyricsAssistant}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[11.5px] text-ds-muted transition hover:border-[#f5c542]/40 hover:text-[#f5c542]"
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
              className={`resize-none rounded-xl border bg-black/70 px-3 py-2.5 text-[13px] leading-5 text-ds-ink outline-none placeholder:text-ds-faint focus:border-[#f5c542]/70 ${showLyricsError ? 'border-ds-danger' : 'border-white/10'}`}
            />
            <FieldError message={showLyricsError ? t('musicPromptRequired') : null} />
          </label>

          {/* 曲风 / 风格 + 预设 chips */}
          <div className="flex flex-col gap-2 text-[12.5px] text-ds-muted">
            <span>{t('musicStyleLabel')}</span>
            <input
              value={form.style}
              onChange={handleText('style')}
              placeholder={t('musicStylePlaceholder')}
              className="rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-[#f5c542]/70"
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('musicStylePresetsLabel')}>
              {STYLE_PRESETS.map((s) => {
                const active = styleParts.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStyle(s)}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                      active
                        ? 'border-[#f5c542]/60 bg-[#f5c542]/12 font-semibold text-[#f5c542]'
                        : 'border-white/10 bg-black/50 text-ds-muted hover:text-ds-ink'
                    }`}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 排除风格 negative_tags（曲风下方） */}
          <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
            {t('musicNegativeTagsLabel')}
            <input
              value={form.negativeTags}
              onChange={handleText('negativeTags')}
              placeholder={t('musicNegativeTagsPlaceholder')}
              className="rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[13px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-[#f5c542]/70"
            />
          </label>

          {/* 高级参数（折叠）：第一排 vocal_gender → style_weight → weirdness → persona */}
          <details className="overflow-hidden rounded-xl border border-white/10 bg-black/55">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] font-medium text-ds-ink">
              <SlidersHorizontal className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.75} />
              {t('musicAdvancedTitle')}
            </summary>
            <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
              {/* 第一排：人声性别 */}
              <label className="flex items-center justify-between text-[12.5px] text-ds-muted">
                <span>
                  {t('musicVocalGender')}
                  {vocalDisabled ? <span className="ml-1 text-ds-faint">{t('musicVocalGenderHint')}</span> : null}
                </span>
                <select
                  value={form.vocalGender}
                  disabled={vocalDisabled}
                  onChange={(e) =>
                    onChange({ vocalGender: e.target.value as Claude360MusicCreateForm['vocalGender'] })
                  }
                  className="rounded-lg border border-white/10 bg-[#111] px-2 py-1 text-[12px] text-ds-ink disabled:opacity-50"
                >
                  <option value="">{t('musicVocalAuto')}</option>
                  <option value="f">{t('musicVocalFemale')}</option>
                  <option value="m">{t('musicVocalMale')}</option>
                </select>
              </label>

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

              {/* 角色音色 Persona */}
              <label className="flex flex-col gap-1 text-[12.5px] text-ds-muted">
                <span>
                  {t('musicPersonaLabel')}
                  {!supportsVoicePersona(form.model) ? (
                    <span className="ml-1 text-ds-faint">{t('musicPersonaHint')}</span>
                  ) : null}
                </span>
                <input
                  value={form.personaId}
                  onChange={handleText('personaId')}
                  placeholder={t('musicPersonaPlaceholder')}
                  className="rounded-lg border border-white/10 bg-[#111] px-2.5 py-1.5 text-[12px] text-ds-ink"
                />
              </label>
            </div>
          </details>
        </>
      )}

      {/* 纯器乐 switch */}
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/55 px-3 py-2.5 text-[12.5px] text-ds-muted">
        <span>{t('musicInstrumental')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={form.instrumental}
          aria-label={t('musicInstrumentalToggle')}
          onClick={() => onChange({ instrumental: !form.instrumental })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out ${
            form.instrumental ? 'bg-[#f5c542]' : 'bg-white/[0.18]'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
              form.instrumental ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* 模型选择 */}
      <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
        {t('musicModelLabel')}
        <select
          value={form.model}
          onChange={(e) => onChange({ model: e.target.value as Claude360MusicCreateForm['model'] })}
          className="rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-[12.5px] text-ds-ink outline-none focus:border-[#f5c542]/70"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

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
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#f5c542] px-4 py-2.5 text-[13.5px] font-semibold text-black shadow-[0_14px_34px_rgba(245,197,66,0.22)] transition hover:bg-[#ffd866] disabled:cursor-not-allowed disabled:bg-[#5c512e] disabled:text-white/55 disabled:shadow-none"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        )}
        {submitting ? t('musicGenerating') : t('musicGenerateTwo')}
      </button>
      <p className="text-center text-[11px] leading-4 text-ds-faint">{t('musicGenerateHint')}</p>
    </section>
  )
}
