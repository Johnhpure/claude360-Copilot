import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { groupTurns, sameTurnContent, splitThink, stableTurnKey } from './message-timeline-turns'

describe('message timeline turns', () => {
  it('uses stable ids for user and assistant-only turns', () => {
    const blocks: ChatBlock[] = [
      { kind: 'assistant', id: 'assistant_intro', text: 'Welcome' },
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]

    const turns = groupTurns(blocks)

    expect(stableTurnKey(turns[0], 0)).toBe('assistant_intro')
    expect(stableTurnKey(turns[1], 1)).toBe('user_1')
  })

  it('treats rebuilt turn arrays as the same content when block references are unchanged', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Hello' },
      { kind: 'assistant', id: 'assistant_1', text: 'Hi' }
    ]

    const first = groupTurns(blocks)[0]
    const second = groupTurns(blocks)[0]

    expect(first).not.toBe(second)
    expect(sameTurnContent(first, second)).toBe(true)
  })

  it('keeps background shell notices inside the current turn instead of splitting it', () => {
    const notice: ChatBlock = {
      kind: 'user',
      id: 'notice_1',
      text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>',
      meta: { displayText: 'Background shell abcd1234 completed', messageSource: 'background_shell' }
    }
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Run build in background' },
      { kind: 'assistant', id: 'assistant_1', text: 'Started.' },
      notice,
      { kind: 'assistant', id: 'assistant_2', text: 'Build finished.' }
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.id).toBe('user_1')
    expect(turns[0]?.blocks.map((block) => block.id)).toEqual(['assistant_1', 'notice_1', 'assistant_2'])
  })

  it('detects background shell notices from client-inferred xml text', () => {
    const notice: ChatBlock = {
      kind: 'user',
      id: 'notice_2',
      text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>'
    }
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', text: 'Run build in background' },
      notice
    ]

    const turns = groupTurns(blocks)

    expect(turns).toHaveLength(1)
    expect(turns[0]?.user?.text).toBe('Run build in background')
    expect(turns[0]?.blocks).toHaveLength(1)
    expect(turns[0]?.blocks[0]?.id).toBe('notice_2')
  })
})

describe('splitThink', () => {
  it('keeps plain text untouched', () => {
    expect(splitThink('直接回答内容')).toEqual({ think: '', content: '直接回答内容' })
  })

  it('extracts legacy <think> segments (regression)', () => {
    expect(splitThink('<think>推理</think>回答')).toEqual({ think: '推理', content: '回答' })
  })

  it('extracts <thinking> segments so raw tags never reach the UI', () => {
    const split = splitThink('<thinking>先分析任务</thinking>这是最终回答')
    expect(split.think).toBe('先分析任务')
    expect(split.content).toBe('这是最终回答')
    expect(split.content).not.toContain('<thinking>')
  })

  it('merges multiple mixed think segments and strips them all from content', () => {
    const split = splitThink('<thinking>第一步</thinking>中间叙述<think>第二步</think>结论')
    expect(split.think).toBe('第一步\n\n第二步')
    expect(split.content).toBe('中间叙述结论')
  })

  it('drops empty and consecutive empty <thinking></thinking> pairs', () => {
    const split = splitThink('<thinking></thinking><thinking> </thinking>正文<thinking></thinking>')
    expect(split.think).toBe('')
    expect(split.content).toBe('正文')
  })

  it('treats an unterminated <thinking> tail as in-flight reasoning', () => {
    const split = splitThink('回答开头<thinking>还在思考')
    expect(split.think).toBe('还在思考')
    expect(split.content).toBe('回答开头')
  })

  it('hides a half-streamed trailing tag prefix from content and reasoning', () => {
    expect(splitThink('回答开头<thinki').content).toBe('回答开头')
    expect(splitThink('<thinking>推理</thinkin').think).toBe('推理')
  })

  it('is case-insensitive for tag names', () => {
    const split = splitThink('<Thinking>reasoning</Thinking>answer')
    expect(split.think).toBe('reasoning')
    expect(split.content).toBe('answer')
  })
})
