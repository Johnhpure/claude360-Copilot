import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { countStepsInBlocks, nextProgressForTool } from './use-child-live-progress'

function toolEvent(callId: string, toolName?: string): {
  itemId: string
  summary: string
  meta?: Record<string, unknown>
} {
  return {
    itemId: `tool_${callId}`,
    summary: toolName ?? 'tool',
    meta: { callId, ...(toolName ? { toolName } : {}) }
  }
}

describe('child live progress folding', () => {
  it('counts a call once even though ready + item events both arrive for it', () => {
    // tool_call_ready and the later item_created describe the same call; before
    // the dedupe every step was counted twice.
    const seen = new Set<string>()
    let progress = nextProgressForTool({}, toolEvent('call_1', 'web_fetch'), seen, 1000)
    progress = nextProgressForTool(progress, toolEvent('call_1', 'web_fetch'), seen, 1200)

    expect(progress.steps).toBe(1)
    expect(progress.currentTool).toBe('web_fetch')
    expect(progress.lastActivityAtMs).toBe(1200)
  })

  it('advances the count and the current tool across distinct calls', () => {
    const seen = new Set<string>()
    let progress = nextProgressForTool({}, toolEvent('call_1', 'bash'), seen, 1000)
    progress = nextProgressForTool(progress, toolEvent('call_2', 'web_fetch'), seen, 2000)
    progress = nextProgressForTool(progress, toolEvent('call_3', 'web_fetch'), seen, 3000)

    expect(progress.steps).toBe(3)
    expect(progress.currentTool).toBe('web_fetch')
    expect(progress.lastActivityAtMs).toBe(3000)
  })

  it('continues from a snapshot count instead of restarting at 1', () => {
    // A child that has been running for minutes seeds `steps` from
    // getThreadDetail; incremental events must add to it.
    const seen = new Set<string>()
    const progress = nextProgressForTool({ steps: 37 }, toolEvent('call_38', 'bash'), seen, 5000)

    expect(progress.steps).toBe(38)
  })

  it('keeps the last known tool when an event carries no name', () => {
    const seen = new Set<string>()
    let progress = nextProgressForTool({}, toolEvent('call_1', 'web_fetch'), seen, 1000)
    progress = nextProgressForTool(
      progress,
      { itemId: 'tool_call_2', summary: '', meta: { callId: 'call_2' } },
      seen,
      2000
    )

    expect(progress.steps).toBe(2)
    expect(progress.currentTool).toBe('web_fetch')
  })

  it('falls back to itemId when a call has no callId', () => {
    const seen = new Set<string>()
    let progress = nextProgressForTool({}, { itemId: 'item_a', summary: 'bash' }, seen, 1000)
    progress = nextProgressForTool(progress, { itemId: 'item_a', summary: 'bash' }, seen, 1100)
    progress = nextProgressForTool(progress, { itemId: 'item_b', summary: 'bash' }, seen, 1200)

    expect(progress.steps).toBe(2)
  })

  it('counts tool blocks in a thread snapshot, matching the runtime tally', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'u1', text: 'go' },
      { kind: 'tool', id: 't1', summary: 'bash', status: 'success' },
      { kind: 'assistant', id: 'a1', text: 'thinking' },
      { kind: 'tool', id: 't2', summary: 'web_fetch', status: 'running' }
    ]

    expect(countStepsInBlocks(blocks)).toBe(2)
    expect(countStepsInBlocks([])).toBe(0)
  })
})
