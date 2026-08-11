import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import type { ToolBlock } from '../../agent/types'
import { SubagentCallCard, describeProgressLine, resolveStatus } from './SubagentCallCard'

beforeAll(() => setupI18nTestEnglish())

const t = (key: string, opts?: Record<string, unknown>): string => {
  const table: Record<string, string> = {
    subagentQueuedFor: `Queued · waiting ${String(opts?.duration ?? '')}`,
    subagentLiveStep: `step ${String(opts?.count ?? '')}`,
    subagentRunningNoStep: 'Starting…'
  }
  return table[key] ?? key
}

/**
 * A `delegate_task` block as it exists WHILE the child runs: the tool result
 * carries only the childId written by `onStart` — no summary, no
 * toolInvocations. Those land after the child finishes.
 */
function delegateBlock(overrides: Partial<ToolBlock> = {}): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_call_1',
    summary: 'delegate_task',
    status: 'running',
    toolKind: 'tool_call',
    createdAt: new Date(Date.now() - 211_000).toISOString(),
    detail: JSON.stringify({ childId: 'child_1', status: 'running' }),
    meta: { toolName: 'delegate_task' },
    ...overrides
  }
}

/** `meta.child` as the runtime attaches it to live child events. */
function withChildMeta(childStatus: string, extra: Record<string, unknown> = {}): ToolBlock {
  return delegateBlock({
    meta: {
      toolName: 'delegate_task',
      child: { childId: 'child_1', childSeq: 1, childStatus, ...extra }
    }
  })
}

describe('resolveStatus priority', () => {
  const block = delegateBlock({ status: 'running' })

  it('lets live store state win over the block status', () => {
    // The regression this pins: `block.status` only settles when the parent
    // turn writes its tool_result, which happens after EVERY sibling child has
    // finished. Without the live layer a completed child shows no change.
    expect(resolveStatus(block, {}, 'completed')).toBe('done')
    expect(resolveStatus(block, {}, 'queued')).toBe('queued')
    expect(resolveStatus(block, {}, 'failed')).toBe('failed')
    expect(resolveStatus(block, {}, 'aborted')).toBe('failed')
  })

  it('lets live state win over a stale meta.child status', () => {
    expect(resolveStatus(block, { childStatus: 'running' }, 'completed')).toBe('done')
  })

  it('falls back to meta.child, then to the block status', () => {
    expect(resolveStatus(block, { childStatus: 'queued' })).toBe('queued')
    expect(resolveStatus(block, {})).toBe('running')
    expect(resolveStatus(delegateBlock({ status: 'success' }), {})).toBe('done')
    expect(resolveStatus(delegateBlock({ status: 'error' }), {})).toBe('failed')
  })
})

describe('describeProgressLine', () => {
  it('shows how long a queued child has been waiting for a slot', () => {
    expect(describeProgressLine({ status: 'queued', elapsed: '3:31' }, t)).toBe('Queued · waiting 3:31')
  })

  it('shows the live step, tool and freshness once steps arrive', () => {
    expect(
      describeProgressLine(
        { status: 'running', elapsed: '4:48', steps: 40, currentTool: 'web_fetch', sinceLabel: '3s ago' },
        t
      )
    ).toBe('step 40 · web_fetch · 3s ago')
  })

  it('degrades gracefully before the first step lands', () => {
    expect(describeProgressLine({ status: 'running', elapsed: '0:02' }, t)).toBe('Starting…')
    expect(describeProgressLine({ status: 'running', elapsed: '0:02', steps: 0 }, t)).toBe('Starting…')
  })

  it('omits missing parts rather than rendering empty separators', () => {
    expect(describeProgressLine({ status: 'running', elapsed: '1:00', steps: 7 }, t)).toBe('step 7')
    expect(
      describeProgressLine({ status: 'running', elapsed: '1:00', steps: 7, currentTool: 'bash' }, t)
    ).toBe('step 7 · bash')
  })

  it('yields to the task text on terminal cards', () => {
    expect(describeProgressLine({ status: 'done', elapsed: '7:05', steps: 34 }, t)).toBeUndefined()
    expect(describeProgressLine({ status: 'failed', elapsed: '0:12' }, t)).toBeUndefined()
  })
})

describe('SubagentCallCard rendering', () => {
  it('renders a real waiting time for a queued child instead of a dash', () => {
    // Regression: `useElapsed` hard-coded "—" for queued, so a child that waited
    // 3m31s for a concurrency slot rendered as a blank card.
    const html = renderToStaticMarkup(
      createElement(SubagentCallCard, { block: withChildMeta('queued') })
    )

    expect(html).not.toContain('—')
    expect(html).toContain('Queued')
    expect(html).toMatch(/waiting \d+:\d{2}/)
    expect(html).toMatch(/>3:3\d</)
  })

  it('keeps a running card expandable so it never reads as a dead row', () => {
    // Regression: `hasBody` only looked at summary/error — both empty while
    // running — so the chevron was greyed out and the card could not be opened.
    const html = renderToStaticMarkup(
      createElement(SubagentCallCard, { block: withChildMeta('running') })
    )

    expect(html).toContain('role="button"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Running')
  })

  it('shows the completed child with its own duration and step tally', () => {
    const block = delegateBlock({
      status: 'running',
      detail: JSON.stringify({
        childId: 'child_1',
        summary: 'done researching',
        toolInvocations: 27,
        durationMs: 210_932
      }),
      meta: { toolName: 'delegate_task', child: { childId: 'child_1', childStatus: 'completed' } }
    })

    const html = renderToStaticMarkup(createElement(SubagentCallCard, { block }))

    expect(html).toContain('Done')
    expect(html).toContain('3:30')
    expect(html).toContain('27 steps')
  })

  it('still offers the open-session route while the child is mid-flight', () => {
    const html = renderToStaticMarkup(
      createElement(SubagentCallCard, { block: withChildMeta('running') })
    )

    expect(html).toContain('Open sub-session')
  })
})
