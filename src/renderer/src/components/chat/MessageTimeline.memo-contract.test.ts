import { describe, expect, it } from 'vitest'
import type { ReactElement, RefObject } from 'react'
import { createElement } from 'react'
import type { ChatBlock } from '../../agent/types'
import { areMessageTurnPropsEqual, type MessageTurnProps } from './MessageTimeline'
import type { Turn } from './message-timeline-turns'

/**
 * MemoMessageTurn 契约锁定（07-14-timeline-performance AC1）：
 * 流式批更新期间，历史 turn 的全部 props 必须保持引用/值稳定，比较函数返回
 * true（跳过重渲染）；任何一个应触发重渲染的输入变化必须返回 false。
 *
 * 修复的击穿字段：onBuildPlan —— 原先 Workbench 每次渲染传入内联闭包
 * `() => void buildGuiPlan()`（Workbench.tsx 旧 2877 行），现已 useStableCallback
 * 化；devPreviewCard 元素同步 useMemo 化。
 */

const userBlock: Extract<ChatBlock, { kind: 'user' }> = { kind: 'user', id: 'u1', text: '你好' }
const assistantBlock: ChatBlock = { kind: 'assistant', id: 'a1', text: '回答内容' }
const toolBlock: ChatBlock = {
  kind: 'tool',
  id: 't1',
  summary: 'bash: npm test',
  status: 'success',
  toolKind: 'command_execution',
  detail: 'ok'
}

/** 模拟 groupTurns 每批重建 Turn 包装对象但内部 block 引用不变。 */
function makeTurn(): Turn {
  return { user: userBlock, blocks: [toolBlock, assistantBlock] }
}

const stableOnBuildPlan = (): void => {}
const stableOnOpenPlan = (): void => {}
const stableViewportRef = { current: null } as RefObject<HTMLDivElement | null>

function baseProps(overrides: Partial<MessageTurnProps> = {}): MessageTurnProps {
  return {
    turn: makeTurn(),
    isProcessing: false,
    liveReasoning: '',
    live: '',
    durationMs: 12_345,
    reasoningDurationMs: undefined,
    devPreviewCard: null,
    planActionsBusy: true,
    onBuildPlan: stableOnBuildPlan,
    onOpenPlan: stableOnOpenPlan,
    viewportRef: stableViewportRef,
    compactCards: false,
    ...overrides
  }
}

describe('areMessageTurnPropsEqual（MemoMessageTurn 比较契约）', () => {
  it('流式批间：Turn 包装对象重建但内容引用稳定 → 返回 true（历史 turn 不重渲染）', () => {
    // 历史 turn 在流式期间的真实输入：live/liveReasoning 恒为 ''、
    // durationMs 为已记录数值、devPreviewCard 为 null、函数 props 引用稳定。
    expect(areMessageTurnPropsEqual(baseProps(), baseProps())).toBe(true)
  })

  it('busy 期间每秒 tick / 每批 SSE：props 全稳定时连续多次比较均为 true', () => {
    const prev = baseProps()
    for (let batch = 0; batch < 5; batch += 1) {
      expect(areMessageTurnPropsEqual(prev, baseProps())).toBe(true)
    }
  })

  describe('应触发重渲染的变化必须返回 false（防止比较函数过度宽松）', () => {
    it('turn 内 block 引用变化（工具更新替换块对象）', () => {
      const nextTurn: Turn = {
        user: userBlock,
        blocks: [{ ...toolBlock, status: 'error' }, assistantBlock]
      }
      expect(areMessageTurnPropsEqual(baseProps(), baseProps({ turn: nextTurn }))).toBe(false)
    })

    it('turn 追加新块', () => {
      const nextTurn: Turn = {
        user: userBlock,
        blocks: [toolBlock, assistantBlock, { kind: 'assistant', id: 'a2', text: '更多' }]
      }
      expect(areMessageTurnPropsEqual(baseProps(), baseProps({ turn: nextTurn }))).toBe(false)
    })

    it('user 块引用变化', () => {
      const nextTurn: Turn = {
        user: { kind: 'user', id: 'u1', text: '你好' },
        blocks: [toolBlock, assistantBlock]
      }
      expect(areMessageTurnPropsEqual(baseProps(), baseProps({ turn: nextTurn }))).toBe(false)
    })

    it.each([
      ['isProcessing', { isProcessing: true }],
      ['live 文本（活动 turn）', { live: '流式中文本' }],
      ['liveReasoning 文本', { liveReasoning: '推理中' }],
      ['durationMs（live turn 每秒 tick）', { durationMs: 13_345 }],
      ['reasoningDurationMs', { reasoningDurationMs: 900 }],
      ['planActionsBusy', { planActionsBusy: false }],
      ['compactCards', { compactCards: true }],
      ['onBuildPlan 引用（原击穿点，回归即暴露）', { onBuildPlan: (): void => {} }],
      ['onOpenPlan 引用', { onOpenPlan: (): void => {} }],
      [
        'devPreviewCard 元素引用',
        { devPreviewCard: createElement('div') as ReactElement }
      ],
      [
        'viewportRef',
        { viewportRef: { current: null } as RefObject<HTMLDivElement | null> }
      ]
    ] as [string, Partial<MessageTurnProps>][])('%s 变化', (_label, overrides) => {
      expect(areMessageTurnPropsEqual(baseProps(), baseProps(overrides))).toBe(false)
    })
  })
})
