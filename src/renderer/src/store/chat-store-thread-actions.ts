import type { ReviewTarget } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError, getRuntimeErrorCode } from '../lib/format-runtime-error'
import { claude360GroupForSelection, ensureGroupKeyForSelection } from '../lib/group-key-ensure'
import { createPerfTrace } from '../lib/perf-trace'
import { useGroupKeyPromptStore } from './group-key-prompt-store'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import {
  markThreadWorktree,
  saveThreadWorktreeRegistry
} from '../lib/thread-worktree-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import {
  buildClawRuntimePrompt,
  buildCodeRuntimePrompt
} from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  activeClawChannel,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  composerModeForThread,
  readThreadComposerMode,
  rememberCodeWorkspaceRoots,
  rememberThreadComposerSelection,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadHasPendingRuntimeWork,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  activeWriteThreadForWorkspace,
  forgetWriteThread,
  hydrateWriteThreadRegistry,
  isWriteThreadId,
  markWriteThread,
  pruneWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry,
  writeThreadBelongsToWorkspace,
  writeWorkspaceForThreadId
} from '../write/write-thread-registry'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  looksLikeActiveTurnError,
  readActiveWriteWorkspace,
  readWriteWorkspaceRoots,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import {
  composerSelectionForThread,
  ensureRuntimeProviderForSend,
  fallbackComposerProviderIdForSend,
  subscribeThreadEventsWithRecovery
} from './chat-store-thread-action-helpers'
import {
  buildPersonaRuntimePrompt,
  isValidPersonaSelectionId,
  personaPromptForSelection,
  storePersonaAssistantId
} from '../features/assistants'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let drainingQueuedMessages = false
const checkpointGitUnavailableWorkspaces = new Set<string>()

export function createThreadActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'createThread' | 'createConversation' | 'selectAssistant' | 'recoverActiveTurn' | 'selectThread' | 'subscribeThreadEventsLive' | 'drainQueuedMessages' | 'removeQueuedMessage' | 'sendMessage' | 'reviewActiveThread'> {
  return {
  createThread: async (options = {}) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    try {
      const p = getProvider()
      const settings = await rendererRuntimeClient.getSettings()
      const activeThread = get().activeThreadId
        ? get().threads.find((thread) => thread.id === get().activeThreadId)
        : null

      // 对话会话:不绑定项目文件夹,在 conversationWorkspaceRoot 下自动创建
      // 一个时间戳子目录作为工作目录(主进程负责实际建目录)。
      if (options.conversation) {
        if (typeof window.kunGui === 'undefined' || typeof window.kunGui.createConversationWorkspace !== 'function') {
          set({ error: i18n.t('common:workspacePickerUnavailable') })
          return
        }
        const created = await window.kunGui.createConversationWorkspace(
          settings.conversationWorkspaceRoot || undefined
        )
        if (!created.ok || !created.path) {
          set({ error: created.error || i18n.t('common:worktreeAcquireFailed') })
          return
        }
        const t = await p.createThread({
          workspace: created.path,
          title: getDefaultThreadTitle(),
          mode: 'agent'
        })
        set((s) => ({
          activeThreadId: t.id,
          threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
        }))
        await get().selectThread(t.id)
        await get().refreshThreads()
        return
      }

      let workspaceRoot =
        normalizeWorkspaceRoot(options.workspaceRoot) ||
        (activeThread && !isInternalTemporaryWorkspace(activeThread.workspace)
          ? normalizeWorkspaceRoot(activeThread.workspace)
          : '') ||
        normalizeWorkspaceRoot(settings.workspaceRoot)
      if (!workspaceRoot) {
        await get().chooseWorkspace({ createThreadAfter: true })
        return
      }
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
      set({ codeWorkspaceRoots })
      // Worktree pool mode always needs a fresh thread bound to a fresh pool
      // slot, so never reuse an existing main-workspace thread in that case.
      const reusableThreadId = options.forceNew || options.useWorktreePool
        ? null
        : await findReusableEmptyThreadId(
            get(),
            p,
            workspaceRoot,
            (thread) => isCodeThread(thread, get().clawChannels)
          )
      if (reusableThreadId) {
        if (get().activeThreadId !== reusableThreadId) {
          await get().selectThread(reusableThreadId)
        } else {
          set({ error: null })
        }
        return
      }
      // Worktree mode: checkout the selected branch into an isolated worktree
      // and bind the new thread to that workspace.
      let acquiredWorktree: { projectPath: string; path: string; branch: string } | null = null
      if (options.useWorktreePool) {
        try {
          let branch = options.worktreeBranch?.trim() ?? ''
          if (!branch) {
            const branches = await window.kunGui.getGitBranches(workspaceRoot)
            if (branches.ok) branch = branches.currentBranch ?? ''
          }
          if (!branch) {
            throw new Error(i18n.t('common:worktreeBranchRequired'))
          }
          const wt = await window.kunGui.checkoutGitBranchWorktree(workspaceRoot, branch)
          if (!wt.ok) {
            throw new Error(wt.message)
          }
          acquiredWorktree = {
            projectPath: wt.sourceRepositoryRoot,
            path: wt.worktreePath,
            branch: wt.currentBranch ?? branch
          }
          workspaceRoot = wt.worktreePath
        } catch (err) {
          set({ error: err instanceof Error ? err.message : i18n.t('common:worktreeAcquireFailed') })
          return
        }
      }
      const t = await p.createThread({
        workspace: workspaceRoot,
        title: getDefaultThreadTitle(),
        mode: 'agent'
      })
      // Register + activate optimistically before refreshing. A freshly created
      // Kun thread may not be listed until the first message is written.
      // Setting it active first lets refreshThreads preserve it in the sidebar.
      set((s) => ({
        activeThreadId: t.id,
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(
          s.codeWorkspaceRoots,
          [acquiredWorktree?.projectPath ?? workspaceRoot]
        ),
        threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
      }))
      await get().selectThread(t.id)
      if (acquiredWorktree) {
        saveThreadWorktreeRegistry(
          markThreadWorktree(t.id, {
            projectPath: acquiredWorktree.projectPath,
            worktreePath: acquiredWorktree.path,
            branch: acquiredWorktree.branch,
            createdAt: new Date().toISOString()
          })
        )
      }
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  createConversation: async () => {
    await get().createThread({ conversation: true })
  },

  selectAssistant: async (selectionId) => {
    // 人设助手是纯前端状态：选择/移除只改 personaAssistantId 并持久化，
    // 不新建线程、不写线程字段、不受运行状态限制——下一条消息按轮注入
    // persona 提示词即生效，因此任何时刻都可以切换。
    const trimmedSelection = selectionId.trim()
    if (!isValidPersonaSelectionId(trimmedSelection)) {
      set({
        error: i18n.t('common:assistantUnavailableForNewThread', {
          assistantId: trimmedSelection
        })
      })
      return false
    }
    storePersonaAssistantId(trimmedSelection)
    set({ personaAssistantId: trimmedSelection, error: null })
    return true
  },

  recoverActiveTurn: async () => {
    const state = get()
    if (!state.activeThreadId) return false
    const { activeThreadId } = state
    const p = getProvider()
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    set({ error: runtimeStreamRecoveringMessage() })
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos
      } = await p.getThreadDetail(activeThreadId)
      const loaded = hydrateBlockModelLabels(activeThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus)
      // The server has settled but a tool/approval/user_input block may still be
      // open (e.g. a delegate_task interrupted by a runtime restart). Settle it,
      // otherwise threadHasPendingRuntimeWork stays true and the queued message
      // we are recovering re-queues forever instead of draining (KunAgent/Kun#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? state.currentTurnUserId ?? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const currentTurnId = busy ? state.currentTurnId ?? latestTurnId ?? null : null

      set((s) => ({
        activeThreadId,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        lastSeq: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: busy ? runtimeStreamRecoveringMessage() : null,
        busy,
        currentTurnId,
        currentTurnUserId,
        turnDurationByUserId,
        queuedMessages: s.queuedMessages
      }))

      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: latestSeq })
      void p.subscribeThreadEvents(activeThreadId, latestSeq, sink, ac.signal)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        resetBusyRecoveryAttempts()
        if (get().queuedMessages.length > 0) {
          void get().drainQueuedMessages()
        }
      }
      return busy
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      if (state.busy) armBusyWatchdog(set, get)
      return state.busy
    }
  },

  selectThread: async (id) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const prevId = get().activeThreadId
    const prevBusy = get().busy
    let nextWatch = { ...get().watchTurnCompletion }
    delete nextWatch[id]
    clearWatchedCompletionNotification(id)
    if (prevId && prevId !== id && prevBusy) {
      nextWatch[prevId] = true
      watchTurnCompletionNotification(prevId)
    }
    const nextUnread = { ...get().unreadThreadIds }
    delete nextUnread[id]

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    const p = getProvider()
    try {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        usage: threadUsage,
        relation: threadRelation,
        parentThreadId: threadParentId,
        model: threadModel,
        goal,
        todos
      } = await p.getThreadDetail(id)
      // A subagent's `side` thread has no locally-stored per-turn model labels
      // (it was never sent through the composer). Backfill the user blocks with
      // the child thread's resolved model so the session shows "which model",
      // matching the main conversation. Safe: a child runs on a single model.
      const labeledBlocks =
        threadRelation === 'side' && threadModel
          ? rawBlocks.map((block) =>
              block.kind === 'user' && !block.modelLabel
                ? { ...block, modelLabel: threadModel }
                : block
            )
          : rawBlocks
      const loaded = hydrateBlockModelLabels(id, labeledBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so selecting the thread doesn't keep it wedged (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const threadSnap = get().threads.find((thread) => thread.id === id) ?? null
      const composerSelection = composerSelectionForThread(get(), threadSnap)
      const composerMode = composerModeForThread(threadSnap, readThreadComposerMode(id))
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        activeThreadRelation: threadRelation ?? 'primary',
        activeThreadParentId: threadParentId ?? null,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        lastSeq: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        inspectorSelectedId: null,
        queuedMessages: [],
        composerMode,
        ...(composerSelection
          ? {
              composerModel: composerSelection.model,
              composerProviderId: composerSelection.providerId
            }
          : {})
      })
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: id, signal: ac.signal, sinceSeq: latestSeq })
      subscribeThreadEventsWithRecovery(p, id, latestSeq, sink, ac.signal, get)
      if (busy) armBusyWatchdog(set, get)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  subscribeThreadEventsLive: async (threadId) => {
    if (get().runtimeConnection !== 'ready') return
    const targetThreadId = threadId.trim()
    if (!targetThreadId) return
    // Live-only entry point for claw channel events (e.g. Feishu / Lark
    // bot replies). Three things happen in parallel:
    //   1. Synchronously switch the chat view to this thread + mark busy
    //      so the user sees the bot's deltas arrive as they stream in,
    //      not blocked by the HTTP fetch.
    //   2. Open the SSE stream immediately with `sinceSeq: 0` to capture
    //      any deltas that arrive during the fetch window.
    //   3. Pre-fetch the thread's persisted history so the user is not
    //      left staring at an empty view if the thread had prior turns.
    // On fetch success we merge the persisted blocks into the store
    // while preserving the liveAssistant/liveReasoning buffers (which
    // may have accumulated SSE deltas during the fetch) and bumping
    // `lastSeq` to `Math.max(fetched, current)` so no deltas are lost.
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    const p = getProvider()
    const prevState = get()
    // Same-thread case: keep the existing blocks/lastSeq so the user does
    // not see the view blank out for a turn that is already streaming.
    // Cross-thread case: start empty (the fetch will populate history).
    const keepExistingBlocks = prevState.activeThreadId === targetThreadId
    resetBusyRecoveryAttempts()
    clearBusyWatchdog()
    set({
      activeThreadId: targetThreadId,
      blocks: keepExistingBlocks ? prevState.blocks : [],
      lastSeq: keepExistingBlocks ? prevState.lastSeq : 0,
      liveReasoning: '',
      liveAssistant: '',
      unreadThreadIds: { ...prevState.unreadThreadIds, [targetThreadId]: false },
      busy: true,
      currentTurnId: null,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      inspectorSelectedId: null,
      queuedMessages: []
    })
    const ac = new AbortController()
    sseAbortRef.current = ac
    const sink = buildThreadEventSink(set, get, { threadId: targetThreadId, signal: ac.signal, sinceSeq: 0 })
    subscribeThreadEventsWithRecovery(p, targetThreadId, 0, sink, ac.signal, get)
    armBusyWatchdog(set, get)
    // Pre-fetch persisted history in parallel. The SSE is already open
    // and may have started accumulating deltas; the merge step below
    // must not stomp on those buffers.
    try {
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos
      } = await p.getThreadDetail(targetThreadId)
      if (ac.signal.aborted) return
      const loaded = hydrateBlockModelLabels(targetThreadId, rawBlocks)
      const busy = threadSnapshotLooksRunning(loaded, threadStatus)
      // Settle blocks left open by an interrupted turn when the server has
      // already settled, so the thread doesn't stay wedged on load (#621).
      const blocks = busy ? loaded : settlePendingRuntimeWorkAfterInterrupt(loaded)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      set((s) => ({
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        blocks,
        // Bump lastSeq to the max of fetched and current so deltas
        // received during the fetch window are not lost.
        lastSeq: Math.max(latestSeq, s.lastSeq),
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnDurationByUserId
        // Note: `liveAssistant` and `liveReasoning` are intentionally
        // NOT touched here. They may contain deltas that arrived during
        // the fetch and must be preserved for `flushLiveBlocks` to pick
        // them up at turn boundaries.
      }))
      if (!busy && get().queuedMessages.length > 0) {
        void get().drainQueuedMessages()
      }
    } catch (e) {
      // Fetch failure: keep the SSE open so the user still sees the
      // streaming deltas, but surface the error in the UI.
      if (ac.signal.aborted) return
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  drainQueuedMessages: async () => {
    if (drainingQueuedMessages) return
    drainingQueuedMessages = true
    try {
      while (true) {
        const state = get()
        const queuedMessages = state.queuedMessages.filter((message) => !message.guiPlan)
        if (queuedMessages.length !== state.queuedMessages.length) {
          set({ queuedMessages })
        }
        const next = queuedMessages[0]
        if (!next || state.busy) return
        const started = await get().sendMessage(next.text, next.mode, { queued: next })
        if (!started) return
      }
    } finally {
      drainingQueuedMessages = false
    }
  },

  removeQueuedMessage: (id) =>
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id)
    })),

  sendMessage: async (text, mode, overrides) => {
    const trimmedText = text.trim()
    if (!trimmedText) return false
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    // [perf:chat] 分阶段耗时打点（07-05 首次对话慢排查）：enter→optimistic-ui→
    // key-ensured→thread-ready→provider+checkpoint→request-sent→first-stream-event。
    const perf = createPerfTrace('chat')
    const p = getProvider()
    if (get().route === 'write') {
      const writeThreadId = await get().ensureWriteThreadForWorkspace()
      if (!writeThreadId) return false
    }
    const hasPendingActiveTurn = threadHasPendingRuntimeWork(get().blocks)
    if (get().busy || hasPendingActiveTurn) {
      if (overrides?.guiPlan) {
        set({ error: i18n.t('common:composerQueuePlaceholder') })
        return false
      }
      const now = Date.now()
      const activeThreadId = get().activeThreadId
      const threadSnap = activeThreadId
        ? get().threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const clawModel = activeClawChannel(get())?.model
      const overrideModel = overrides?.model?.trim()
      const composerModel =
        overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
      const composerProviderId =
        overrides?.providerId?.trim() || fallbackComposerProviderIdForSend(get())
      const userModelChip =
        overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
      const displayText = overrides?.displayText?.trim()
      const reasoningEffort = overrides?.reasoningEffort?.trim()
      const attachmentIds = overrides?.attachmentIds?.filter((id) => id.trim().length > 0)
      const attachments = overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0)
      const fileReferences = overrides?.fileReferences?.filter((reference) =>
        reference.path.trim().length > 0 &&
        reference.relativePath.trim().length > 0 &&
        reference.name.trim().length > 0
      )
      set((s) => ({
        queuedMessages: [
          ...s.queuedMessages,
          {
            id: `q-${now}-${s.queuedMessages.length}`,
            text: trimmedText,
            ...(displayText ? { displayText } : {}),
            ...(mode ? { mode } : {}),
            ...(composerModel ? { model: composerModel } : {}),
            ...(composerProviderId ? { providerId: composerProviderId } : {}),
            ...(userModelChip ? { modelLabel: userModelChip } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(overrides?.guiPlan ? { guiPlan: overrides.guiPlan } : {}),
            ...(attachmentIds?.length ? { attachmentIds } : {}),
            ...(attachments?.length ? { attachments } : {}),
            ...(fileReferences?.length ? { fileReferences } : {})
          }
        ],
        error: null
      }))
      // UI/runtime can briefly drift (busy=false while runtime still has an active turn).
      // Kick recovery so queued input drains as soon as the in-flight turn settles.
      if (!get().busy && hasPendingActiveTurn) {
        void get().recoverActiveTurn()
      }
      return true
    }
    const now = Date.now()
    const queued = overrides?.queued
    const userBlockId = queued?.id ?? `u-${now}`
    const attachmentIds =
      queued?.attachmentIds ??
      overrides?.attachmentIds?.filter((id) => id.trim().length > 0) ??
      []
    const attachments =
      queued?.attachments ??
      overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0) ??
      []
    const fileReferences =
      queued?.fileReferences ??
      overrides?.fileReferences?.filter((reference) =>
        reference.path.trim().length > 0 &&
        reference.relativePath.trim().length > 0 &&
        reference.name.trim().length > 0
      ) ??
      []
    let activeThreadId = get().activeThreadId
    const displayText = queued?.displayText ?? overrides?.displayText?.trim() ?? trimmedText
    const userDisplayText = displayText !== trimmedText ? displayText : undefined
    const generatedTitle = deriveThreadTitleFromPrompt(displayText)
    const shouldAutoRenameForRoute = get().route === 'chat'
    const activeThread = activeThreadId
      ? get().threads.find((thread) => thread.id === activeThreadId) ?? null
      : null
    let shouldRenameThreadAfterSend =
      shouldAutoRenameForRoute &&
      !!activeThreadId &&
      get().blocks.every((block) => block.kind !== 'user') &&
      shouldAutoTitleThread(activeThread)
    const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
    const clawModel = activeClawChannel(get())?.model
    const overrideModel = overrides?.model?.trim()
    const composerModel =
      queued?.model ?? overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
    const composerProviderId =
      queued?.providerId ?? overrides?.providerId?.trim() ?? fallbackComposerProviderIdForSend(get())
    const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    const previousBlocks = get().blocks
    const previousActiveThreadId = get().activeThreadId
    const previousLastSeq = get().lastSeq
    const previousCurrentTurnId = get().currentTurnId
    const previousCurrentTurnUserId = get().currentTurnUserId
    const previousTurnStartedAtByUserId = get().turnStartedAtByUserId
    const previousTurnDurationByUserId = get().turnDurationByUserId
    const previousTurnReasoningFirstAtByUserId = get().turnReasoningFirstAtByUserId
    const previousTurnReasoningLastAtByUserId = get().turnReasoningLastAtByUserId
    // 乐观发送失败的统一回滚（审查 I1）。queuedMessages 一律函数式合并：失败前的
    // 网络窗口内用户可能又排队了新消息，整体覆盖快照会静默吞掉它们——只把本次
    // drain 的 queued 消息（若尚不在队列）放回队首。
    // keepThread=true 用于已进入线程阶段的失败（事件订阅可能已活跃）：不回滚
    // activeThreadId/lastSeq，且只摘除本次乐观痕迹，保留并发写入的 blocks/计时。
    const rollbackOptimisticSend = (opts?: {
      keepThread?: boolean
      error?: string | null
      openAgentsSettings?: boolean
    }): void => {
      set((s) => {
        const { [userBlockId]: _startedAt, ...turnStartedWithoutUser } = s.turnStartedAtByUserId
        const { [userBlockId]: _duration, ...turnDurationWithoutUser } = s.turnDurationByUserId
        const { [userBlockId]: _reasoningFirst, ...turnReasoningFirstWithoutUser } =
          s.turnReasoningFirstAtByUserId
        const { [userBlockId]: _reasoningLast, ...turnReasoningLastWithoutUser } =
          s.turnReasoningLastAtByUserId
        const nextQueuedMessages =
          queued && !s.queuedMessages.some((message) => message.id === queued.id)
            ? [queued, ...s.queuedMessages]
            : s.queuedMessages
        return {
          busy: false,
          ...(opts?.keepThread
            ? {
                blocks: s.blocks.filter((block) => block.id !== userBlockId),
                turnStartedAtByUserId: turnStartedWithoutUser,
                turnDurationByUserId: turnDurationWithoutUser,
                turnReasoningFirstAtByUserId: turnReasoningFirstWithoutUser,
                turnReasoningLastAtByUserId: turnReasoningLastWithoutUser,
                currentTurnId: previousCurrentTurnId,
                currentTurnUserId: previousCurrentTurnUserId
              }
            : {
                // 线程阶段之前失败：订阅未建立、无并发写入者，整体回快照安全。
                activeThreadId: previousActiveThreadId,
                lastSeq: previousLastSeq,
                blocks: previousBlocks,
                currentTurnId: previousCurrentTurnId,
                currentTurnUserId: previousCurrentTurnUserId,
                turnStartedAtByUserId: previousTurnStartedAtByUserId,
                turnDurationByUserId: previousTurnDurationByUserId,
                turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
                turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId
              }),
          queuedMessages: nextQueuedMessages,
          ...(opts?.error !== undefined ? { error: opts.error } : {}),
          ...(opts?.openAgentsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        }
      })
    }
    resetBusyRecoveryAttempts()
    set((s) => ({
      busy: true,
      blocks: [
        ...s.blocks,
        {
          kind: 'user' as const,
          id: userBlockId,
          createdAt: new Date(now).toISOString(),
          text: displayText,
          ...(userModelChip ? { modelLabel: userModelChip } : {}),
          ...(userDisplayText || attachmentIds.length || attachments.length || fileReferences.length
            ? {
                meta: {
                  ...(userDisplayText ? { displayText: userDisplayText } : {}),
                  ...(attachmentIds.length ? { attachmentIds } : {}),
                  ...(attachments.length ? { attachments } : {}),
                  ...(fileReferences.length ? { fileReferences } : {})
                }
              }
            : {})
        }
      ],
      liveReasoning: '',
      liveAssistant: '',
      error: null,
      currentTurnUserId: userBlockId,
      turnStartedAtByUserId: { ...s.turnStartedAtByUserId, [userBlockId]: now },
      queuedMessages: queued ? s.queuedMessages.filter((message) => message.id !== queued.id) : s.queuedMessages
    }))
    perf.mark('optimistic-ui')
    // 执行时按所选分组确保有 Key：无则弹「需要创建分组 Key」模态，确认→自动创建 Key→
    // 续跑本次发送；取消/失败→回滚乐观 UI 并中止（调用方据返回 false 恢复草稿）。
    // 07-05 重排：检测从入口移到乐观 UI 之后——keyList/ensure 的网络往返不再挡住首帧
    // 反馈；同分组短 TTL 缓存进一步跳过重复检测（见 group-key-ensure.ts）。
    // provider 解析必须与实际发送一致（queued 优先），否则 drain 队列时会检测错分组。
    // 分组名优先取分组清单里的 label（服务端原始名）：中文分组的 providerId 带指纹，
    // 从 id 反解会失配（见 claude360GroupForSelection）。
    const groupForKey = claude360GroupForSelection(get().composerModelGroups, composerProviderId)
    if (groupForKey && typeof window.kunGui?.claude360TokensList === 'function') {
      const keyReady = await ensureGroupKeyForSelection(
        groupForKey,
        {
          listTokens: () => window.kunGui.claude360TokensList(),
          ensureUsableKey: async (g) => {
            await window.kunGui.claude360TokensEnsure({ group: g, purpose: 'text' })
            rendererRuntimeClient.invalidateSettings()
            return true
          },
          promptCreateAndEnsure: (g) => useGroupKeyPromptStore.getState().open(g)
        },
        {
          feature: get().route === 'write' ? '写作' : 'Code',
          model: composerModel,
          providerId: composerProviderId
        }
      )
      perf.mark('key-ensured')
      if (!keyReady) {
        // 用户取消/建 Key 失败：完整回滚乐观 UI；不置 error——主动取消不是错误。
        rollbackOptimisticSend()
        perf.done('aborted:key-not-ready')
        return false
      }
    }
    if (!activeThreadId) {
      try {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          rollbackOptimisticSend({ error: i18n.t('common:workspaceRequiredToCreateThread') })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = await findReusableEmptyThreadId(
          get(),
          p,
          workspaceRoot,
          (thread) => isCodeThread(thread, get().clawChannels)
        )
        const reusableThread = reusableThreadId
          ? get().threads.find((thread) => thread.id === reusableThreadId) ?? null
          : null
        shouldRenameThreadAfterSend =
          shouldAutoRenameForRoute &&
          reusableThreadId != null && shouldAutoTitleThread(reusableThread)
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: generatedTitle,
                // Provisional first-message title; let the backend LLM titler upgrade it.
                titleAuto: true,
                mode: mode ?? 'agent'
              })
            : null
        const threadId = reusableThreadId ?? createdThread?.id ?? null
        if (!threadId) {
          throw new Error('Failed to resolve target thread id.')
        }
        activeThreadId = threadId
        if (composerModel) {
          rememberThreadComposerSelection(threadId, composerModel, composerProviderId)
        }
        set((s) => ({
          activeThreadId: threadId,
          // Freshly created threads are always primary — clear any side-session
          // relation carried over from the previously active thread.
          activeThreadRelation: 'primary',
          activeThreadParentId: null,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
        void get().refreshThreads()
      } catch (e) {
        void window.kunGui.logError('create-thread', 'Failed to create thread', {
          message: e instanceof Error ? e.message : String(e)
        }).catch(() => undefined)
        rollbackOptimisticSend({
          error: formatRuntimeError(e),
          openAgentsSettings: shouldOpenSettingsForError(e)
        })
        return false
      }
    }
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    try {
      perf.mark('thread-ready')
      const seqAtSend = get().lastSeq
      const channel = get().route === 'claw' ? activeClawChannel(get()) : null
      if (!channel && composerModel) {
        rememberThreadComposerSelection(activeThreadId, composerModel, composerProviderId)
      }
      // 07-05 并行化：provider 配置与 Git checkpoint 无数据依赖（checkpoint 是本地
      // git 操作，只读 workspaceRoot；provider 切换即使触发 restartRuntime 也互不影响），
      // 原先串行 await 白白叠加两段耗时。checkpoint 自取 settings（workspaceRoot 不受
      // provider 切换影响）；prompt 用的 settings 在并行结束后重取——
      // ensureRuntimeProviderForSend 可能 saveSettings+invalidate，语义与原串行一致。
      const createCheckpointIfEligible = async (): Promise<string | undefined> => {
        const checkpointSettings = await rendererRuntimeClient.getSettings()
        let workspaceCheckpointId: string | undefined
        const checkpointThread = get().threads.find((thread) => thread.id === activeThreadId)
        const checkpointWorkspaceRoot = normalizeWorkspaceRoot(checkpointThread?.workspace) || normalizeWorkspaceRoot(checkpointSettings.workspaceRoot)
        const checkpointWorkspaceKey = checkpointWorkspaceRoot.replaceAll('\\', '/').toLowerCase()
        if (
          checkpointWorkspaceRoot &&
          !checkpointGitUnavailableWorkspaces.has(checkpointWorkspaceKey) &&
          typeof window.kunGui.createGitCheckpoint === 'function'
        ) {
          const checkpoint = await window.kunGui.createGitCheckpoint({
            workspaceRoot: checkpointWorkspaceRoot,
            threadId: activeThreadId
          }).catch((error) => ({
            ok: false as const,
            reason: 'error' as const,
            message: error instanceof Error ? error.message : String(error)
          }))
          if (checkpoint.ok) {
            workspaceCheckpointId = checkpoint.checkpointId
          } else if (checkpoint.reason !== 'not_git_repo' && checkpoint.reason !== 'no_workspace') {
            if (checkpoint.reason === 'git_unavailable') {
              checkpointGitUnavailableWorkspaces.add(checkpointWorkspaceKey)
            }
            void window.kunGui.logError(
              'git-checkpoint',
              checkpoint.reason === 'git_unavailable'
                ? 'Git checkpoint disabled for this workspace because Git was not found'
                : 'Failed to create Git checkpoint',
              {
                message: checkpoint.message,
                reason: checkpoint.reason,
                workspaceRoot: checkpointWorkspaceRoot
              }
            ).catch(() => undefined)
          }
        }
        return workspaceCheckpointId
      }
      const [, workspaceCheckpointId] = await Promise.all([
        ensureRuntimeProviderForSend({
          providerId: channel ? undefined : composerProviderId,
          model: composerModel,
          set,
          get
        }),
        createCheckpointIfEligible()
      ])
      const settings = await rendererRuntimeClient.getSettings()
      perf.mark('provider-and-checkpoint-ready')
      let runtimeText: string
      if (channel) {
        runtimeText = buildClawRuntimePrompt(settings, trimmedText, { channel })
      } else {
        runtimeText = buildCodeRuntimePrompt(settings, trimmedText)
        // 人设助手按轮注入：仅对话/Code 主界面生效（写作有自己的助手体系，
        // Claw 走 IM 通道）。displayText 始终是用户原文，注入对 UI 透明。
        if (get().route !== 'write') {
          const personaPrompt = personaPromptForSelection(get().personaAssistantId)
          if (personaPrompt) {
            runtimeText = buildPersonaRuntimePrompt(personaPrompt, runtimeText)
          }
        }
      }
      const runtimeDisplayText = channel ? displayText : (userDisplayText ?? trimmedText)
      const { turnId, userMessageItemId } = await p.sendUserMessage(activeThreadId, runtimeText, {
        mode,
        ...(composerModel ? { model: composerModel } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(runtimeDisplayText ? { displayText: runtimeDisplayText } : {}),
        ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(workspaceCheckpointId ? { workspaceCheckpointId } : {}),
        ...(fileReferences.length ? { fileReferences } : {})
      })
      perf.mark('request-sent')
      // Mirror the composer model selection against the runtime's stable
      // user_message item id so the badge survives page refresh / thread
      // re-selection. The runtime itself doesn't persist per-turn metadata.
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      if (userMessageItemId && userMessageItemId !== userBlockId) {
        set((s) => ({
          blocks: reconcileOptimisticUserBlock(
            s.blocks,
            userBlockId,
            userMessageItemId,
            displayText,
            userModelChip
          ).map((block) =>
            block.kind === 'user' && block.id === userMessageItemId
              ? {
                  ...block,
                  meta: {
                    ...(block.meta ?? {}),
                    turnId,
                    ...(workspaceCheckpointId ? { workspaceCheckpointId } : {})
                  }
                }
              : block
          ),
          currentTurnUserId: s.currentTurnUserId === userBlockId ? userMessageItemId : s.currentTurnUserId,
          turnStartedAtByUserId: (() => {
            if (s.turnStartedAtByUserId[userBlockId] === undefined) return s.turnStartedAtByUserId
            const next = { ...s.turnStartedAtByUserId, [userMessageItemId]: s.turnStartedAtByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnDurationByUserId: (() => {
            if (s.turnDurationByUserId[userBlockId] === undefined) return s.turnDurationByUserId
            const next = { ...s.turnDurationByUserId, [userMessageItemId]: s.turnDurationByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningFirstAtByUserId: (() => {
            if (s.turnReasoningFirstAtByUserId[userBlockId] === undefined) return s.turnReasoningFirstAtByUserId
            const next = {
              ...s.turnReasoningFirstAtByUserId,
              [userMessageItemId]: s.turnReasoningFirstAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningLastAtByUserId: (() => {
            if (s.turnReasoningLastAtByUserId[userBlockId] === undefined) return s.turnReasoningLastAtByUserId
            const next = {
              ...s.turnReasoningLastAtByUserId,
              [userMessageItemId]: s.turnReasoningLastAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })()
        }))
      }
      if (channel && typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
        const userMirror = await window.kunGui.mirrorClawChannelMessage(
          activeThreadId,
          trimmedText,
          'user'
        )
        if (userMirror.ok) {
          rememberPendingClawFeishuMirror(turnId, {
            threadId: activeThreadId,
            userBlockId: userMessageItemId ?? userBlockId,
            userText: trimmedText
          })
        }
      }
      // Subscribe to the turn's event stream BEFORE the cosmetic title rename so
      // a slow/blocked title write never delays the conversation. Title naming
      // must not be a blocking point of the conversation flow.
      set({ currentTurnId: turnId })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: seqAtSend })
      // [perf:chat] 首个流事件 / turn 完成打点：包装 sink，不侵入 helpers。
      let firstStreamEventMarked = false
      const perfSink: typeof sink = {
        ...sink,
        onDeltas: (deltas) => {
          if (!firstStreamEventMarked) {
            firstStreamEventMarked = true
            perf.mark('first-stream-event')
          }
          sink.onDeltas(deltas)
        },
        onTurnComplete: (info) => {
          perf.done('turn-complete')
          sink.onTurnComplete(info)
        }
      }
      subscribeThreadEventsWithRecovery(p, activeThreadId, seqAtSend, perfSink, ac.signal, get)
      armBusyWatchdog(set, get)
      if (shouldRenameThreadAfterSend) {
        // Provisional first-message title; the backend LLM titler upgrades it
        // later (fire-and-forget on the runtime). Awaited here only to land the
        // title before refreshThreads re-reads the list — never blocks the stream.
        const renamed = await p.renameThread(activeThreadId, generatedTitle, true).then(() => true).catch(() => {
          /* keep message delivery successful even if auto-title update fails */
          return false
        })
        if (renamed) {
          set((s) => ({
            threads: s.threads.map((thread) =>
              thread.id === activeThreadId ? { ...thread, title: generatedTitle, titleAuto: true } : thread
            )
          }))
        }
      }
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      void window.kunGui.logError('send-message', 'Failed to send message', {
        message: e instanceof Error ? e.message : String(e),
        threadId: activeThreadId
      }).catch(() => undefined)
      if (looksLikeActiveTurnError(e)) {
        // 线程已进入发送阶段：保留 activeThreadId/lastSeq（recoverActiveTurn 依赖），
        // 函数式摘除本次乐观 user block 与计时痕迹。
        rollbackOptimisticSend({ keepThread: true, error: i18n.t('common:runtimeActiveTurn') })
        await get().recoverActiveTurn()
        await get().refreshThreads()
        return false
      }
      rollbackOptimisticSend({
        keepThread: true,
        error: formatRuntimeError(e),
        openAgentsSettings: shouldOpenSettingsForError(e)
      })
      await get().refreshThreads()
      return false
    }
  },

  reviewActiveThread: async (target: ReviewTarget) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.reviewThread !== 'function') {
      set({ error: i18n.t('common:reviewUnavailable') })
      return false
    }
    if (get().busy || threadHasPendingRuntimeWork(get().blocks)) {
      set({ error: i18n.t('common:composerQueuePlaceholder') })
      return false
    }
    let activeThreadId = get().activeThreadId
    try {
      if (!activeThreadId) {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = await findReusableEmptyThreadId(
          get(),
          p,
          workspaceRoot,
          (thread) => isCodeThread(thread, get().clawChannels)
        )
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: i18n.t('common:slashCommandReviewTitle'),
                mode: 'agent'
              })
            : null
        activeThreadId = reusableThreadId ?? createdThread?.id ?? null
        if (!activeThreadId) throw new Error('Failed to resolve target thread id.')
        set((s) => ({
          activeThreadId,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
      }
      const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
      const composerModel = get().composerModel.trim()
      const composerProviderId = get().composerProviderId.trim()
      const userModelChip = optimisticUserModelLabel(composerModel, threadSnap?.model)
      const seqAtSend = get().lastSeq
      resetBusyRecoveryAttempts()
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      set({
        busy: true,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        currentTurnId: null,
        currentTurnUserId: null
      })
      await ensureRuntimeProviderForSend({
        providerId: composerProviderId,
        model: composerModel,
        set,
        get
      })
      const { turnId, userMessageItemId } = await p.reviewThread(activeThreadId, target, {
        ...(composerModel ? { model: composerModel } : {})
      })
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      set({ currentTurnId: turnId })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: seqAtSend })
      subscribeThreadEventsWithRecovery(p, activeThreadId, seqAtSend, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        currentTurnUserId: null,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },
  }
}
