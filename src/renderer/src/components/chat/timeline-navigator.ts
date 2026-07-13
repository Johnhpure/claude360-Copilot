import { splitThink, stableTurnKey, type Turn } from './message-timeline-turns'

/** One entry in the conversation navigator. `index` is the ABSOLUTE turn
 * index inside the full `turns` array (collapsed history included), so it can
 * feed `expandToTurn` directly. */
export type TurnNavItem = {
  key: string
  index: number
  title: string
}

const NAV_TITLE_MAX_CHARS = 24

/** Strips common markdown decorations from a single line so navigator titles
 * read as plain text (headings, list markers, emphasis, links, inline code). */
function stripMarkdownLine(line: string): string {
  // Leading markers can nest (`- [ ] > text`); peel until stable.
  let prefixStripped = line.trim()
  let previous = ''
  while (prefixStripped !== previous) {
    previous = prefixStripped
    prefixStripped = prefixStripped
      .replace(/^(?:\s*>)+\s*/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '')
  }
  return (
    prefixStripped
      // Images and links keep their readable text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Inline code keeps its content.
      .replace(/`+([^`]*)`+/g, '$1')
      // Emphasis markers (single `_` is kept: snake_case identifiers).
      .replace(/(\*\*|__|~~|\*)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function truncateTitle(text: string): string {
  if (text.length <= NAV_TITLE_MAX_CHARS) return text
  return `${text.slice(0, NAV_TITLE_MAX_CHARS - 1).trimEnd()}…`
}

/** First non-empty line of a text block, markdown-stripped; '' when none. */
function firstReadableLine(text: string): string {
  for (const rawLine of text.split('\n')) {
    const cleaned = stripMarkdownLine(rawLine)
    if (cleaned) return cleaned
  }
  return ''
}

/**
 * Builds navigator entries for EVERY turn (collapsed history included —
 * jumping into history is the whole point). Title chain: user text first
 * line → first assistant text block → localized "Turn N" fallback supplied
 * by the caller (keeps this function pure/testable, i18n stays outside).
 */
export function deriveTurnNavItems(
  turns: Turn[],
  fallbackTitle: (turnNumber: number) => string
): TurnNavItem[] {
  return turns.map((turn, index) => {
    let title = firstReadableLine(turn.user?.text ?? '')
    if (!title) {
      for (const block of turn.blocks) {
        if (block.kind !== 'assistant') continue
        const { content } = splitThink(block.text)
        const line = firstReadableLine(content)
        if (line) {
          title = line
          break
        }
      }
    }
    if (!title) title = fallbackTitle(index + 1)
    return {
      key: stableTurnKey(turn, index),
      index,
      title: truncateTitle(title)
    }
  })
}

/**
 * Scroll-spy: resolves which turn currently "owns" the anchor line
 * (`scrollTop + viewportAnchorPx`). `offsets` are `offsetTop` snapshots of the
 * MOUNTED turn wrappers (collapsed turns are simply absent and thus never
 * highlighted). Returns the last turn starting at or above the anchor line;
 * when every mounted turn starts below it (e.g. the "load earlier" chip sits
 * on top), the first mounted turn is highlighted. `null` only when nothing is
 * mounted.
 */
export function resolveActiveTurnKey(
  offsets: Array<{ key: string; top: number }>,
  scrollTop: number,
  viewportAnchorPx: number
): string | null {
  if (offsets.length === 0) return null
  const sorted = [...offsets].sort((a, b) => a.top - b.top)
  const anchorLine = scrollTop + viewportAnchorPx
  let activeKey = sorted[0].key
  for (const offset of sorted) {
    if (offset.top > anchorLine) break
    activeKey = offset.key
  }
  return activeKey
}

/**
 * Computes the visible-turn count needed to mount `targetIndex` (absolute
 * index), expanding in whole pages so the window stays aligned with the
 * lazy-load pagination. Returns the CURRENT count unchanged when the target
 * is already mounted; result is capped at `totalTurns`.
 */
export function planExpandToTurnCount({
  targetIndex,
  totalTurns,
  visibleTurnCount,
  pageSize
}: {
  targetIndex: number
  totalTurns: number
  visibleTurnCount: number
  pageSize: number
}): number {
  if (totalTurns <= 0) return Math.max(0, visibleTurnCount)
  const safePageSize = Math.max(1, pageSize)
  const clampedIndex = Math.min(Math.max(targetIndex, 0), totalTurns - 1)
  const neededCount = totalTurns - clampedIndex
  if (neededCount <= visibleTurnCount) return visibleTurnCount
  const missingPages = Math.ceil((neededCount - visibleTurnCount) / safePageSize)
  return Math.min(totalTurns, visibleTurnCount + missingPages * safePageSize)
}
