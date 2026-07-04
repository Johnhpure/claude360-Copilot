import type { ReactElement } from 'react'
import { Check, CornerDownLeft, HelpCircle, X } from 'lucide-react'
import type { UserInputOption, UserInputQuestion } from '../../agent/types'
import type { ComposerUserInputController } from './use-composer-user-input'
import { optionsNeedRows, shouldShowQuestionHeader } from './user-input-panel-logic'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * The ask-user input surface, docked directly above the composer. The common
 * single-question case renders as bare chips (no header / progress / dismiss);
 * multi-question asks add a light stepper. Selecting advances and auto-submits
 * on the last question — see {@link ComposerUserInputController}. The timeline
 * keeps the immutable record; this is only the input.
 */
export function FloatingComposerUserInputPanel({
  controller,
  t
}: {
  controller: ComposerUserInputController
  t: Translate
}): ReactElement | null {
  const { currentQuestion, total, index } = controller
  if (!controller.active || !currentQuestion) return null
  const multi = total > 1
  const options = currentQuestion.options
  const hasOptions = options.length > 0
  const useRows = optionsNeedRows(options)
  const showHeader = shouldShowQuestionHeader(currentQuestion, total)

  return (
    <div
      role="group"
      aria-label={t('userInputPanelTitle')}
      className="ds-no-drag absolute inset-x-2 bottom-full z-30 mb-3 overflow-hidden rounded-[26px] border border-[color-mix(in_srgb,var(--ds-accent)_30%,transparent)] bg-ds-elevated p-3.5 shadow-[var(--c360-shadow-overlay)]"
    >
      {multi ? (
        <div className="mb-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <HelpCircle className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
              <span className="truncate text-[13px] font-semibold text-ds-ink">
                {t('userInputPanelTitle')}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11.5px] font-medium text-ds-faint">
                {index + 1}/{total}
              </span>
              <button
                type="button"
                onClick={controller.cancel}
                aria-label={t('userInputCancel')}
                title={t('userInputCancel')}
                className="rounded-lg p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            {controller.questions.map((question, i) => (
              <span
                key={question.id}
                className={`h-[3px] flex-1 rounded-full transition ${
                  controller.isAnswered(question.id) || i === index
                    ? 'bg-accent'
                    : 'bg-ds-border-muted'
                }`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {showHeader ? (
        <div className="mb-1 text-[12px] font-semibold text-ds-muted">{currentQuestion.header}</div>
      ) : null}

      <p className="whitespace-pre-wrap break-words text-[14px] font-semibold leading-6 text-ds-ink [overflow-wrap:anywhere]">
        {currentQuestion.question}
      </p>

      {hasOptions ? (
        useRows ? (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {options.map((option) => (
              <OptionRow
                key={option.label}
                option={option}
                selected={controller.isSelected(currentQuestion.id, option.label)}
                onSelect={() => controller.chooseOption(currentQuestion, option)}
              />
            ))}
          </div>
        ) : (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {options.map((option) => (
              <OptionChip
                key={option.label}
                option={option}
                selected={controller.isSelected(currentQuestion.id, option.label)}
                onSelect={() => controller.chooseOption(currentQuestion, option)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="mt-2.5 flex items-center gap-2 rounded-2xl border border-ds-border-muted bg-ds-card px-3 py-2 text-[12.5px] text-ds-muted">
          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
          <span className="min-w-0">{t('userInputPanelFreeformHint')}</span>
        </div>
      )}

      {hasOptions ? (
        <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ds-faint">
          <CornerDownLeft className="h-3 w-3 shrink-0" strokeWidth={1.9} />
          <span className="min-w-0">{t('userInputPanelCustomHint')}</span>
        </div>
      ) : null}
    </div>
  )
}

function OptionChip({
  option,
  selected,
  onSelect
}: {
  option: UserInputOption
  selected: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={option.description || undefined}
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
        selected
          ? 'border-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)] bg-accent-soft text-ds-ink'
          : 'border-ds-border-muted bg-ds-card text-ds-muted hover:border-ds-border hover:bg-ds-card hover:text-ds-ink'
      }`}
    >
      {selected ? <Check className="h-3 w-3 shrink-0 text-accent" strokeWidth={2.4} /> : null}
      <span className="min-w-0 truncate">{option.label}</span>
    </button>
  )
}

function OptionRow({
  option,
  selected,
  onSelect
}: {
  option: UserInputOption
  selected: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group flex min-w-0 items-start gap-2.5 rounded-[14px] border px-3 py-2 text-left transition ${
        selected
          ? 'border-[color-mix(in_srgb,var(--ds-accent)_40%,transparent)] bg-accent-soft text-ds-ink ring-1 ring-[color-mix(in_srgb,var(--ds-accent)_10%,transparent)]'
          : 'border-ds-border-muted bg-ds-card text-ds-muted hover:border-ds-border hover:bg-ds-card hover:text-ds-ink'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition ${
          selected ? 'border-accent bg-accent-soft' : 'border-ds-border group-hover:border-ds-muted'
        }`}
      >
        {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-[13px] font-semibold [overflow-wrap:anywhere]">
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block break-words text-[12px] leading-5 text-ds-faint [overflow-wrap:anywhere]">
            {option.description}
          </span>
        ) : null}
      </span>
    </button>
  )
}
