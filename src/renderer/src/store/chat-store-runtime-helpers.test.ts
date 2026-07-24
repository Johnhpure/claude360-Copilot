import { describe, expect, it, vi } from 'vitest'
import {
  inferClientUserMessageSource,
  isBackgroundShellNoticeUserMessage
} from '@shared/background-shell-notice'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import type { ResolvedAssistant } from '../features/assistants'
import type { ChatState } from './chat-store-types'
import {
  findReusableEmptyThreadId,
  isOptimisticUserBlockId,
  latestTurnHasVisibleReply,
  reconcileOptimisticUserBlock,
  threadMatchesAssistantSnapshot,
  upsertUserBlock
} from './chat-store-runtime-helpers'

describe('chat store runtime helpers', () => {
  it('detects optimistic user block ids', () => {
    expect(isOptimisticUserBlockId('u-123')).toBe(true)
    expect(isOptimisticUserBlockId('item_turn_abc_user')).toBe(false)
  })

  it('tags background shell notices locally from xml text without server metadata', () => {
    const noticeText =
      '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>'
    expect(inferClientUserMessageSource(noticeText)).toBe('background_shell')
    expect(
      isBackgroundShellNoticeUserMessage({
        text: noticeText
      })
    ).toBe(true)
  })

  it('preserves the original user prompt when a background shell notice arrives', () => {
    const originalUser: ChatBlock = {
      kind: 'user',
      id: 'item_turn_abc_user',
      text: 'Run build in background'
    }
    const blocks: ChatBlock[] = [originalUser]
    const notice = {
      itemId: 'item_steered_notice',
      turnId: 'turn_abc',
      text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>',
      meta: {
        displayText: 'Background shell abcd1234 completed'
      }
    }

    const canReconcileOptimisticUser =
      !isBackgroundShellNoticeUserMessage(notice) &&
      'item_turn_abc_user' !== notice.itemId &&
      isOptimisticUserBlockId('item_turn_abc_user')

    expect(canReconcileOptimisticUser).toBe(false)

    const reconciledBlocks = canReconcileOptimisticUser
      ? reconcileOptimisticUserBlock(blocks, 'item_turn_abc_user', notice.itemId, notice.text)
      : blocks
    const nextBlocks = upsertUserBlock(reconciledBlocks, notice)

    expect(nextBlocks).toHaveLength(2)
    expect(nextBlocks[0]).toMatchObject({
      kind: 'user',
      id: 'item_turn_abc_user',
      text: 'Run build in background'
    })
    expect(nextBlocks[1]).toMatchObject({
      kind: 'user',
      id: 'item_steered_notice',
      meta: { messageSource: 'background_shell' }
    })
  })
})

describe('latestTurnHasVisibleReply (#reply-invisible)', () => {
  const user = (id: string): ChatBlock => ({ kind: 'user', id, createdAt: 't', text: 'q' })
  const assistant = (id: string, text: string): ChatBlock => ({ kind: 'assistant', id, createdAt: 't', text })

  it('sees live stream buffers as visible content', () => {
    expect(latestTurnHasVisibleReply([user('u1')], 'partial answer', '')).toBe(true)
    expect(latestTurnHasVisibleReply([user('u1')], '', 'thinking...')).toBe(true)
  })

  it('does not treat pure live think markup as a visible final reply', () => {
    expect(latestTurnHasVisibleReply([user('u1')], '<think>internal</think>', '')).toBe(false)
    expect(
      latestTurnHasVisibleReply([user('u1')], '<THINKING>internal</THINKING>', '')
    ).toBe(false)
    expect(
      latestTurnHasVisibleReply([user('u1')], '<thinking>internal</thinking>final answer', '')
    ).toBe(true)
  })

  it('requires renderable output after the last user message', () => {
    expect(latestTurnHasVisibleReply([user('u1')])).toBe(false)
    expect(latestTurnHasVisibleReply([user('u1'), assistant('a1', 'hello there')])).toBe(true)
    // 空文本 / 纯 <think> 的 assistant 块不算可见回复。
    expect(latestTurnHasVisibleReply([user('u1'), assistant('a1', '  ')])).toBe(false)
    expect(latestTurnHasVisibleReply([user('u1'), assistant('a1', '<think>x</think>')])).toBe(false)
    expect(latestTurnHasVisibleReply([user('u1'), assistant('a1', '<THINKING>x</THINKING>')])).toBe(false)
  })

  it('counts tool activity in the latest turn as visible output', () => {
    const tool: ChatBlock = {
      kind: 'tool',
      id: 'tool1',
      createdAt: 't',
      toolName: 'bash',
      status: 'completed'
    } as unknown as ChatBlock
    expect(latestTurnHasVisibleReply([user('u1'), tool])).toBe(true)
  })

  it('ignores replies that belong to an earlier turn', () => {
    expect(
      latestTurnHasVisibleReply([user('u1'), assistant('a1', 'earlier reply'), user('u2')])
    ).toBe(false)
  })

  it('is false for an empty timeline', () => {
    expect(latestTurnHasVisibleReply([])).toBe(false)
  })
})

function resolved(fields: ResolvedAssistant['threadFields'], kind: ResolvedAssistant['kind'] = 'builtin'): ResolvedAssistant {
  return { selectionId: fields.agentId ?? '', kind, threadFields: fields }
}

const generalResolved: ResolvedAssistant = { selectionId: '', kind: 'general', threadFields: {} }

function snapshotThread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id: 'thr_snapshot',
    title: '',
    updatedAt: '2026-07-24T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    ...overrides
  }
}

describe('threadMatchesAssistantSnapshot', () => {
  const builtinA = resolved({ agentId: 'builtin.official-document', systemPrompt: 'persona A' })
  const builtinB = resolved({ agentId: 'builtin.research', systemPrompt: 'persona B' })
  const customA = resolved(
    { agentId: 'custom-a', providerId: 'deepseek', model: 'deepseek-v4-pro', systemPrompt: 'custom persona A' },
    'custom'
  )

  it('lets the general assistant match only threads without persona snapshot', () => {
    expect(threadMatchesAssistantSnapshot(snapshotThread(), generalResolved)).toBe(true)
    expect(
      threadMatchesAssistantSnapshot(snapshotThread({ agentId: 'builtin.research' }), generalResolved)
    ).toBe(false)
    expect(
      threadMatchesAssistantSnapshot(snapshotThread({ systemPrompt: 'left-over persona' }), generalResolved)
    ).toBe(false)
  })

  it('never lets a dedicated assistant match a general thread', () => {
    expect(threadMatchesAssistantSnapshot(snapshotThread(), builtinA)).toBe(false)
  })

  it('requires the exact agent id across builtin and custom assistants', () => {
    const threadA = snapshotThread({ agentId: 'builtin.official-document', systemPrompt: 'persona A' })
    expect(threadMatchesAssistantSnapshot(threadA, builtinA)).toBe(true)
    expect(threadMatchesAssistantSnapshot(threadA, builtinB)).toBe(false)
    expect(threadMatchesAssistantSnapshot(threadA, customA)).toBe(false)
    expect(
      threadMatchesAssistantSnapshot(
        snapshotThread({ agentId: 'custom-b', systemPrompt: 'custom persona A' }),
        customA
      )
    ).toBe(false)
  })

  it('rejects a same-id thread whose persona systemPrompt drifted', () => {
    expect(
      threadMatchesAssistantSnapshot(
        snapshotThread({ agentId: 'builtin.official-document', systemPrompt: 'persona A v0' }),
        builtinA
      )
    ).toBe(false)
  })

  it('compares systemPrompt trimmed because the backend trims the snapshot', () => {
    expect(
      threadMatchesAssistantSnapshot(
        snapshotThread({ agentId: 'builtin.official-document', systemPrompt: 'persona A' }),
        resolved({ agentId: 'builtin.official-document', systemPrompt: 'persona A\n' })
      )
    ).toBe(true)
  })

  it('compares providerId and model only when the assistant pins them explicitly', () => {
    const matching = snapshotThread({
      agentId: 'custom-a',
      providerId: 'deepseek',
      model: 'deepseek-v4-pro',
      systemPrompt: 'custom persona A'
    })
    expect(threadMatchesAssistantSnapshot(matching, customA)).toBe(true)
    expect(
      threadMatchesAssistantSnapshot({ ...matching, providerId: 'minimax-token-plan' }, customA)
    ).toBe(false)
    expect(threadMatchesAssistantSnapshot({ ...matching, model: 'MiniMax-M2' }, customA)).toBe(false)
    // A builtin assistant pins neither provider nor model, so the thread's
    // backend-defaulted values are irrelevant.
    expect(
      threadMatchesAssistantSnapshot(
        snapshotThread({
          agentId: 'builtin.official-document',
          providerId: 'any-provider',
          systemPrompt: 'persona A'
        }),
        builtinA
      )
    ).toBe(true)
  })
})

describe('findReusableEmptyThreadId assistant scoping', () => {
  const workspace = '/workspace/deepseek-gui'
  const builtinA = resolved({ agentId: 'builtin.official-document', systemPrompt: 'persona A' })

  function stateWith(threads: NormalizedThread[], activeThreadId: string | null = null): ChatState {
    return { activeThreadId, threads, blocks: [] } as unknown as ChatState
  }

  function emptyDetailProvider() {
    return { getThreadDetail: vi.fn(async () => ({ blocks: [] })) }
  }

  it('does not let the general assistant reuse an empty thread bound to an assistant', async () => {
    const personaThread = snapshotThread({
      id: 'thr_persona',
      agentId: 'builtin.official-document',
      systemPrompt: 'persona A',
      workspace
    })
    expect(
      await findReusableEmptyThreadId(stateWith([personaThread]), emptyDetailProvider(), workspace, generalResolved)
    ).toBeNull()
  })

  it('does not let an assistant reuse a general empty thread, even the active one', async () => {
    const generalThread = snapshotThread({ id: 'thr_general', workspace })
    expect(
      await findReusableEmptyThreadId(
        stateWith([generalThread], 'thr_general'),
        emptyDetailProvider(),
        workspace,
        builtinA
      )
    ).toBeNull()
  })

  it('reuses only an empty thread with the identical persona snapshot', async () => {
    const matching = snapshotThread({
      id: 'thr_match',
      agentId: 'builtin.official-document',
      systemPrompt: 'persona A',
      workspace
    })
    const otherAssistant = snapshotThread({
      id: 'thr_other',
      agentId: 'builtin.research',
      systemPrompt: 'persona B',
      workspace,
      updatedAt: '2026-07-24T12:00:00.000Z'
    })
    const provider = emptyDetailProvider()

    expect(
      await findReusableEmptyThreadId(stateWith([otherAssistant, matching]), provider, workspace, builtinA)
    ).toBe('thr_match')
    // Only the persona-compatible candidate was even probed for emptiness.
    expect(provider.getThreadDetail).toHaveBeenCalledTimes(1)
    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_match')
  })
})
