import { describe, expect, it } from 'vitest'
import { deriveTimelineVisibleTurnCount } from './use-timeline-scroll'
import { planExpandToTurnCount } from './timeline-navigator'

describe('deriveTimelineVisibleTurnCount', () => {
  it('keeps long conversations on the latest page instead of expanding all turns', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 18,
        totalTurns: 36,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: false
      })
    ).toBe(18)
  })

  it('renders every turn for short conversations below the collapse threshold', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 5,
        totalTurns: 6,
        pageSize: 18,
        shouldCollapseHistory: false,
        historyExpansionRequested: false
      })
    ).toBe(6)
  })

  it('preserves a user-expanded history window while new turns arrive', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 36,
        totalTurns: 50,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(36)
  })

  it('caps a user-expanded history window at the current turn count', () => {
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: 36,
        totalTurns: 24,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(24)
  })

  it('keeps a navigator-expanded window open while streaming re-derives the count', () => {
    // `expandToTurn` grows the window to cover the jump target and marks
    // historyExpansionRequested — the busy-path re-derivation must preserve
    // that window instead of collapsing back to the latest page.
    const expanded = planExpandToTurnCount({
      targetIndex: 10,
      totalTurns: 60,
      visibleTurnCount: 18,
      pageSize: 18
    })
    expect(expanded).toBe(54)
    expect(
      deriveTimelineVisibleTurnCount({
        currentVisibleTurnCount: expanded,
        totalTurns: 60,
        pageSize: 18,
        shouldCollapseHistory: true,
        historyExpansionRequested: true
      })
    ).toBe(54)
  })
})
