import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Bot, Check, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import {
  builtinAssistants,
  isCustomAssistantEligible
} from '../../features/assistants'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

/**
 * 侧栏「助手」清单页：卡片式展示通用助手、6 个内置助手和合法自定义助手。
 * 悬停卡片显示「召唤」；召唤成功后回到对话页并以该助手开始（复用
 * selectAssistant 的全部校验、创建与失败保护语义）。使用中的助手卡片
 * 提供「移除」= 切回通用助手。本页不引入第二套 persona 状态。
 */

export type AssistantCardModel = {
  id: string
  name: string
  description: string
  riskNote?: string
  group: 'general' | 'builtin' | 'custom'
  inUse: boolean
}

/**
 * Assemble the card list: general first, then builtins, then eligible custom
 * profiles — same eligibility rule as the resolver and the composer picker.
 * `currentAgentId` marks the card whose assistant the chat surface is using
 * (active thread persona, or the pending composer selection).
 */
export function buildAssistantCards(
  profiles: readonly KunSubagentProfileV1[],
  currentAgentId: string,
  translate: (key: string) => string
): AssistantCardModel[] {
  const cards: AssistantCardModel[] = [
    {
      id: '',
      name: translate('assistantNameGeneral'),
      description: translate('assistantGeneralDescription'),
      group: 'general',
      inUse: currentAgentId === ''
    },
    ...builtinAssistants.map((definition): AssistantCardModel => ({
      id: definition.id,
      name: translate(definition.nameKey),
      description: translate(definition.descriptionKey),
      riskNote: translate(definition.riskNoteKey),
      group: 'builtin',
      inUse: currentAgentId === definition.id
    })),
    ...profiles.filter(isCustomAssistantEligible).map((profile): AssistantCardModel => ({
      id: profile.id,
      name: profile.name.trim() || profile.id,
      description: profile.description?.trim() ?? '',
      group: 'custom',
      inUse: currentAgentId === profile.id
    }))
  ]
  return cards
}

export function AssistantsView({
  leftSidebarCollapsed,
  onToggleLeftSidebar
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const composerAgentId = useChatStore((s) => s.composerAgentId)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const busy = useChatStore((s) => s.busy)
  const hasPendingWork = useChatStore((s) => threadHasPendingRuntimeWork(s.blocks))
  const error = useChatStore((s) => s.error)
  const selectAssistant = useChatStore((s) => s.selectAssistant)
  const setRoute = useChatStore((s) => s.setRoute)
  const [profiles, setProfiles] = useState<KunSubagentProfileV1[]>([])
  const [profilesError, setProfilesError] = useState(false)
  const summoningRef = useRef(false)

  const loadProfiles = useCallback(async (force = false): Promise<void> => {
    try {
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: force })
      setProfiles(settings.agents?.kun?.subagents?.profiles ?? [])
      setProfilesError(false)
    } catch {
      setProfilesError(true)
    }
  }, [])

  useEffect(() => { void loadProfiles(true) }, [loadProfiles])

  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null
  const currentAgentId = activeThread ? activeThread.agentId?.trim() ?? '' : composerAgentId

  const handleSummon = async (selectionId: string): Promise<void> => {
    if (summoningRef.current) return
    summoningRef.current = true
    try {
      const ok = await selectAssistant(selectionId)
      // 召唤成功回到对话页开聊；失败停留本页，错误由下方提示区显示。
      if (ok) setRoute('chat')
    } finally {
      summoningRef.current = false
    }
  }

  const handleDismiss = async (): Promise<void> => {
    // 「移除」当前助手 = 切回通用助手；有 active thread 时由 selectAssistant
    // 在同 workspace 新建通用空会话，正是「继续使用正常的方式」。
    if (summoningRef.current) return
    summoningRef.current = true
    try {
      await selectAssistant('')
    } finally {
      summoningRef.current = false
    }
  }

  return (
    <AssistantsCardsView
      leftSidebarCollapsed={leftSidebarCollapsed}
      onToggleLeftSidebar={onToggleLeftSidebar}
      cards={buildAssistantCards(profiles, currentAgentId, t)}
      profilesError={profilesError}
      busy={busy}
      hasPendingWork={hasPendingWork}
      storeError={error}
      onSummon={(id) => { void handleSummon(id) }}
      onDismiss={() => { void handleDismiss() }}
      onRetryProfiles={() => { void loadProfiles(true) }}
    />
  )
}

export function AssistantsCardsView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  cards,
  profilesError,
  busy,
  hasPendingWork,
  storeError,
  onSummon,
  onDismiss,
  onRetryProfiles
}: {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  cards: readonly AssistantCardModel[]
  profilesError: boolean
  busy: boolean
  hasPendingWork: boolean
  storeError: string | null
  onSummon: (selectionId: string) => void
  onDismiss: () => void
  onRetryProfiles: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const switchBlockedReason = busy
    ? t('assistantSwitchBlockedBusy')
    : hasPendingWork
      ? t('assistantSwitchBlockedPending')
      : ''
  const customCards = cards.filter((card) => card.group === 'custom')
  const primaryCards = cards.filter((card) => card.group !== 'custom')

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
          {switchBlockedReason ? (
            <p className="rounded-xl border border-ds-border bg-ds-card px-4 py-3 text-[13px] text-ds-muted">
              {switchBlockedReason}
            </p>
          ) : null}
          {storeError ? (
            <p className="rounded-xl border border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft px-4 py-3 text-[13px] text-ds-danger">
              {storeError}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {primaryCards.map((card) => (
              <AssistantCard
                key={card.id || 'general'}
                card={card}
                disabled={Boolean(switchBlockedReason)}
                onSummon={onSummon}
                onDismiss={onDismiss}
              />
            ))}
          </div>

          {customCards.length > 0 || profilesError ? (
            <>
              <h2 className="mt-2 text-[13px] font-medium uppercase tracking-wide text-ds-faint">
                {t('assistantMyGroup')}
              </h2>
              {profilesError ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-4 py-3">
                  <span className="min-w-0 flex-1 text-[13px] text-ds-danger">
                    {t('assistantMyGroupLoadFailed')}
                  </span>
                  <button
                    type="button"
                    onClick={onRetryProfiles}
                    className="shrink-0 rounded-lg border border-ds-border px-2.5 py-1 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  >
                    {t('assistantMyGroupRetry')}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {customCards.map((card) => (
                    <AssistantCard
                      key={card.id}
                      card={card}
                      disabled={Boolean(switchBlockedReason)}
                      onSummon={onSummon}
                      onDismiss={onDismiss}
                    />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function AssistantCard({
  card,
  disabled,
  onSummon,
  onDismiss
}: {
  card: AssistantCardModel
  disabled: boolean
  onSummon: (selectionId: string) => void
  onDismiss: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className={`group relative flex min-h-[132px] flex-col gap-2 rounded-2xl border bg-ds-card p-4 transition hover:border-[color-mix(in_srgb,var(--ds-accent)_45%,transparent)] hover:shadow-[var(--c360-shadow-overlay)] ${
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
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-end opacity-0 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        {card.inUse ? (
          card.id !== '' ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onDismiss}
              className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-raised px-3 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {t('assistantDismiss')}
            </button>
          ) : null
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSummon(card.id)}
            aria-label={`${t('assistantSummon')}: ${card.name}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ds-accent)] bg-[image:var(--ds-accent-gradient)] px-3.5 py-1.5 text-[12.5px] font-semibold text-white shadow-[var(--ds-accent-gradient-glow)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            {t('assistantSummon')}
          </button>
        )}
      </div>
    </div>
  )
}
