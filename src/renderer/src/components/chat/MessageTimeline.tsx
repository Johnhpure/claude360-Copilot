import type { ReactElement, RefObject } from 'react'
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { deriveTurnSections } from './derive-turn-sections'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import { GeneratedFilesPanel, MessageBubble } from './message-timeline-bubbles'
import { ReviewPlanCard, ReviewSummaryCard, TurnChangeSummary, WorkMetaRow } from './message-timeline-cards'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'
import { TimelineNavigator } from './TimelineNavigator'
import {
  deriveTurnNavItems,
  resolveActiveTurnKey,
  type TurnNavItem
} from './timeline-navigator'
import {
  AnimatedWorkLogo,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  useWorkLogoSwimMode
} from './AnimatedWorkLogo'
import {
  groupTurns,
  sameTurnContent,
  splitThink,
  stableTurnKey,
  type Turn
} from './message-timeline-turns'
import { extractPlanMetadataFromBlock } from '../../plan/plan-tool'
import { InjectedMemoryLookupProvider } from './injected-memory-lookup'
import { planDisplayNameFromRelativePath } from '../../plan/plan-path'

export { summarizeToolBlock } from './message-timeline-process'

type Props = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
  devPreviewCard?: ReactElement | null
  /** Disables the inline Review Plan card's Build action while a turn runs. */
  planActionsBusy?: boolean
  /** Runs the active plan (Build button on the inline Review Plan card). */
  onBuildPlan?: () => void
  /** Opens/focuses the Plan panel (Open button on the inline card). */
  onOpenPlan?: () => void
  compactCards?: boolean
  /**
   * 宿主是否处于「对话」视图（Workbench 本地 conversationView 状态下传）。
   * true 时空态渲染通用 AI 首页（conversation-home），与 Code 开发工作台
   * 在装配层互斥（07-13-code-home-polish R3）。
   */
  conversationHome?: boolean
  /**
   * Opt-in for the right-hand conversation navigator (turn outline +
   * scroll-spy + jump). Only the MAIN chat timeline in `Workbench` sets
   * this; side-panel hosts (write/sdd assistant panels) keep it off —
   * their narrow, differently-positioned containers were never designed
   * to anchor the navigator's absolutely positioned pieces.
   */
  conversationNavigator?: boolean
}

type CompactionTimelineBlock = Extract<ChatBlock, { kind: 'compaction' }>

const TURN_PAGE_SIZE = 18
const AUTO_COLLAPSE_THRESHOLD = 24
/** Scroll-spy anchor line: a turn whose wrapper top sits at or above
 * `scrollTop + this` owns the highlight in the conversation navigator. */
const NAV_SCROLL_SPY_ANCHOR_PX = 120

export function goalTimelinePaddingClass(route: 'chat' | 'claw', hasActiveGoal: boolean): string {
  return route === 'chat' && hasActiveGoal ? 'pb-32 md:pb-40' : 'pb-10'
}

export function liveTurnProgressClass(hasActiveGoal: boolean): string {
  return hasActiveGoal
    ? 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted mb-16 md:mb-20'
    : 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted'
}

function blockScrollStamp(block: ChatBlock | undefined): string {
  if (!block) return ''
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return `${block.id}:${block.kind}:${block.text.length}`
    case 'tool':
      return `${block.id}:${block.kind}:${block.status}:${block.summary.length}:${block.detail?.length ?? 0}`
    case 'review':
      return `${block.id}:${block.kind}:${block.status}:${block.reviewText?.length ?? 0}`
    case 'approval':
    case 'user_input':
    case 'compaction':
      return `${block.id}:${block.kind}:${block.status}`
    default:
      return ''
  }
}

function processBlockHasError(block: ChatBlock): boolean {
  return (
    (block.kind === 'tool' && block.status === 'error') ||
    (block.kind === 'compaction' && block.status === 'error') ||
    (block.kind === 'review' && block.status === 'error') ||
    (block.kind === 'approval' && block.status === 'error') ||
    (block.kind === 'user_input' && block.status === 'error') ||
    (block.kind === 'system' && block.severity === 'error')
  )
}

function compactionDividerLabel(
  block: CompactionTimelineBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (block.status === 'running') return t('compactionRunning')
  if (block.status === 'error') return block.summary || t('compactionFailed')
  return block.auto === true ? t('compactionAutoCompleted') : t('compactionManualCompleted')
}

function CompactionDivider({ block }: { block: CompactionTimelineBlock }): ReactElement {
  const { t } = useTranslation('common')
  const error = block.status === 'error'
  return (
    <div
      role={block.status === 'running' ? 'status' : undefined}
      aria-live={block.status === 'running' ? 'polite' : undefined}
      className="flex w-full items-center gap-4 py-2"
    >
      <span className={`h-px min-w-8 flex-1 ${error ? 'bg-[color-mix(in_srgb,var(--ds-danger)_30%,transparent)]' : 'bg-ds-border-muted'}`} />
      <span
        className={`shrink-0 text-[15px] font-semibold leading-6 ${
          error ? 'text-ds-danger' : 'text-ds-faint'
        }`}
      >
        {compactionDividerLabel(block, t)}
      </span>
      <span className={`h-px min-w-8 flex-1 ${error ? 'bg-[color-mix(in_srgb,var(--ds-danger)_30%,transparent)]' : 'bg-ds-border-muted'}`} />
    </div>
  )
}

export function MessageTimeline({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  compactCards = false,
  conversationHome = false,
  conversationNavigator = false
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const {
    route,
    workspaceRoot,
    codeWorkspaceRoots,
    chooseWorkspace,
    selectWorkspaceRoot,
    activeClawChannel,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThreadGoal,
    activeThread
  } = useTimelineStores(activeThreadId)

  const heroRoute: 'chat' | 'claw' = route === 'claw' ? 'claw' : 'chat'
  const hasContent = blocks.length > 0 || live || liveReasoning
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const turnRefMap = useRef(new Map<string, HTMLDivElement>())

  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const latestBlock = blocks[blocks.length - 1]
  const scrollContentKey = [
    activeThreadId ?? '',
    turns.length,
    blocks.length,
    blockScrollStamp(latestBlock),
    live.length,
    liveReasoning.length
  ].join(':')
  const {
    visibleTurnCount,
    hiddenTurnCount,
    loadEarlierTurns,
    collapseEarlierTurns,
    expandToTurn
  } = useTimelineScroll({
    containerRef,
    endRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    autoCollapseThreshold: AUTO_COLLAPSE_THRESHOLD,
    totalTurns: turns.length,
    busy,
    scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: currentTurnUserId ?? ''
    }
  })
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  // Conversation navigator entries cover EVERY turn (collapsed history
  // included) — jumping into history is the point. Memoized on the turns
  // reference: user titles are fixed once a turn starts, so streaming
  // deltas never recompute this. Hosts without the navigator skip the
  // derivation entirely.
  const navItems = useMemo(
    () =>
      conversationNavigator
        ? deriveTurnNavItems(turns, (turnNumber) => t('timelineNavTurnFallback', { index: turnNumber }))
        : [],
    [conversationNavigator, t, turns]
  )

  // Scroll-spy: highlights the turn owning the anchor line. Runs on a
  // rAF-throttled scroll listener that is deliberately independent of the
  // useTimelineScroll state machine; only an actual activeKey change hits
  // setState, so streaming/scrolling never re-renders the timeline per frame.
  const [activeNavKey, setActiveNavKey] = useState<string | null>(null)
  const navSpyFrameRef = useRef<number | null>(null)
  const measureActiveNavKey = useCallback((): void => {
    navSpyFrameRef.current = null
    const el = containerRef.current
    if (!el) return
    const offsets: { key: string; top: number }[] = []
    turnRefMap.current.forEach((node, key) => {
      offsets.push({ key, top: node.offsetTop })
    })
    const next = resolveActiveTurnKey(offsets, el.scrollTop, NAV_SCROLL_SPY_ANCHOR_PX)
    setActiveNavKey((prev) => (prev === next ? prev : next))
  }, [])

  useEffect(() => {
    if (!conversationNavigator) return
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => {
      if (navSpyFrameRef.current !== null) return
      navSpyFrameRef.current = window.requestAnimationFrame(measureActiveNavKey)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (navSpyFrameRef.current !== null) {
        window.cancelAnimationFrame(navSpyFrameRef.current)
        navSpyFrameRef.current = null
      }
    }
  }, [conversationNavigator, measureActiveNavKey])

  // Re-measure when the mounted turn set changes (thread switch, expand /
  // collapse, new turns) — scroll events alone would miss these.
  useEffect(() => {
    if (!conversationNavigator) return
    measureActiveNavKey()
  }, [conversationNavigator, measureActiveNavKey, activeThreadId, visibleTurnCount, hiddenTurnCount, turns.length])

  // Navigator jump: mounted targets scroll directly; collapsed-history
  // targets expand the window first and scroll once the wrapper ref mounts
  // (effect below picks it up on the visible-window change). BOTH paths go
  // through `expandToTurn` first: for mounted targets the visible window is
  // unchanged (React bails out of the setState), but the call still drops
  // the stick-to-bottom intent so a streaming snap cannot yank the viewport
  // back down mid-jump (design §3.4).
  const pendingNavScrollKeyRef = useRef<string | null>(null)
  const handleNavigate = useCallback(
    (item: TurnNavItem): void => {
      expandToTurn(item.index)
      const mounted = turnRefMap.current.get(item.key)
      if (mounted) {
        mounted.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      pendingNavScrollKeyRef.current = item.key
    },
    [expandToTurn]
  )
  useEffect(() => {
    const key = pendingNavScrollKeyRef.current
    if (!key) return
    const node = turnRefMap.current.get(key)
    if (!node) return
    pendingNavScrollKeyRef.current = null
    node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [visibleTurnCount, hiddenTurnCount])
  // Drop a stale pending jump target when the thread switches.
  useEffect(() => {
    pendingNavScrollKeyRef.current = null
  }, [activeThreadId])
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined

  // Tick a clock while a turn is running so the live "Worked for Xs" updates.
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy || !currentTurnUserId) return
    setTickNow(Date.now())
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, currentTurnUserId])

  return (
    <InjectedMemoryLookupProvider workspaceRoot={workspaceRoot}>
    <div ref={containerRef} className="ds-no-drag relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      <div className={`ds-message-timeline-content ds-chat-column-inset ds-chat-content-max-width mx-auto flex w-full min-w-0 flex-col gap-8 pt-8 ${
        goalTimelinePaddingClass(heroRoute, Boolean(activeThreadGoal))
      }`}>
        {!hasContent || !activeThreadId ? (
          <MessageTimelineEmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            runtimeError={runtimeError}
            activeClawChannel={activeClawChannel}
            codeHome={route === 'chat' && !conversationHome}
            conversationHome={route === 'chat' && conversationHome}
            workspaceRoot={workspaceRoot}
            recentWorkspaceRoots={codeWorkspaceRoots}
            onPickWorkspace={() => void chooseWorkspace()}
            onSelectWorkspaceRoot={(root) => void selectWorkspaceRoot(root)}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
          />
        ) : null}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount > 0 ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', { count: Math.min(hiddenTurnCount, TURN_PAGE_SIZE) })}
            </button>
          </div>
        ) : null}

        {visibleTurns.map((turn, index) => {
          const absoluteTurnIndex = hiddenTurnCount + index
          const userId = turn.user?.id
          const isLive = !!(userId && currentTurnUserId === userId)
          const startedAt = userId ? turnStartedAtByUserId[userId] : undefined
          const recordedDuration = userId ? turnDurationByUserId[userId] : undefined
          const durationMs =
            recordedDuration ??
            (isLive && typeof startedAt === 'number'
              ? Math.max(0, tickNow - startedAt)
              : undefined)
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
          const reasoningLast = userId ? turnReasoningLastAtByUserId[userId] : undefined
          const reasoningDurationMs =
            typeof reasoningFirst === 'number' && typeof reasoningLast === 'number'
              ? Math.max(0, reasoningLast - reasoningFirst)
              : undefined
          const turnPending = threadHasPendingRuntimeWork(turn.blocks)
          const isLatestTurn = index === visibleTurns.length - 1
          const hasLiveStream = isLatestTurn && !!(liveReasoning.trim() || live.trim())
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          const turnKey = stableTurnKey(turn, absoluteTurnIndex)
          return (
            <Fragment key={turnKey}>
              {index > 0 && !showForkPoint ? (
                <div role="presentation" className="timeline-turn-divider" />
              ) : null}
              <div
                ref={(node) => {
                  if (node) {
                    turnRefMap.current.set(turnKey, node)
                  } else {
                    turnRefMap.current.delete(turnKey)
                  }
                }}
                className="scroll-mt-6"
              >
                {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
                <MemoMessageTurn
                  turn={turn}
                  isProcessing={(busy && isLatestTurn) || turnPending || hasLiveStream}
                  liveReasoning={isLatestTurn ? liveReasoning : ''}
                  live={isLatestTurn ? live : ''}
                  durationMs={durationMs}
                  reasoningDurationMs={reasoningDurationMs}
                  devPreviewCard={isLatestTurn ? devPreviewCard : null}
                  planActionsBusy={planActionsBusy}
                  onBuildPlan={onBuildPlan}
                  onOpenPlan={onOpenPlan}
                  viewportRef={containerRef}
                  compactCards={compactCards}
                />
              </div>
            </Fragment>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && turns.length > TURN_PAGE_SIZE && turns.length > AUTO_COLLAPSE_THRESHOLD && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                collapseEarlierTurns()
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineCollapseEarlierTurns')}
            </button>
          </div>
        ) : null}

        {blocks.length === 0 && (live || liveReasoning) ? (
          <MemoMessageTurn
            turn={{ blocks: [] }}
            isProcessing={busy}
            liveReasoning={liveReasoning}
            live={live}
            devPreviewCard={devPreviewCard}
            viewportRef={containerRef}
            compactCards={compactCards}
            durationMs={
              currentTurnUserId && typeof turnStartedAtByUserId[currentTurnUserId] === 'number'
                ? Math.max(0, tickNow - turnStartedAtByUserId[currentTurnUserId])
                : undefined
            }
            reasoningDurationMs={(() => {
              if (!currentTurnUserId) return undefined
              const first = turnReasoningFirstAtByUserId[currentTurnUserId]
              const last = turnReasoningLastAtByUserId[currentTurnUserId]
              if (typeof first !== 'number' || typeof last !== 'number') return undefined
              return Math.max(0, last - first)
            })()}
          />
        ) : null}
        <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
      </div>
    </div>
    {/* Conversation navigator: absolutely positioned sibling of the scroll
        container, anchored to the Workbench's `relative` timeline wrapper —
        top edge sits below the topbar, bottom edge stops above the composer.
        Opt-in via `conversationNavigator` (main chat only; write/sdd side
        panels never set it) and hidden for short chats. */}
    {conversationNavigator && navItems.length >= 2 ? (
      <TimelineNavigator items={navItems} activeKey={activeNavKey} onNavigate={handleNavigate} />
    ) : null}
    </InjectedMemoryLookupProvider>
  )
}

function MessageTurn({
  turn,
  isProcessing,
  liveReasoning,
  live,
  durationMs,
  reasoningDurationMs,
  devPreviewCard,
  planActionsBusy,
  onBuildPlan,
  onOpenPlan,
  viewportRef,
  compactCards = false
}: {
  turn: Turn
  isProcessing: boolean
  liveReasoning: string
  live: string
  durationMs?: number
  reasoningDurationMs?: number
  devPreviewCard?: ReactElement | null
  planActionsBusy?: boolean
  onBuildPlan?: () => void
  onOpenPlan?: () => void
  viewportRef: RefObject<HTMLDivElement | null>
  compactCards?: boolean
}): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadGoal = useChatStore((s) => s.activeThreadGoal)
  const forkThreadFromTurn = useChatStore((s) => s.forkThreadFromTurn)
  const rollbackWorkspaceToCheckpoint = useChatStore((s) => s.rollbackWorkspaceToCheckpoint)
  const [forking, setForking] = useState(false)
  const [rollingBackCheckpointId, setRollingBackCheckpointId] = useState<string | null>(null)
  // Inline Review Plan card: surfaced under a turn that produced a
  // successful `create_plan` result so the user can open/build the plan
  // without leaving the conversation.
  const planResult = useMemo(() => {
    if (isProcessing) return null
    for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
      const block = turn.blocks[index]
      if (block.kind !== 'tool' || block.status !== 'success') continue
      const meta = extractPlanMetadataFromBlock(block)
      if (meta) return meta
    }
    return null
  }, [turn.blocks, isProcessing])
  const { think: liveThink, content: liveContent } = splitThink(live)
  const liveProcessText = [liveReasoning, liveThink].filter(Boolean).join('\n\n')
  const [workExpandedOverride, setWorkExpandedOverride] = useState<boolean | null>(null)

  const { processBlocks, assistantContentBlocks, generatedFileBlocks, turnFileChanges } = useMemo(
    () =>
      deriveTurnSections({
        turn,
        isProcessing,
        liveProcessText,
        liveContent,
        workspaceRoot
      }),
    [turn, isProcessing, liveProcessText, liveContent, workspaceRoot]
  )
  const compactionBlocks = useMemo(
    () => processBlocks.filter((block): block is CompactionTimelineBlock => block.kind === 'compaction'),
    [processBlocks]
  )
  const workProcessBlocks = useMemo(
    () => processBlocks.filter((block) => block.kind !== 'compaction'),
    [processBlocks]
  )
  const onlyCompactionProcess = processBlocks.length > 0 && workProcessBlocks.length === 0
  const hasProcessError = workProcessBlocks.some(processBlockHasError)
  // 运行中遇错锁定展开；回合完成后若仍有错误，默认展开让失败可见，但用户可手动折叠。
  const forceExpandForError = isProcessing && hasProcessError
  const workExpanded = forceExpandForError || (workExpandedOverride ?? (isProcessing || hasProcessError))
  const reviewBlocks = useMemo(
    () => turn.blocks.filter((block) => block.kind === 'review'),
    [turn.blocks]
  )

  const processSections = useMemo(
    () => (workExpanded ? groupProcessSections(workProcessBlocks) : []),
    [workProcessBlocks, workExpanded]
  )
  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
  // Show the live assistant bubble whenever the SSE has streamed any text
  // into `live`. We deliberately do NOT gate on `isProcessing`: the
  // processing indicator (WorkMetaRow above) already covers "the agent is
  // working", and hiding the streaming text here causes real-time updates
  // (Feishu bot streaming) to appear only after turn_completed, which the
  // user perceives as a long delay.
  // Note: `live` is the generic SSE sink output across ALL channels
  // (Kun runtime turns, claw channel replies from feishu/weixin/etc),
  // not feishu-specific. Removing the !isProcessing gate is intentional
  // for all streaming paths, not just feishu.
  const showLiveAssistant = !!liveContent.trim()
  const forkTurnId =
    turn.user?.turnId?.trim() ||
    [...assistantContentBlocks].reverse().find((block) => block.turnId?.trim())?.turnId?.trim() ||
    ''
  const forkActionBlockId =
    !isProcessing && forkTurnId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined
  const rollbackCheckpointId = turn.user?.meta?.workspaceCheckpointId?.trim() ?? ''
  const rollbackActionBlockId =
    !isProcessing && rollbackCheckpointId
      ? assistantContentBlocks[assistantContentBlocks.length - 1]?.id
      : undefined

  // Keep completed reasoning/tool work tucked away, but make the active turn's
  // work visible unless the user explicitly collapses it.

  const hasProcess = (isProcessing && !onlyCompactionProcess) || workProcessBlocks.length > 0
  const showLiveProgress = isProcessing && !onlyCompactionProcess
  const forkFromTurn = async (): Promise<void> => {
    if (!forkTurnId || forking) return
    setForking(true)
    try {
      await forkThreadFromTurn(forkTurnId)
    } finally {
      setForking(false)
    }
  }
  const rollbackWorkspace = async (checkpointId: string): Promise<void> => {
    const targetCheckpointId = checkpointId.trim()
    if (!targetCheckpointId || rollingBackCheckpointId) return
    setRollingBackCheckpointId(targetCheckpointId)
    try {
      await rollbackWorkspaceToCheckpoint(targetCheckpointId)
    } finally {
      setRollingBackCheckpointId(null)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} /> : null}

      {hasProcess ? (
        <div className="flex flex-col gap-1 pb-2">
          <WorkMetaRow
            processing={isProcessing}
            stepCount={workProcessBlocks.length}
            durationMs={durationMs}
            reasoningDurationMs={reasoningDurationMs}
            expanded={workExpanded}
            collapsible={!forceExpandForError}
            onToggle={() => setWorkExpandedOverride((value) => !(value ?? isProcessing))}
          />
          {workExpanded && processSections.length > 0 ? (
            <div className="flex flex-col gap-1">
              {processSections.map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  viewportRef={viewportRef}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {assistantContentBlocks.map((block) => (
        <MessageBubble
          key={block.id}
          block={block}
          forkAction={
            block.id === forkActionBlockId
              ? {
                  busy: forking,
                  onFork: () => {
                    void forkFromTurn()
                  }
                }
              : undefined
          }
          rollbackAction={
            block.id === rollbackActionBlockId
              ? {
                  busy: rollingBackCheckpointId === rollbackCheckpointId,
                  onRollback: () => {
                    void rollbackWorkspace(rollbackCheckpointId)
                  }
                }
              : undefined
          }
        />
      ))}

      {showLiveAssistant ? (
        <MessageBubble block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }} />
      ) : null}

      <GeneratedFilesPanel blocks={generatedFileBlocks} />

      {reviewBlocks.map((review) => (
        <ReviewSummaryCard key={review.id} review={review} />
      ))}

      {showLiveProgress ? <LiveTurnProgressRow hasActiveGoal={Boolean(activeThreadGoal)} /> : null}

      {!isProcessing && devPreviewCard ? devPreviewCard : null}

      {planResult ? (
        <ReviewPlanCard
          title={planResult.title?.trim() || planDisplayNameFromRelativePath(planResult.relativePath)}
          relativePath={planResult.relativePath}
          busy={planActionsBusy === true}
          onOpen={onOpenPlan}
          onBuild={onBuildPlan}
        />
      ) : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary changes={turnFileChanges} viewportRef={viewportRef} compact={compactCards} />
      ) : null}

      {/* The compaction marker renders LAST so "已压缩上下文" sits at the very
          bottom of the turn it belongs to — i.e. the bottom of the latest turn
          when the compaction just happened — rather than wedged between the
          user's question and the assistant's answer. */}
      {compactionBlocks.map((block) => (
        <CompactionDivider key={block.id} block={block} />
      ))}
    </div>
  )
}

function LiveTurnProgressRow({ hasActiveGoal }: { hasActiveGoal: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const swimMode = useWorkLogoSwimMode(true)
  const swimLabelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
  const label = t(swimLabelKey)

  return (
    <div className={liveTurnProgressClass(hasActiveGoal)}>
      <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
        <AnimatedWorkLogo active mode={swimMode} phase="trail" size="sm" />
      </span>
      <span className="ds-shiny-text">{label}</span>
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  sameTurnContent(prev.turn, next.turn) &&
  prev.isProcessing === next.isProcessing &&
  prev.liveReasoning === next.liveReasoning &&
  prev.live === next.live &&
  prev.durationMs === next.durationMs &&
  prev.reasoningDurationMs === next.reasoningDurationMs &&
  prev.devPreviewCard === next.devPreviewCard &&
  prev.planActionsBusy === next.planActionsBusy &&
  prev.onBuildPlan === next.onBuildPlan &&
  prev.onOpenPlan === next.onOpenPlan &&
  prev.compactCards === next.compactCards &&
  prev.viewportRef === next.viewportRef
))
