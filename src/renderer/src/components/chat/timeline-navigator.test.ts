import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import type { Turn } from './message-timeline-turns'
import {
  deriveTurnNavItems,
  planExpandToTurnCount,
  resolveActiveTurnKey
} from './timeline-navigator'

function userBlock(id: string, text: string): Extract<ChatBlock, { kind: 'user' }> {
  return { kind: 'user', id, text }
}

function assistantBlock(id: string, text: string): ChatBlock {
  return { kind: 'assistant', id, text }
}

function toolBlock(id: string): ChatBlock {
  return { kind: 'tool', id, status: 'success', summary: 'ran' }
}

const fallback = (turnNumber: number): string => `Turn ${turnNumber}`

describe('deriveTurnNavItems', () => {
  it('returns an empty list for no turns', () => {
    expect(deriveTurnNavItems([], fallback)).toEqual([])
  })

  it('uses the first line of the user text and keys by the user block id', () => {
    const turns: Turn[] = [
      { user: userBlock('u1', '帮我修复登录问题\n附加上下文第二行'), blocks: [] }
    ]
    expect(deriveTurnNavItems(turns, fallback)).toEqual([
      { key: 'u1', index: 0, title: '帮我修复登录问题' }
    ])
  })

  it('strips markdown decorations from the title', () => {
    const turns: Turn[] = [
      { user: userBlock('u1', '## **Fix** the `login` [bug](https://x.dev)'), blocks: [] },
      { user: userBlock('u2', '- [ ] > *task* item_one'), blocks: [] }
    ]
    const items = deriveTurnNavItems(turns, fallback)
    expect(items[0].title).toBe('Fix the login bug')
    expect(items[1].title).toBe('task item_one')
  })

  it('truncates long titles to ~24 chars with an ellipsis', () => {
    const turns: Turn[] = [
      { user: userBlock('u1', '这是一个非常非常长的用户问题标题需要被截断处理才行呀'), blocks: [] }
    ]
    const title = deriveTurnNavItems(turns, fallback)[0].title
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(24)
  })

  it('falls back to the first assistant text block when the turn has no user text', () => {
    const turns: Turn[] = [
      {
        blocks: [
          toolBlock('t1'),
          assistantBlock('a1', '<think>internal reasoning</think>\n\nHere is the summary line')
        ]
      }
    ]
    expect(deriveTurnNavItems(turns, fallback)).toEqual([
      { key: 't1', index: 0, title: 'Here is the summary line' }
    ])
  })

  it('skips assistant blocks whose visible content is empty (think-only)', () => {
    const turns: Turn[] = [
      {
        blocks: [
          assistantBlock('a1', '<thinking>only thoughts</thinking>'),
          assistantBlock('a2', 'Actual answer')
        ]
      }
    ]
    expect(deriveTurnNavItems(turns, fallback)[0].title).toBe('Actual answer')
  })

  it('falls back to the localized turn label when no readable text exists', () => {
    const turns: Turn[] = [
      { user: userBlock('u1', '   \n  '), blocks: [toolBlock('t1')] },
      { blocks: [] }
    ]
    const items = deriveTurnNavItems(turns, fallback)
    expect(items[0]).toEqual({ key: 'u1', index: 0, title: 'Turn 1' })
    // Orphan turn with no blocks keys off the fallback index.
    expect(items[1]).toEqual({ key: 'turn-1', index: 1, title: 'Turn 2' })
  })

  it('covers every turn with absolute indexes (collapsed history included)', () => {
    const turns: Turn[] = Array.from({ length: 30 }, (_, i) => ({
      user: userBlock(`u${i}`, `Question ${i}`),
      blocks: []
    }))
    const items = deriveTurnNavItems(turns, fallback)
    expect(items).toHaveLength(30)
    expect(items[0].index).toBe(0)
    expect(items[29]).toMatchObject({ key: 'u29', index: 29 })
  })
})

describe('resolveActiveTurnKey', () => {
  const offsets = [
    { key: 'a', top: 0 },
    { key: 'b', top: 400 },
    { key: 'c', top: 900 }
  ]

  it('returns null when nothing is mounted', () => {
    expect(resolveActiveTurnKey([], 100, 120)).toBe(null)
  })

  it('picks the last turn starting at or above the anchor line', () => {
    expect(resolveActiveTurnKey(offsets, 0, 120)).toBe('a')
    expect(resolveActiveTurnKey(offsets, 300, 120)).toBe('b')
    expect(resolveActiveTurnKey(offsets, 900, 120)).toBe('c')
  })

  it('treats a turn starting exactly on the anchor line as active', () => {
    expect(resolveActiveTurnKey(offsets, 280, 120)).toBe('b')
  })

  it('highlights the first mounted turn when the anchor sits above every turn', () => {
    const shifted = [
      { key: 'x', top: 500 },
      { key: 'y', top: 800 }
    ]
    expect(resolveActiveTurnKey(shifted, 0, 120)).toBe('x')
  })

  it('sorts unsorted offset snapshots before resolving', () => {
    const unsorted = [
      { key: 'c', top: 900 },
      { key: 'a', top: 0 },
      { key: 'b', top: 400 }
    ]
    expect(resolveActiveTurnKey(unsorted, 450, 120)).toBe('b')
  })
})

describe('planExpandToTurnCount', () => {
  it('keeps the current count when the target is already mounted', () => {
    expect(
      planExpandToTurnCount({ targetIndex: 40, totalTurns: 50, visibleTurnCount: 18, pageSize: 18 })
    ).toBe(18)
  })

  it('expands in whole pages to cover a collapsed-history target', () => {
    // Target 10 needs 40 visible turns; 18 + 2 pages = 54 → capped below.
    expect(
      planExpandToTurnCount({ targetIndex: 10, totalTurns: 50, visibleTurnCount: 18, pageSize: 18 })
    ).toBe(50)
    // Larger conversation: no cap kicks in, page-aligned growth.
    expect(
      planExpandToTurnCount({ targetIndex: 50, totalTurns: 100, visibleTurnCount: 18, pageSize: 18 })
    ).toBe(54)
  })

  it('caps the expansion at the total turn count', () => {
    expect(
      planExpandToTurnCount({ targetIndex: 0, totalTurns: 30, visibleTurnCount: 18, pageSize: 18 })
    ).toBe(30)
  })

  it('clamps out-of-range target indexes', () => {
    expect(
      planExpandToTurnCount({ targetIndex: -5, totalTurns: 30, visibleTurnCount: 18, pageSize: 18 })
    ).toBe(30)
    expect(
      planExpandToTurnCount({ targetIndex: 99, totalTurns: 30, visibleTurnCount: 18, pageSize: 18 })
    ).toBe(18)
  })

  it('handles empty conversations and a degenerate page size', () => {
    expect(
      planExpandToTurnCount({ targetIndex: 0, totalTurns: 0, visibleTurnCount: 0, pageSize: 18 })
    ).toBe(0)
    expect(
      planExpandToTurnCount({ targetIndex: 0, totalTurns: 3, visibleTurnCount: 1, pageSize: 0 })
    ).toBe(3)
  })
})
