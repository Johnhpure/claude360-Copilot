import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline } from './MessageTimeline'
import { groupTurns } from './message-timeline-turns'

/**
 * 07-14-timeline-performance R7：1000-turn 静态渲染基准。
 * 只打印耗时（console.info）供跨提交人工对比，不做硬性时间断言防 CI 抖动；
 * 结构断言锁定分页语义——1000 turn 中只有 TURN_PAGE_SIZE(18) 个进入 DOM。
 */

const activeThread: NormalizedThread = {
  id: 'thr_perf',
  title: 'Perf thread',
  updatedAt: '2026-07-15T00:00:00.000Z',
  model: 'deepseek-chat',
  mode: 'code',
  workspace: '/tmp/project'
}

function buildThousandTurnBlocks(turnCount: number): ChatBlock[] {
  const blocks: ChatBlock[] = []
  for (let index = 0; index < turnCount; index += 1) {
    blocks.push({ kind: 'user', id: `user_${index}`, text: `问题 ${index}：这段代码怎么优化？` })
    blocks.push({
      kind: 'tool',
      id: `tool_${index}`,
      summary: 'bash: npm test',
      status: 'success',
      toolKind: 'command_execution',
      detail: `stdout for turn ${index}\n` + 'line\n'.repeat(20),
      meta: { toolName: 'bash', command: 'npm test' }
    })
    blocks.push({
      kind: 'assistant',
      id: `assistant_${index}`,
      text: `回答 ${index}：可以从这几方面入手。\n\n- 减少重复计算\n- 缓存派生值\n- 延迟渲染`
    })
  }
  return blocks
}

beforeAll(() => setupI18nTestEnglish())

describe('MessageTimeline 1000-turn static render baseline (R7)', () => {
  it('windows a 1000-turn thread down to one page of mounted turns', () => {
    const TURN_COUNT = 1000
    const blocks = buildThousandTurnBlocks(TURN_COUNT)
    expect(groupTurns(blocks)).toHaveLength(TURN_COUNT)

    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/tmp/project',
      activeThreadId: activeThread.id,
      threads: [activeThread],
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      clawChannels: [],
      activeClawChannelId: ''
    })

    const startedAt = performance.now()
    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: activeThread.id,
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )
    const elapsedMs = performance.now() - startedAt

    // 供后续任务对比的基准数字（不做硬断言，防 CI 环境抖动）。
    console.info(
      `[perf-baseline] MessageTimeline static render: turns=${TURN_COUNT} blocks=${blocks.length} ` +
        `htmlBytes=${html.length} elapsedMs=${elapsedMs.toFixed(1)}`
    )

    // 分页窗口语义：只有最后 18 个 turn 挂载（用户气泡文本入 DOM），
    // 其余 982 个完全不进 DOM；顶部露出「加载更早」入口。
    expect(html).toContain(`问题 ${TURN_COUNT - 1}`)
    expect(html).toContain(`问题 ${TURN_COUNT - 18}`)
    expect(html).not.toContain(`问题 ${TURN_COUNT - 19}：`)
    expect(html).not.toContain('问题 0：')
  })
})
