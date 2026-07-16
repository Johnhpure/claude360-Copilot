import { describe, expect, it } from 'vitest'
import {
  inferClientUserMessageSource,
  isBackgroundShellNoticeUserMessage
} from '@shared/background-shell-notice'
import type { ChatBlock } from '../agent/types'
import {
  isOptimisticUserBlockId,
  latestTurnHasVisibleReply,
  reconcileOptimisticUserBlock,
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
