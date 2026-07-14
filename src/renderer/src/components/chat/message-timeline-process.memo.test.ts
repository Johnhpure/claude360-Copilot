import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ToolBlock } from '../../agent/types'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import { getProcessDetail, summarizeToolBlock } from './message-timeline-process'
import { splitToolDetailText, TOOL_DETAIL_MAX_CHARS, TruncatedDetailText } from './truncated-detail'

/**
 * 07-14-timeline-performance R5/AC5：
 * - summarizeToolBlock / getProcessDetail 按 block 引用 WeakMap memo——
 *   流式期间 live turn 过程区每 100ms 批渲染一次，未变化块的正则/规范化
 *   只允许算一次。
 * - 超长 detail 截断入 DOM + 「展开全部」按钮。
 */

function makeToolBlock(overrides: Partial<ToolBlock> = {}): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'bash: exec',
    status: 'success',
    toolKind: 'command_execution',
    detail: 'stdout line\n'.repeat(40),
    meta: { toolName: 'bash', command: 'npm test' },
    ...overrides
  }
}

beforeAll(() => setupI18nTestEnglish())

describe('summarizeToolBlock WeakMap memo（AC5）', () => {
  it('same block reference computes once: the second call never touches t', () => {
    const block = makeToolBlock()
    const t = vi.fn((key: string) => key)

    const first = summarizeToolBlock(block, t)
    const callsAfterFirstCompute = t.mock.calls.length
    expect(callsAfterFirstCompute).toBeGreaterThan(0)

    const second = summarizeToolBlock(block, t)
    expect(second).toBe(first)
    // memo 命中：不再执行任何 t()（即完全没有重新计算）
    expect(t.mock.calls.length).toBe(callsAfterFirstCompute)
  })

  it('a replaced block object (tool update) recomputes', () => {
    const block = makeToolBlock()
    const t = vi.fn((key: string) => key)
    summarizeToolBlock(block, t)
    const callsAfterFirst = t.mock.calls.length

    const replaced = makeToolBlock({ status: 'error' })
    summarizeToolBlock(replaced, t)
    expect(t.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('a different t (language switch) recomputes for the same block', () => {
    const block = makeToolBlock()
    const tZh = vi.fn((key: string) => `zh:${key}`)
    const tEn = vi.fn((key: string) => `en:${key}`)
    summarizeToolBlock(block, tZh)
    summarizeToolBlock(block, tEn)
    expect(tEn.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('getProcessDetail WeakMap memo（AC5）', () => {
  it('returns the SAME detail object for repeated calls with a stable block', () => {
    const block = makeToolBlock()
    const first = getProcessDetail(block, 'Ran command npm test')
    const second = getProcessDetail(block, 'Ran command npm test')
    expect(second).toBe(first)
  })

  it('caches the no-summary variant independently', () => {
    const block = makeToolBlock()
    const withSummary = getProcessDetail(block, 'Ran command npm test')
    const withoutSummary = getProcessDetail(block)
    expect(getProcessDetail(block)).toBe(withoutSummary)
    expect(withSummary.kind).toBe('tool')
    expect(withoutSummary.kind).toBe('tool')
  })
})

describe('超长 detail 截断（AC5）', () => {
  it('splitToolDetailText keeps short text intact', () => {
    const { visible, hiddenChars } = splitToolDetailText('short output')
    expect(visible).toBe('short output')
    expect(hiddenChars).toBe(0)
  })

  it('splitToolDetailText clips beyond TOOL_DETAIL_MAX_CHARS', () => {
    const text = 'x'.repeat(TOOL_DETAIL_MAX_CHARS + 5_000)
    const { visible, hiddenChars } = splitToolDetailText(text)
    expect(visible.length).toBe(TOOL_DETAIL_MAX_CHARS)
    expect(hiddenChars).toBe(5_000)
  })

  it('renders a show-all button only for oversized detail', () => {
    const longText = 'y'.repeat(TOOL_DETAIL_MAX_CHARS + 50_000)
    const truncated = renderToStaticMarkup(createElement(TruncatedDetailText, { text: longText }))
    expect(truncated).toContain('<button')
    expect(truncated).toContain('Show all')
    // DOM 中只包含截断后的头部（10k 字符 + 按钮 markup），远小于全文
    expect(truncated.length).toBeLessThan(TOOL_DETAIL_MAX_CHARS + 2_000)

    const short = renderToStaticMarkup(
      createElement(TruncatedDetailText, { text: 'tiny output' })
    )
    expect(short).not.toContain('<button')
    expect(short).toContain('tiny output')
  })
})
