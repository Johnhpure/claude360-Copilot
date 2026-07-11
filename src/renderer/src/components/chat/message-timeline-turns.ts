import type { ChatBlock } from '../../agent/types'
import { isBackgroundShellNoticeUserMessage } from '@shared/background-shell-notice'

export type Turn = {
  user?: Extract<ChatBlock, { kind: 'user' }>
  blocks: ChatBlock[]
}

export function isBackgroundShellNoticeBlock(block: ChatBlock): boolean {
  return block.kind === 'user' && isBackgroundShellNoticeUserMessage(block)
}

export function groupTurns(blocks: ChatBlock[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const block of blocks) {
    if (block.kind === 'user') {
      if (isBackgroundShellNoticeBlock(block)) {
        if (!current) current = { blocks: [] }
        current.blocks.push(block)
        continue
      }
      if (current) turns.push(current)
      current = { user: block, blocks: [] }
      continue
    }
    if (!current) current = { blocks: [] }
    current.blocks.push(block)
  }

  if (current) turns.push(current)
  return turns
}

export function stableTurnKey(turn: Turn, fallbackIndex: number): string {
  return turn.user?.id ?? turn.blocks[0]?.id ?? `turn-${fallbackIndex}`
}

export function sameTurnContent(left: Turn, right: Turn): boolean {
  if (left.user !== right.user) return false
  if (left.blocks.length !== right.blocks.length) return false
  for (let index = 0; index < left.blocks.length; index += 1) {
    if (left.blocks[index] !== right.blocks[index]) return false
  }
  return true
}

/**
 * Matches every `<think>`/`<thinking>` segment (case-insensitive), tolerating a
 * missing close tag mid-stream. Providers are inconsistent about which tag
 * name they emit, so both must be treated as internal reasoning protocol.
 */
const THINK_SEGMENT_RE = /<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi

/**
 * A trailing, half-streamed `<thinking>` / `</thinking>` tag prefix (e.g.
 * `<thinki`). Stripped from visible content so raw tag characters never
 * flicker through the typewriter while a chunk boundary splits the tag.
 */
const PARTIAL_THINK_TAG_RE = /<\/?(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i

export function splitThink(text: string): { think: string; content: string } {
  const thinkParts: string[] = []
  const content = text.replace(THINK_SEGMENT_RE, (_segment, inner: string) => {
    // A half-streamed close tag (`</thinkin`) falls inside `inner` until the
    // next chunk completes it; strip it so reasoning text never shows raw tags.
    const trimmed = inner.replace(PARTIAL_THINK_TAG_RE, '').trim()
    // Empty <thinking></thinking> pairs carry no reasoning; drop them so the
    // UI never renders blank reasoning sections or repeats them per tag.
    if (trimmed) thinkParts.push(trimmed)
    return ''
  })
  return {
    think: thinkParts.join('\n\n'),
    content: content.replace(PARTIAL_THINK_TAG_RE, '').trim()
  }
}

export function blockHasPendingRuntimeWork(block: ChatBlock): boolean {
  if (block.kind === 'tool') return block.status === 'running'
  if (block.kind === 'compaction') return block.status === 'running'
  if (block.kind === 'review') return block.status === 'running'
  if (block.kind === 'approval') return block.status === 'pending'
  if (block.kind === 'user_input') return block.status === 'pending'
  return false
}

export function isProcessBlock(block: ChatBlock): boolean {
  return (
    isBackgroundShellNoticeBlock(block) ||
    block.kind === 'reasoning' ||
    block.kind === 'tool' ||
    block.kind === 'compaction' ||
    block.kind === 'approval' ||
    block.kind === 'user_input' ||
    block.kind === 'system'
  )
}

export function findTrailingAssistantContentStart(blocks: ChatBlock[]): number {
  let start = blocks.length

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    // Completed reasoning may be persisted after final text; it should not hide the answer bubble.
    if (block.kind === 'reasoning' && start === blocks.length) continue
    if (block.kind !== 'assistant') break

    const split = splitThink(block.text)
    if (!split.content.trim()) break
    start = index
  }

  return start
}
