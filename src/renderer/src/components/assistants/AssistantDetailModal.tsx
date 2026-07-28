import { type ReactElement } from 'react'
import { Bot, Check, MessageSquareText, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '../ui/Modal'

/**
 * 助手详情弹窗：点击助手卡片后展示能力介绍、擅长领域标签与提问示例。
 *
 * 主按钮「召唤」= selectAssistant + 跳对话页；点击任一提问示例 = 召唤该助手
 * 并把该示例填入对话输入框（一次性草稿），随即跳对话页。使用中的助手额外
 * 提供「移除」= 恢复不使用助手（默认态）。
 */

export type AssistantDetailModel = {
  id: string
  name: string
  description: string
  capability: string
  strengths: readonly string[]
  examples: readonly string[]
  riskNote?: string
  inUse: boolean
}

export function AssistantDetailModal({
  detail,
  onClose,
  onSummon,
  onDismiss,
  onAskExample
}: {
  detail: AssistantDetailModel | null
  onClose: () => void
  onSummon: (selectionId: string) => void
  onDismiss: () => void
  onAskExample: (selectionId: string, prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')

  return (
    <Modal
      open={detail !== null}
      onClose={onClose}
      ariaLabel={detail ? detail.name : t('assistantsNavLabel')}
      size="lg"
    >
      {detail ? (
        <AssistantDetailContent
          detail={detail}
          onClose={onClose}
          onSummon={onSummon}
          onDismiss={onDismiss}
          onAskExample={onAskExample}
        />
      ) : null}
    </Modal>
  )
}

/**
 * The modal's presentational body, split out so tests can render it without the
 * portal (node's renderToStaticMarkup can't mount createPortal). The portal-based
 * open state is verified by manual testing, matching the ImageLightbox convention.
 */
export function AssistantDetailContent({
  detail,
  onClose,
  onSummon,
  onDismiss,
  onAskExample
}: {
  detail: AssistantDetailModel
  onClose: () => void
  onSummon: (selectionId: string) => void
  onDismiss: () => void
  onAskExample: (selectionId: string, prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-ds-border-muted bg-ds-raised text-ds-muted">
              <Bot className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ds-ink" title={detail.name}>
                  {detail.name}
                </h2>
                {detail.inUse ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                    <Check className="h-3 w-3" strokeWidth={2.2} />
                    {t('assistantInUse')}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ds-muted">{detail.description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ds-faint">
              {t('assistantDetailCapabilityTitle')}
            </h3>
            <p className="text-[13.5px] leading-relaxed text-ds-ink">{detail.capability}</p>
          </section>

          {detail.strengths.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ds-faint">
                {t('assistantDetailStrengthsTitle')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {detail.strengths.map((strength) => (
                  <span
                    key={strength}
                    className="inline-flex items-center rounded-full border border-ds-border-muted bg-ds-raised px-3 py-1 text-[12.5px] text-ds-muted"
                  >
                    {strength}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {detail.examples.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ds-faint">
                {t('assistantDetailExamplesTitle')}
              </h3>
              <div className="flex flex-col gap-2">
                {detail.examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => onAskExample(detail.id, example)}
                    className="group inline-flex items-center gap-2.5 rounded-xl border border-ds-border bg-ds-card px-3.5 py-2.5 text-left text-[13px] leading-snug text-ds-ink transition hover:border-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)] hover:bg-ds-hover"
                  >
                    <MessageSquareText
                      className="h-4 w-4 shrink-0 text-ds-faint transition group-hover:text-accent"
                      strokeWidth={1.8}
                    />
                    <span className="min-w-0 flex-1">{example}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {detail.riskNote ? (
            <p className="text-[11.5px] leading-snug text-ds-faint">{detail.riskNote}</p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            {detail.inUse ? (
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-raised px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" strokeWidth={2} />
                {t('assistantDismiss')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSummon(detail.id)}
                aria-label={`${t('assistantSummon')}: ${detail.name}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ds-accent)] bg-[image:var(--ds-accent-gradient)] px-4 py-2 text-[13px] font-semibold text-white shadow-[var(--ds-accent-gradient-glow)] transition hover:brightness-110"
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                {t('assistantSummon')}
              </button>
            )}
          </div>
    </div>
  )
}
