import { useState, type ReactElement } from 'react'
import { Bot, Check, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { builtinAssistants } from '../../features/assistants'
import { useChatStore } from '../../store/chat-store'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { AssistantDetailModal, type AssistantDetailModel } from './AssistantDetailModal'

/**
 * 侧栏「助手」清单页：卡片式展示内置人设助手。悬停卡片显示「召唤」；
 * 使用中的卡片提供「移除」= 恢复不使用助手（默认态）。
 *
 * 人设助手与设置中的 AI 助手（subagent profiles）是两个概念：本页只
 * 呈现内置 persona，选择是纯前端状态（selectAssistant），随时可切换。
 */

export type AssistantCardModel = {
  id: string
  name: string
  description: string
  riskNote?: string
  inUse: boolean
}

/**
 * Assemble the builtin persona card list. `currentAgentId` marks the card
 * whose persona is currently selected ('' = none selected, no card marked).
 */
export function buildAssistantCards(
  currentAgentId: string,
  translate: (key: string) => string
): AssistantCardModel[] {
  return builtinAssistants.map((definition): AssistantCardModel => ({
    id: definition.id,
    name: translate(definition.nameKey),
    description: translate(definition.descriptionKey),
    riskNote: translate(definition.riskNoteKey),
    inUse: currentAgentId === definition.id
  }))
}

/**
 * Assemble the full detail models used by the detail modal. Same ordering and
 * `inUse` semantics as {@link buildAssistantCards}, plus capability/strengths/
 * examples resolved from their locale keys.
 */
export function buildAssistantDetails(
  currentAgentId: string,
  translate: (key: string) => string
): AssistantDetailModel[] {
  return builtinAssistants.map((definition): AssistantDetailModel => ({
    id: definition.id,
    name: translate(definition.nameKey),
    description: translate(definition.descriptionKey),
    capability: translate(definition.capabilityKey),
    strengths: definition.strengthKeys.map((key) => translate(key)),
    examples: definition.exampleKeys.map((key) => translate(key)),
    riskNote: translate(definition.riskNoteKey),
    inUse: currentAgentId === definition.id
  }))
}

export function AssistantsView({
  leftSidebarCollapsed,
  onToggleLeftSidebar
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const personaAssistantId = useChatStore((s) => s.personaAssistantId)
  const error = useChatStore((s) => s.error)
  const selectAssistant = useChatStore((s) => s.selectAssistant)
  const setRoute = useChatStore((s) => s.setRoute)
  const summonAssistantWithPrompt = useChatStore((s) => s.summonAssistantWithPrompt)
  const [openDetailId, setOpenDetailId] = useState<string | null>(null)

  const details = buildAssistantDetails(personaAssistantId, t)
  const openDetail = openDetailId
    ? details.find((detail) => detail.id === openDetailId) ?? null
    : null

  const handleSummon = async (selectionId: string): Promise<void> => {
    const ok = await selectAssistant(selectionId)
    // 召唤成功回到对话页开聊；失败停留本页，错误由下方提示区显示。
    if (ok) setRoute('chat')
  }

  return (
    <>
      <AssistantsCardsView
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        cards={buildAssistantCards(personaAssistantId, t)}
        storeError={error}
        onSummon={(id) => { void handleSummon(id) }}
        onDismiss={() => { void selectAssistant('') }}
        onOpenDetail={(id) => setOpenDetailId(id)}
      />
      <AssistantDetailModal
        detail={openDetail}
        onClose={() => setOpenDetailId(null)}
        onSummon={(id) => {
          setOpenDetailId(null)
          void handleSummon(id)
        }}
        onDismiss={() => {
          setOpenDetailId(null)
          void selectAssistant('')
        }}
        onAskExample={(id, prompt) => {
          setOpenDetailId(null)
          void summonAssistantWithPrompt(id, prompt)
        }}
      />
    </>
  )
}

export function AssistantsCardsView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  cards,
  storeError,
  onSummon,
  onDismiss,
  onOpenDetail
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  cards: readonly AssistantCardModel[]
  storeError: string | null
  onSummon: (selectionId: string) => void
  onDismiss: () => void
  onOpenDetail: (selectionId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-3xl">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">
                {t('assistantsNavLabel')}
              </h1>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-8">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
          <p className="text-[14px] leading-6 text-ds-faint">{t('assistantsPageSubtitle')}</p>
          {storeError ? (
            <p className="rounded-xl border border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft px-4 py-3 text-[13px] text-ds-danger">
              {storeError}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <AssistantCard
                key={card.id}
                card={card}
                onSummon={onSummon}
                onDismiss={onDismiss}
                onOpenDetail={onOpenDetail}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

function AssistantCard({
  card,
  onSummon,
  onDismiss,
  onOpenDetail
}: {
  card: AssistantCardModel
  onSummon: (selectionId: string) => void
  onDismiss: () => void
  onOpenDetail: (selectionId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={card.name}
      onClick={() => onOpenDetail(card.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDetail(card.id)
        }
      }}
      className={`group relative flex min-h-[132px] cursor-pointer flex-col gap-2 rounded-2xl border bg-ds-card p-4 text-left transition hover:border-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)] hover:shadow-[var(--c360-shadow-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--ds-accent)_55%,transparent)] ${
        card.inUse
          ? 'border-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)]'
          : 'border-ds-border'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-ds-border-muted bg-ds-raised text-ds-muted">
          <Bot className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ds-ink" title={card.name}>
          {card.name}
        </span>
        {card.inUse ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            <Check className="h-3 w-3" strokeWidth={2.2} />
            {t('assistantInUse')}
          </span>
        ) : null}
      </div>
      <p className="min-h-[36px] text-[12.5px] leading-relaxed text-ds-muted">{card.description}</p>
      {card.riskNote ? (
        <p className="text-[11.5px] leading-snug text-ds-faint">{card.riskNote}</p>
      ) : null}
      {/* 悬停浮现的动作区：召唤 / 使用中卡片的移除。键盘可达（focus-within 同样浮现）。 */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-end opacity-0 transition-opacity duration-[var(--motion-fast)] focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        {card.inUse ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDismiss() }}
            className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-raised px-3 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            {t('assistantDismiss')}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSummon(card.id) }}
            aria-label={`${t('assistantSummon')}: ${card.name}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ds-accent)] bg-[image:var(--ds-accent-gradient)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-[var(--ds-accent-gradient-glow)] transition hover:brightness-110"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            {t('assistantSummon')}
          </button>
        )}
      </div>
    </div>
  )
}
