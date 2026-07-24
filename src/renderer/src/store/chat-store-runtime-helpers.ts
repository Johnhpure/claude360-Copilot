import type {
  ChatBlock,
  NormalizedThread,
  RuntimeDisclosureMetadata,
  UserMessageEventPayload
} from '../agent/types'
import {
  applyClientUserMessageSourceMeta,
  isBackgroundShellNoticeUserMessage
} from '@shared/background-shell-notice'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { shouldAutoTitleThread } from '../lib/thread-title'
import type { ResolvedAssistant } from '../features/assistants'
import type { ChatState } from './chat-store-types'

type ThreadDetailProviderLike = {
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
}

export function threadBelongsToWorkspace(
  thread: { workspace?: string },
  workspaceRoot: string
): boolean {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return false
  return normalizeWorkspaceRoot(thread.workspace) === normalizedWorkspace
}

export function hasPendingRuntimeWork(block: ChatBlock): boolean {
  if (block.kind === 'tool') return block.status === 'running'
  if (block.kind === 'compaction') return block.status === 'running'
  if (block.kind === 'review') return block.status === 'running'
  if (block.kind === 'approval') return block.status === 'pending'
  if (block.kind === 'user_input') return block.status === 'pending'
  return false
}

function assistantTextHasVisibleContent(text: string): boolean {
  const withoutThink = text
    .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '')
    .trim()
  return withoutThink.length > 0
}

function assistantBlockHasVisibleContent(block: Extract<ChatBlock, { kind: 'assistant' }>): boolean {
  return assistantTextHasVisibleContent(block.text)
}

export function threadHasPendingRuntimeWork(blocks: ChatBlock[]): boolean {
  let pendingInCurrentTurn = false

  for (const block of blocks) {
    if (block.kind === 'user') {
      if (isBackgroundShellNoticeUserMessage(block)) continue
      pendingInCurrentTurn = false
      continue
    }
    if (hasPendingRuntimeWork(block)) {
      pendingInCurrentTurn = true
      continue
    }
    if (pendingInCurrentTurn && block.kind === 'assistant' && assistantBlockHasVisibleContent(block)) {
      pendingInCurrentTurn = false
    }
  }

  return pendingInCurrentTurn
}

export function settlePendingRuntimeWorkAfterInterrupt(blocks: ChatBlock[]): ChatBlock[] {
  let changed = false
  const next = blocks.map((block): ChatBlock => {
    if (block.kind === 'tool' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'compaction' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'review' && block.status === 'running') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'approval' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'error' as const }
    }
    if (block.kind === 'user_input' && block.status === 'pending') {
      changed = true
      return { ...block, status: 'cancelled' as const }
    }
    return block
  })
  return changed ? next : blocks
}

export function threadSnapshotLooksRunning(blocks: ChatBlock[], threadStatus?: string): boolean {
  if (threadStatus != null && threadStatus.trim()) {
    return runtimeStatusLooksRunning(threadStatus)
  }
  return threadHasPendingRuntimeWork(blocks)
}

/**
 * True when the latest turn (everything after the last real user message)
 * contains renderable agent output — assistant text, reasoning, or tool/review
 * activity. The "reply complete" notification must only fire when this holds:
 * a turn that settled with nothing visible (empty upstream completion, lost
 * SSE deltas, abort) would otherwise notify the user about a reply that does
 * not exist on screen (#reply-invisible).
 */
export function latestTurnHasVisibleReply(
  blocks: ChatBlock[],
  liveAssistant = '',
  liveReasoning = ''
): boolean {
  if (assistantTextHasVisibleContent(liveAssistant) || liveReasoning.trim()) return true
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (!block) continue
    if (block.kind === 'user') {
      if (isBackgroundShellNoticeUserMessage(block)) continue
      return false
    }
    if (block.kind === 'assistant') {
      if (assistantBlockHasVisibleContent(block)) return true
      continue
    }
    if (
      block.kind === 'reasoning' ||
      block.kind === 'tool' ||
      block.kind === 'review' ||
      block.kind === 'compaction'
    ) {
      return true
    }
  }
  return false
}

export function findLatestUserBlockId(blocks: ChatBlock[]): string | null {
  for (let idx = blocks.length - 1; idx >= 0; idx -= 1) {
    const block = blocks[idx]
    if (block?.kind === 'user') return block.id
  }
  return null
}

export function upsertUserBlock(blocks: ChatBlock[], ev: UserMessageEventPayload): ChatBlock[] {
  const clientMeta: RuntimeDisclosureMetadata = { ...(ev.meta ?? {}) }
  applyClientUserMessageSourceMeta(clientMeta as Record<string, unknown>, ev.text)
  const nextBlock: ChatBlock = {
    kind: 'user',
    id: ev.itemId,
    turnId: ev.turnId,
    createdAt: ev.createdAt,
    text: ev.text,
    ...(ev.modelLabel ? { modelLabel: ev.modelLabel } : {}),
    ...(ev.managedBy ? { managedBy: ev.managedBy } : {}),
    ...(Object.keys(clientMeta).length > 0 ? { meta: clientMeta } : {})
  }
  const existingIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === ev.itemId)
  if (existingIndex < 0) return [...blocks, nextBlock]
  const current = blocks[existingIndex]
  const mergedMeta = mergeRuntimeDisclosureMeta(
    current.kind === 'user' ? current.meta : undefined,
    nextBlock.kind === 'user' ? nextBlock.meta : undefined
  )
  const merged: ChatBlock = {
    ...current,
    ...nextBlock,
    createdAt: current.createdAt ?? nextBlock.createdAt,
    ...(mergedMeta ? { meta: mergedMeta } : {})
  }
  if (merged.kind === 'user') {
    const metaRecord = { ...(merged.meta ?? {}) } as Record<string, unknown>
    applyClientUserMessageSourceMeta(metaRecord, merged.text)
    merged.meta = Object.keys(metaRecord).length > 0 ? (metaRecord as RuntimeDisclosureMetadata) : undefined
  }
  const next = [...blocks]
  next[existingIndex] = merged
  return next
}

function mergeRuntimeDisclosureMeta(
  current: RuntimeDisclosureMetadata | undefined,
  next: RuntimeDisclosureMetadata | undefined
): RuntimeDisclosureMetadata | undefined {
  if (!current && !next) return undefined
  return {
    ...(current ?? {}),
    ...(next ?? {})
  }
}

export function isOptimisticUserBlockId(id: string): boolean {
  return id.startsWith('u-')
}

export function reconcileOptimisticUserBlock(
  blocks: ChatBlock[],
  optimisticId: string,
  runtimeId: string,
  fallbackText?: string,
  modelLabel?: string
): ChatBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'user' || block.id !== optimisticId) return block
    return {
      ...block,
      id: runtimeId,
      ...(fallbackText && !block.text.trim() ? { text: fallbackText } : {}),
      ...(modelLabel && !block.modelLabel ? { modelLabel } : {})
    }
  })
}

export function collectAssistantTextForTurn(
  blocks: ChatBlock[],
  userBlockId: string,
  liveAssistant: string
): string {
  const userIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === userBlockId)
  if (userIndex < 0) return liveAssistant.trim()
  const parts: string[] = []
  for (let index = userIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.kind === 'user') break
    if (block.kind === 'assistant' && block.text.trim()) {
      parts.push(block.text.trim())
    }
  }
  if (liveAssistant.trim()) parts.push(liveAssistant.trim())
  return parts.join('\n\n').trim()
}

export function clearedThreadSelection(): Pick<
  ChatState,
  | 'activeThreadId'
  | 'activeThreadRelation'
  | 'activeThreadParentId'
  | 'activeThreadGoal'
  | 'activeThreadTodos'
  | 'blocks'
  | 'lastSeq'
  | 'liveReasoning'
  | 'liveAssistant'
  | 'busy'
  | 'currentTurnId'
  | 'currentTurnUserId'
  | 'turnStartedAtByUserId'
  | 'turnDurationByUserId'
  | 'turnReasoningFirstAtByUserId'
  | 'turnReasoningLastAtByUserId'
  | 'inspectorSelectedId'
  | 'queuedMessages'
> {
  return {
    activeThreadId: null,
    activeThreadRelation: null,
    activeThreadParentId: null,
    activeThreadGoal: null,
    activeThreadTodos: null,
    blocks: [],
    lastSeq: 0,
    liveReasoning: '',
    liveAssistant: '',
    busy: false,
    currentTurnId: null,
    currentTurnUserId: null,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    inspectorSelectedId: null,
    queuedMessages: []
  }
}

/**
 * Whether an existing thread's create-time persona snapshot matches the
 * resolved assistant, i.e. the thread may be reused for that selection.
 *
 * The general assistant only matches threads without an `agentId` and without
 * a persona `systemPrompt`; builtin/custom assistants require the exact
 * `agentId` plus an identical persona `systemPrompt` (so an updated persona
 * never reuses a stale empty thread), and — when the assistant explicitly
 * pins them — matching `providerId` / `model`. Both sides are compared
 * trimmed because the backend trims persona fields at snapshot time.
 */
export function threadMatchesAssistantSnapshot(
  thread: Pick<NormalizedThread, 'agentId' | 'systemPrompt' | 'providerId' | 'model'>,
  resolved: ResolvedAssistant
): boolean {
  const threadAgentId = thread.agentId?.trim() ?? ''
  const requestedAgentId = resolved.threadFields.agentId?.trim() ?? ''
  if (threadAgentId !== requestedAgentId) return false
  if (!requestedAgentId) {
    return !thread.systemPrompt?.trim()
  }
  if ((thread.systemPrompt?.trim() ?? '') !== (resolved.threadFields.systemPrompt?.trim() ?? '')) {
    return false
  }
  const requestedProviderId = resolved.threadFields.providerId?.trim() ?? ''
  if (requestedProviderId && (thread.providerId?.trim() ?? '') !== requestedProviderId) return false
  const requestedModel = resolved.threadFields.model?.trim() ?? ''
  if (requestedModel && thread.model.trim() !== requestedModel) return false
  return true
}

export async function findReusableEmptyThreadId(
  state: ChatState,
  provider: ThreadDetailProviderLike,
  workspaceRoot: string,
  resolvedAssistant: ResolvedAssistant,
  isReusableThread: (thread: NormalizedThread) => boolean = () => true
): Promise<string | null> {
  const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!normalizedWorkspace) return null

  const activeThread = state.activeThreadId
    ? state.threads.find((thread) => thread.id === state.activeThreadId)
    : null
  if (
    activeThread &&
    isReusableThread(activeThread) &&
    threadMatchesAssistantSnapshot(activeThread, resolvedAssistant) &&
    shouldAutoTitleThread(activeThread) &&
    normalizeWorkspaceRoot(activeThread.workspace) === normalizedWorkspace &&
    !threadHasUserMessage(state.blocks)
  ) {
    return activeThread.id
  }

  const candidates = state.threads
    .filter(
      (thread) =>
        thread.id !== activeThread?.id &&
        isReusableThread(thread) &&
        threadMatchesAssistantSnapshot(thread, resolvedAssistant) &&
        shouldAutoTitleThread(thread) &&
        normalizeWorkspaceRoot(thread.workspace) === normalizedWorkspace
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  for (const thread of candidates) {
    try {
      const { blocks } = await provider.getThreadDetail(thread.id)
      if (!threadHasUserMessage(blocks)) return thread.id
    } catch {
      /* ignore and keep checking other candidates */
    }
  }

  return null
}

function runtimeStatusLooksRunning(status?: string): boolean {
  const normalized = status?.trim().toLowerCase()
  return normalized === 'running'
    || normalized === 'in_progress'
    || normalized === 'queued'
    || normalized === 'started'
}

function threadHasUserMessage(blocks: ChatBlock[]): boolean {
  return blocks.some((block) => block.kind === 'user')
}
