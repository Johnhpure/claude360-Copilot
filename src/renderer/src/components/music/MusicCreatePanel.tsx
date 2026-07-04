import type { ChangeEvent, ReactElement } from 'react'
import { Music2, Sparkles, Wand2, SlidersHorizontal } from 'lucide-react'
import type { Claude360MusicCreateForm } from '@shared/claude360-music'
import { MODELS, STYLE_PRESETS, supportsVocalGender, supportsVoicePersona } from '../../music/suno-params'
import { Button, Card, Input, Select, Textarea } from '../ui'

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

// 必填标识：视觉 `*`（error 色，aria-hidden）——供必填 label 复用。
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

// AI 写词助手入口（胶囊 chip，Button secondary 小号）。
function LyricsAssistantButton({ onClick, t }: { onClick: () => void; t: TFn }): ReactElement {
  return (
    <Button variant="secondary" size="sm" className="h-7 px-2 text-[11.5px]" onClick={onClick}>
      <Wand2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      {t('musicLyricsAssistant')}
    </Button>
  )
}

// 创作面板（阶段4 迁移）：控件全走 components/ui/ 原语与胶囊 chip，Card 分组
// （创作卡 = 模式 + 描述/歌词/曲风；参数卡 = 纯器乐 + 模型 + 高级参数），无字面量色/圆角/动效。
// 两模式（一句话生成 / 标准）逻辑不变。全程无独立登录 / API Key 配置。
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
    <section data-testid="music-create-panel" className="flex min-h-0 flex-col gap-4">
      {/* ── 创作组（focus block）：标题 + 模式 + 描述/歌词/曲风 ── */}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-ds-accent-soft text-ds-accent">
            <Music2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="text-[14px] font-semibold text-ds-ink">{t('musicCreateTitle')}</h2>
        </div>

        {/* 模式 radiogroup：简单 / 标准（分段控件） */}
        <div
          className="grid grid-cols-2 rounded-[var(--radius-md)] border border-ds-border bg-ds-main p-1"
          role="radiogroup"
          aria-label={t('musicModeLabel')}
        >
          {(['oneshot', 'standard'] as const).map((mode) => {
            const active = form.mode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ mode })}
                className={`rounded-[var(--radius-sm)] px-3 py-2 text-[12.5px] transition-colors duration-[var(--motion-fast)] ${
                  active
                    ? 'bg-ds-card font-semibold text-ds-accent shadow-[var(--c360-shadow-sm)]'
                    : 'font-medium text-ds-muted hover:text-ds-ink'
                }`}
              >
                {mode === 'oneshot' ? t('musicModeOneshot') : t('musicModeStandard')}
              </button>
            )
          })}
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
              <Textarea
                value={form.description}
                maxLength={500}
                onChange={handleText('description')}
                rows={4}
                placeholder={t('musicDescriptionPlaceholder')}
                aria-required="true"
                invalid={showDescriptionError}
                className="resize-none"
              />
              <FieldError message={showDescriptionError ? t('musicPromptRequired') : null} />
            </label>

            <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
              <span className="flex items-center justify-between gap-2">
                <span>{t('musicLyricsLabel')}</span>
                <LyricsAssistantButton onClick={onOpenLyricsAssistant} t={t} />
              </span>
              <Textarea
                value={form.lyrics}
                disabled={form.instrumental}
                onChange={handleText('lyrics')}
                rows={5}
                placeholder={t('musicLyricsPlaceholder')}
                className="resize-none"
              />
              <span className="text-[11px] text-ds-faint">
                {form.instrumental ? t('musicInstrumentalHint') : t('musicLyricsOptionalHint')}
              </span>
            </label>
          </>
        ) : (
          /* 标准模式 */
          <>
            <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
              {t('musicTitleLabel')}
              <Input
                value={form.title}
                onChange={handleText('title')}
                placeholder={t('musicTitlePlaceholder')}
              />
            </label>

            {/* 歌词 + AI 写词助手入口 */}
            <label className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
              <span className="flex items-center justify-between">
                <span>
                  {t('musicLyricsLabel')}
                  {lyricsRequired ? <RequiredMark /> : null}
                </span>
                <LyricsAssistantButton onClick={onOpenLyricsAssistant} t={t} />
              </span>
              <Textarea
                value={form.lyrics}
                onChange={handleText('lyrics')}
                rows={4}
                placeholder={t('musicLyricsPlaceholder')}
                aria-required={lyricsRequired ? 'true' : undefined}
                invalid={showLyricsError}
                className="resize-none"
              />
              <FieldError message={showLyricsError ? t('musicPromptRequired') : null} />
            </label>

            {/* 曲风 / 风格 + 预设 chips（胶囊） */}
            <div className="flex flex-col gap-2 text-[12.5px] text-ds-muted">
              <span>{t('musicStyleLabel')}</span>
              <Input
                value={form.style}
                onChange={handleText('style')}
                placeholder={t('musicStylePlaceholder')}
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
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors duration-[var(--motion-fast)] ${
                        active
                          ? 'border-ds-accent bg-ds-accent-soft font-semibold text-ds-accent'
                          : 'border-ds-border bg-ds-main text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
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
              <Input
                value={form.negativeTags}
                onChange={handleText('negativeTags')}
                placeholder={t('musicNegativeTagsPlaceholder')}
              />
            </label>
          </>
        )}
      </Card>

      {/* ── 参数组（focus block）：纯器乐 + 模型 + 高级参数 ── */}
      <Card className="flex flex-col gap-4">
        {/* 纯器乐 switch（One UI 式蓝色胶囊开关） */}
        <div className="flex items-center justify-between text-[12.5px] text-ds-muted">
          <span>{t('musicInstrumental')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={form.instrumental}
            aria-label={t('musicInstrumentalToggle')}
            onClick={() => onChange({ instrumental: !form.instrumental })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[var(--motion-fast)] ${
              form.instrumental ? 'bg-accent' : 'bg-ds-subtle'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[var(--c360-shadow-sm)] transition-transform duration-[var(--motion-fast)] ${
                form.instrumental ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* 模型选择 */}
        <div className="flex flex-col gap-1.5 text-[12.5px] text-ds-muted">
          <span>{t('musicModelLabel')}</span>
          <Select
            value={form.model}
            options={MODELS.map((m) => ({ value: m.value, label: m.label }))}
            onChange={(v) => onChange({ model: v as Claude360MusicCreateForm['model'] })}
            aria-label={t('musicModelLabel')}
          />
        </div>

        {/* 高级参数（折叠，标准模式）：vocal_gender → style_weight → weirdness → persona */}
        {!isOneshot ? (
          <details className="overflow-hidden rounded-[var(--radius-md)] border border-ds-border bg-ds-main">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] font-medium text-ds-ink">
              <SlidersHorizontal className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.75} aria-hidden />
              {t('musicAdvancedTitle')}
            </summary>
            <div className="flex flex-col gap-3 px-3 pb-3 pt-1">
              {/* 人声性别 */}
              <div className="flex items-center justify-between gap-3 text-[12.5px] text-ds-muted">
                <span>
                  {t('musicVocalGender')}
                  {vocalDisabled ? <span className="ml-1 text-ds-faint">{t('musicVocalGenderHint')}</span> : null}
                </span>
                <Select
                  value={form.vocalGender}
                  options={[
                    { value: '', label: t('musicVocalAuto') },
                    { value: 'f', label: t('musicVocalFemale') },
                    { value: 'm', label: t('musicVocalMale') }
                  ]}
                  disabled={vocalDisabled}
                  onChange={(v) => onChange({ vocalGender: v as Claude360MusicCreateForm['vocalGender'] })}
                  aria-label={t('musicVocalGender')}
                  className="w-28"
                />
              </div>

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
                <Input
                  value={form.personaId}
                  onChange={handleText('personaId')}
                  placeholder={t('musicPersonaPlaceholder')}
                />
              </label>
            </div>
          </details>
        ) : null}
      </Card>

      {errors.length > 0 ? (
        <ul className="rounded-[var(--radius-md)] border border-ds-danger bg-ds-danger-soft px-3 py-2 text-[12px] text-ds-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {/* ── 操作：主生成按钮（胶囊 primary，独立于卡片避免空壳） ── */}
      <Button
        variant="primary"
        size="lg"
        onClick={onSubmit}
        loading={submitting}
        className="w-full"
      >
        {submitting ? null : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        {submitting ? t('musicGenerating') : t('musicGenerateTwo')}
      </Button>
      <p className="text-center text-[11px] leading-4 text-ds-faint">{t('musicGenerateHint')}</p>
    </section>
  )
}
