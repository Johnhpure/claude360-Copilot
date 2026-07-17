import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import type { ChatState } from '../../store/chat-store-types'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import { useChatStore } from '../../store/chat-store'
import { MessageTimeline } from './MessageTimeline'
import MessageTimelineSource from './MessageTimeline.tsx?raw'

/**
 * 07-17-empty-state-dismiss-delay 挂载时机守卫：空态唯一挂载点在
 * MessageTimeline 内，条件必须是
 * `(!hasContent || !activeThreadId) && !currentTurnUserId`。
 * 两层守卫，逐一锁定三个易错变体：
 * - 回退成 `!hasContent || !activeThreadId` → 源码断言 + 「乐观发送窗口」
 *   用例失败（空态会与用户气泡/处理中指示同屏 3~5 秒，即本任务修复的缺陷）。
 * - 改成 `!hasContent && !activeThreadId` → 源码断言 + 「已选中空线程」用例失败。
 * - 用 `busy` 代替 `currentTurnUserId` 门控 → 源码断言 + 「claw live 预取」用例失败。
 */

const EMPTY_HERO_TESTIDS = [
  'data-testid="no-project-welcome"',
  'data-testid="code-home-workbench"',
  'data-testid="conversation-home"'
] as const

const OPTIMISTIC_USER_TEXT = '帮我实现一个新功能'

const optimisticUserBlock: ChatBlock = {
  kind: 'user',
  id: 'user_optimistic_1',
  text: OPTIMISTIC_USER_TEXT
}

const emptyThread: NormalizedThread = {
  id: 'thr_empty',
  title: 'Empty thread',
  updatedAt: '2026-07-17T00:00:00.000Z',
  model: 'deepseek-chat',
  mode: 'code',
  workspace: '/tmp/project'
}

/**
 * renderToStaticMarkup 走 React 服务端渲染路径：zustand v5 的 useStore 在该
 * 路径下读 getServerSnapshot（= `getInitialState()`，见
 * node_modules/zustand/esm/react.mjs），常规 setState 对静态渲染不可见。
 * 因此把字段同时写进当前状态与初始快照对象（getInitialState 返回创建时的
 * 可变引用）。每次渲染都显式重置下方全部字段，防止用例间状态串扰。
 */
function setChatStoreStateForStaticRender(partial: Partial<ChatState>): void {
  useChatStore.setState(partial)
  Object.assign(useChatStore.getInitialState(), partial)
}

type GateState = {
  blocks?: ChatBlock[]
  activeThreadId?: string | null
  route?: 'chat' | 'claw'
  busy?: boolean
  currentTurnUserId?: string | null
  threads?: NormalizedThread[]
  turnStartedAtByUserId?: Record<string, number>
}

/** workspaceRoot 固定为空串 → chat 路由下空态形态为 no-project-welcome（缺陷截图场景）。 */
function renderTimeline(state: GateState = {}): string {
  const blocks = state.blocks ?? []
  const activeThreadId = state.activeThreadId ?? null
  setChatStoreStateForStaticRender({
    route: state.route ?? 'chat',
    workspaceRoot: '',
    codeWorkspaceRoots: [],
    activeThreadId,
    threads: state.threads ?? [],
    busy: state.busy ?? false,
    currentTurnUserId: state.currentTurnUserId ?? null,
    turnStartedAtByUserId: state.turnStartedAtByUserId ?? {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    activeThreadGoal: null,
    clawChannels: [],
    activeClawChannelId: ''
  })
  return renderToStaticMarkup(
    createElement(MessageTimeline, {
      blocks,
      liveReasoning: '',
      live: '',
      activeThreadId,
      runtimeConnection: 'ready',
      onRetryConnection: () => undefined,
      onOpenSettings: () => undefined
    })
  )
}

function expectEmptyHero(html: string): void {
  expect(html).toContain('data-testid="no-project-welcome"')
}

function expectNoEmptyHero(html: string): void {
  for (const testid of EMPTY_HERO_TESTIDS) {
    expect(html).not.toContain(testid)
  }
}

beforeAll(() => setupI18nTestEnglish())

describe('MessageTimeline empty hero mount gate (07-17-empty-state-dismiss-delay)', () => {
  it('pins the exact gate expression at the hero mount point (source guard)', () => {
    // 不依赖渲染基建的兜底：条件被回退、重排成 `&&` 或换成 busy 门控时，
    // 这条正则直接失败。合法重构该表达式时需同步更新本断言与下方行为用例。
    expect(MessageTimelineSource).toMatch(
      /\{\(!hasContent \|\| !activeThreadId\) && !currentTurnUserId \? \(\s*<MessageTimelineEmptyHero/
    )
  })

  it('shows the hero for a fresh session with nothing sent (AC3)', () => {
    const html = renderTimeline()

    expectEmptyHero(html)
  })

  it('unmounts the hero during the optimistic send window, before activeThreadId lands (AC1)', () => {
    // 乐观 set 同批写入：user 块 + busy + currentTurnUserId；
    // activeThreadId 仍为 null（key 检测/createThread 未完成）。
    // 旧条件 `!hasContent || !activeThreadId` 在此窗口恒真 → 空态与
    // 「处理中」同屏；新条件靠 currentTurnUserId 同帧卸载空态。
    const html = renderTimeline({
      blocks: [optimisticUserBlock],
      activeThreadId: null,
      busy: true,
      currentTurnUserId: optimisticUserBlock.id,
      turnStartedAtByUserId: { [optimisticUserBlock.id]: Date.now() }
    })

    expectNoEmptyHero(html)
    // 界面已切换到对话视图：用户消息气泡在场（R3）。
    expect(html).toContain(OPTIMISTIC_USER_TEXT)
  })

  it('keeps the hero away while a slow turn is still running after thread creation (AC2)', () => {
    // thread 已创建（activeThreadId 置位）但模型响应慢、尚无 assistant
    // 回复——整个 turn 生命周期内空态不得重新闪现。
    const html = renderTimeline({
      blocks: [optimisticUserBlock],
      activeThreadId: 'thr_live',
      busy: true,
      currentTurnUserId: optimisticUserBlock.id,
      turnStartedAtByUserId: { [optimisticUserBlock.id]: Date.now() }
    })

    expectNoEmptyHero(html)
    expect(html).toContain(OPTIMISTIC_USER_TEXT)
  })

  it('does not show the hero when entering a thread with history (AC4)', () => {
    const html = renderTimeline({
      blocks: [
        { kind: 'user', id: 'user_1', text: '之前的问题' },
        { kind: 'assistant', id: 'assistant_1', text: '之前的回答' }
      ],
      activeThreadId: 'thr_history',
      busy: false,
      currentTurnUserId: null
    })

    expectNoEmptyHero(html)
    expect(html).toContain('之前的回答')
  })

  it('still shows the hero for a SELECTED empty thread (guards against && rewrite)', () => {
    // 新建线程动作后：activeThreadId 有值、blocks 空、无进行中 turn。
    // 把条件重排成 `!hasContent && !activeThreadId` 会让本用例失败。
    const html = renderTimeline({
      blocks: [],
      activeThreadId: emptyThread.id,
      threads: [emptyThread],
      busy: false,
      currentTurnUserId: null
    })

    expectEmptyHero(html)
  })

  it('restores the hero after a failed send is rolled back (AC5)', () => {
    // 发送失败回滚：rollbackOptimisticSend 撤销乐观 user 块并恢复
    // currentTurnUserId/activeThreadId → 空态回归（配合 error 提示）。
    const optimisticHtml = renderTimeline({
      blocks: [optimisticUserBlock],
      activeThreadId: null,
      busy: true,
      currentTurnUserId: optimisticUserBlock.id
    })
    expectNoEmptyHero(optimisticHtml)

    const rolledBackHtml = renderTimeline({
      blocks: [],
      activeThreadId: null,
      busy: false,
      currentTurnUserId: null
    })
    expectEmptyHero(rolledBackHtml)
  })

  it('stays in conversation view when a turn fails but the user message remains (AC5)', () => {
    // turn 报错终止但会话里已有用户消息（含错误项）→ 不回退到空态。
    const html = renderTimeline({
      blocks: [
        optimisticUserBlock,
        { kind: 'system', id: 'sys_err_1', text: 'Request failed', severity: 'error' }
      ],
      activeThreadId: 'thr_failed',
      busy: false,
      currentTurnUserId: null
    })

    expectNoEmptyHero(html)
    expect(html).toContain(OPTIMISTIC_USER_TEXT)
  })

  it('keeps the claw hero during live prefetch (guards against busy gating)', () => {
    // subscribeThreadEventsLive：busy=true + blocks=[] + activeThreadId 置位、
    // currentTurnUserId=null——历史预取期间 ClawEmptyHero 必须保留。
    // 改用 busy 门控空态会让本用例失败。
    const html = renderTimeline({
      route: 'claw',
      blocks: [],
      activeThreadId: 'thr_claw_live',
      busy: true,
      currentTurnUserId: null
    })

    expect(html).toContain('ds-kun-state-greet')
    expect(html).toContain('Start a conversation with this assistant')
  })
})
