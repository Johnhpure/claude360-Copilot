import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../agent/types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import {
  armBusyWatchdog,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  clearWatchedCompletionNotifications,
  clearPendingClawFeishuMirrors,
  completionNotificationDedupeKeyForWatchedThread,
  MAX_PENDING_CLAW_FEISHU_MIRRORS,
  MAX_WATCHED_COMPLETION_NOTIFICATIONS,
  rememberPendingClawFeishuMirror,
  takePendingClawFeishuMirror,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { clearBusyWatchdog, resetBusyRecoveryAttempts } from './chat-store-schedulers'
import type { ChatState, ChatStoreSet } from './chat-store-types'

function makeSinkHarness(overrides: Partial<ChatState> = {}): {
  getState: () => ChatState
  set: ChatStoreSet
  get: () => ChatState
} {
  let state = {
    activeThreadId: 'thread-current',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-current',
    currentTurnUserId: 'user-current',
    turnStartedAtByUserId: { 'user-current': 1000 },
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    childRuns: {},
    threads: []
  } as unknown as ChatState
  state = { ...state, ...overrides }
  const get = (): ChatState => state
  const set: ChatStoreSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  return {
    getState: () => state,
    set,
    get
  }
}

describe('subagent run state', () => {
  it('merges child status updates by childId without dropping earlier fields', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    // `running` carries queuedMs; the later `completed` carries durationMs and
    // toolInvocations. A replace (rather than merge) would lose the wait time.
    sink.onChildStatus?.({
      childId: 'child_1',
      childStatus: 'running',
      childLabel: '企业平台案例',
      childProfile: 'general',
      queuedMs: 210945
    })
    sink.onChildStatus?.({
      childId: 'child_1',
      childStatus: 'completed',
      durationMs: 288000,
      toolInvocations: 40
    })

    expect(getState().childRuns.child_1).toMatchObject({
      childId: 'child_1',
      status: 'completed',
      label: '企业平台案例',
      profile: 'general',
      queuedMs: 210945,
      durationMs: 288000,
      toolInvocations: 40
    })
  })

  it('keeps sibling children independent and never settles the parent turn', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    sink.onChildStatus?.({ childId: 'child_a', childStatus: 'completed' })
    sink.onChildStatus?.({ childId: 'child_b', childStatus: 'running' })

    expect(getState().childRuns.child_a?.status).toBe('completed')
    expect(getState().childRuns.child_b?.status).toBe('running')
    // The whole point of the separate channel: one child finishing leaves the
    // parent turn running.
    expect(getState().busy).toBe(true)
    expect(getState().currentTurnId).toBe('turn-current')
  })

  it('survives a store that predates the childRuns slice', () => {
    // Hot reload (or a rehydrated snapshot from before this field existed)
    // leaves `childRuns` undefined; a bare index would throw inside set().
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      childRuns: undefined as unknown as Record<string, never>
    })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    expect(() => sink.onChildStatus?.({ childId: 'child_1', childStatus: 'running' })).not.toThrow()
    expect(getState().childRuns.child_1?.status).toBe('running')
  })

  it('ignores child status from a stream bound to a different active thread', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-new' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-old',
      signal: controller.signal
    })

    sink.onChildStatus?.({ childId: 'child_1', childStatus: 'running' })

    expect(getState().childRuns).toEqual({})
  })
})

describe('thread event sink binding', () => {
  it('ignores reasoning deltas from a stream bound to a different active thread', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-new' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-old',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'old reasoning', seq: 7 }])

    expect(getState().liveReasoning).toBe('')
    expect(getState().lastSeq).toBe(0)
  })

  it('ignores queued callbacks after a stream has been aborted', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      liveReasoning: 'current reasoning'
    })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    controller.abort()
    sink.onDeltas([{ kind: 'agent_reasoning', text: 'late old reasoning', seq: 8 }])
    sink.onTurnComplete()

    expect(getState().liveReasoning).toBe('current reasoning')
    expect(getState().blocks).toEqual([])
    expect(getState().busy).toBe(true)
  })

  it('accepts reasoning deltas from the current active stream', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'fresh reasoning', seq: 9 }])

    expect(getState().liveReasoning).toBe('fresh reasoning')
    expect(getState().lastSeq).toBe(9)
    expect(getState().turnReasoningFirstAtByUserId['user-current']).toEqual(expect.any(Number))
  })

  it('drops replayed deltas at or below the subscription floor', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current', lastSeq: 100 })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 100
    })

    sink.onDeltas([
      { kind: 'agent_message', text: 'replayed history', seq: 90 },
      { kind: 'agent_message', text: 'fresh answer', seq: 101 }
    ])

    expect(getState().liveAssistant).toBe('fresh answer')
    expect(getState().lastSeq).toBe(101)
  })

  it('drops duplicate delta seqs across batches', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onDeltas([{ kind: 'agent_message', text: 'hello', seq: 11 }])
    sink.onDeltas([{ kind: 'agent_message', text: 'hello', seq: 11 }])
    sink.onDeltas([{ kind: 'agent_message', text: ' world', seq: 12 }])

    expect(getState().liveAssistant).toBe('hello world')
  })

  it('never rewinds lastSeq when a stale heartbeat seq arrives', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current', lastSeq: 500 })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onSeq(3)

    expect(getState().lastSeq).toBe(500)
  })
})

describe('invisible completion recovery generation guard', () => {
  afterEach(() => {
    registryMock.getProvider.mockReset()
    vi.unstubAllGlobals()
  })

  it('does not replace a newer completed turn with a delayed stale detail snapshot', async () => {
    type ThreadDetail = {
      blocks: ChatBlock[]
      latestSeq: number
      latestTurnId: string
    }
    let resolveDetail: (value: ThreadDetail) => void = () => {
      throw new Error('deferred thread detail resolver not initialized')
    }
    const detailPromise = new Promise<ThreadDetail>((resolve) => {
      resolveDetail = resolve
    })
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => detailPromise)
    })
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', {
      kunGui: {
        showTurnCompleteNotification,
        logError: vi.fn(async () => undefined)
      }
    })
    const originalBlocks: ChatBlock[] = [
      { kind: 'user', id: 'user-old', text: 'old question' }
    ]
    const newerBlocks: ChatBlock[] = [
      ...originalBlocks,
      { kind: 'user', id: 'user-new', text: 'new question' },
      { kind: 'assistant', id: 'assistant-new', text: 'new answer' }
    ]
    const { getState, set, get } = makeSinkHarness({
      blocks: originalBlocks,
      busy: true,
      lastSeq: 10,
      currentTurnId: 'turn-old',
      drainQueuedMessages: vi.fn(async () => undefined),
      refreshThreads: vi.fn(async () => undefined)
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTurnComplete()
    set({
      blocks: newerBlocks,
      busy: false,
      lastSeq: 20,
      currentTurnId: null
    })
    resolveDetail({
      blocks: [
        ...originalBlocks,
        { kind: 'assistant', id: 'assistant-old', text: 'old recovered answer' }
      ],
      latestSeq: 10,
      latestTurnId: 'turn-old'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(getState().blocks).toEqual(newerBlocks)
    expect(getState().lastSeq).toBe(20)
    expect(showTurnCompleteNotification).not.toHaveBeenCalled()
  })
})

describe('busy watchdog re-arming on live ticks (#goal-recovering-banner)', () => {
  const BUSY_WATCHDOG_MS = 180_000

  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.useRealTimers()
  })

  it('keeps a long, quiet-but-healthy turn alive: heartbeats (onSeq) postpone recovery', () => {
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({ busy: true, recoverActiveTurn })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    // Turn starts → watchdog armed (mirrors onUserMessage).
    armBusyWatchdog(set, get)

    // 10 minutes of nothing but the runtime's 15s heartbeat — e.g. one long
    // tool call producing no output. Each heartbeat ticks onSeq.
    for (let elapsed = 0; elapsed < 600_000; elapsed += 15_000) {
      vi.advanceTimersByTime(15_000)
      sink.onSeq(1)
    }

    // Stream is healthy the whole time, so the "正在恢复…" recovery never fires.
    expect(recoverActiveTurn).not.toHaveBeenCalled()
  })

  it('still recovers when the stream genuinely stalls (no ticks for the full window)', () => {
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({ busy: true, recoverActiveTurn })
    buildThreadEventSink(set, get, { threadId: 'thread-current' })

    armBusyWatchdog(set, get)
    vi.advanceTimersByTime(BUSY_WATCHDOG_MS)

    expect(recoverActiveTurn).toHaveBeenCalledTimes(1)
  })

  it('does not keep a watchdog alive for an idle (non-busy) thread on heartbeats', () => {
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({ busy: false, recoverActiveTurn })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    armBusyWatchdog(set, get)
    sink.onSeq(1) // heartbeat on an idle thread must not re-arm

    vi.advanceTimersByTime(BUSY_WATCHDOG_MS)
    // Watchdog fires once, sees busy=false, and bails without recovery.
    expect(recoverActiveTurn).not.toHaveBeenCalled()
  })
})

describe('thread event sink runtime errors', () => {
  it('adds runtime error events to the timeline with details', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [{ kind: 'user', id: 'user-current', text: 'hello' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeError?.({
      itemId: 'error-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      message: 'Authorization: Bearer secret-token failed',
      code: 'provider_unavailable',
      details: { token: 'secret-token' },
      severity: 'error'
    })
    sink.onRuntimeError?.({
      itemId: 'error-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      message: 'Authorization: Bearer secret-token failed again',
      code: 'provider_unavailable',
      severity: 'error'
    })

    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      kind: 'system',
      id: 'error-1',
      code: 'provider_unavailable',
      severity: 'error'
    })
    expect(systemBlocks[0].text).toContain('<redacted>')
    expect(systemBlocks[0].detail).not.toContain('secret-token')
  })

  it('deduplicates matching runtime error and turn failure events inside one turn', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [{ kind: 'user', id: 'user-current', text: 'draw a poster' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    const message = `model request failed with status 400: ${JSON.stringify({
      error: {
        code: '400',
        message: `Not supported model ${'mimo-v2.5-pro-ultraspeed'.repeat(10)}`
      }
    })}`

    sink.onRuntimeError?.({
      itemId: 'runtime_error_turn-current',
      createdAt: '2026-06-08T00:00:00.000Z',
      message,
      code: 'http_400',
      severity: 'error'
    })
    sink.onRuntimeError?.({
      itemId: 'item_turn-current_error',
      createdAt: '2026-06-08T00:00:01.000Z',
      message,
      code: 'http_400',
      severity: 'error'
    })

    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      id: 'item_turn-current_error',
      code: 'http_400',
      severity: 'error'
    })
    expect(systemBlocks[0].detail).toContain(`Message:\n${message}`)
  })

  it('does not keep an aborted turn busy after interrupt', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      }
    ]
    const state = {
      activeThreadId: 'thr-1',
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      error: null,
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {}
    } as unknown as ChatState
    const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    }

    buildThreadEventSink(set, () => state).onError(new Error('turn aborted'))

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error'
    ])
  })

  it('settles terminal turn failures instead of keeping the composer busy', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'work toward goal' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      }
    ]
    const state = {
      activeThreadId: 'thr-1',
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      error: null,
      runtimeErrorDetail: null,
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      watchTurnCompletion: { 'thr-1': true },
      unreadThreadIds: { 'thr-1': true },
      queuedMessages: []
    } as unknown as ChatState
    const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    }

    buildThreadEventSink(set, () => state).onError(
      new Error(JSON.stringify({
        code: 'http_400',
        message: 'model stream exploded',
        severity: 'error'
      })),
      { terminal: true }
    )

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBe('model stream exploded')
    expect(state.runtimeErrorDetail).toContain('Code: http_400')
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.unreadThreadIds).toEqual({})
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error'
    ])
  })
})

describe('pending Claw Feishu mirrors', () => {
  afterEach(() => {
    clearPendingClawFeishuMirrors()
  })

  it('normalizes pending mirror fields before storing', () => {
    rememberPendingClawFeishuMirror(' turn-1 ', {
      threadId: ' thread-1 ',
      userBlockId: ' user-1 ',
      userText: ' hello '
    })

    expect(takePendingClawFeishuMirror('turn-1')).toEqual({
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
  })

  it('ignores invalid pending mirrors', () => {
    rememberPendingClawFeishuMirror('', {
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
    rememberPendingClawFeishuMirror('turn-2', {
      threadId: ' ',
      userBlockId: 'user-2',
      userText: 'hello'
    })
    rememberPendingClawFeishuMirror('turn-3', {
      threadId: 'thread-3',
      userBlockId: 'user-3',
      userText: ' '
    })

    expect(takePendingClawFeishuMirror('')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-2')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-3')).toBeUndefined()
  })

  it('caps pending mirrors and keeps the latest turns', () => {
    for (let index = 0; index < MAX_PENDING_CLAW_FEISHU_MIRRORS + 5; index += 1) {
      rememberPendingClawFeishuMirror(`turn-${index}`, {
        threadId: `thread-${index}`,
        userBlockId: `user-${index}`,
        userText: `hello-${index}`
      })
    }

    expect(takePendingClawFeishuMirror('turn-0')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-4')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-5')).toEqual({
      threadId: 'thread-5',
      userBlockId: 'user-5',
      userText: 'hello-5'
    })
    expect(takePendingClawFeishuMirror(`turn-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`)).toEqual({
      threadId: `thread-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`,
      userBlockId: `user-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`,
      userText: `hello-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`
    })
  })

  it('removes a pending mirror when taking it', () => {
    rememberPendingClawFeishuMirror('turn-1', {
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })

    expect(takePendingClawFeishuMirror(' turn-1 ')).toEqual({
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
    expect(takePendingClawFeishuMirror('turn-1')).toBeUndefined()
  })
})

describe('watched completion notifications', () => {
  afterEach(() => {
    clearWatchedCompletionNotifications()
  })

  it('normalizes watched thread ids before storing and clearing', () => {
    watchTurnCompletionNotification(' thread-1 ', 1000)

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 2000)).toBe('watch:thread-1:1000')

    clearWatchedCompletionNotification(' thread-1 ')

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 2000)).toBe('watch:thread-1:2000')
  })

  it('ignores empty watched thread ids', () => {
    watchTurnCompletionNotification(' ', 1000)

    expect(completionNotificationDedupeKeyForWatchedThread('', 2000)).toBe('watch:unknown:2000')
  })

  it('caps watched completion notifications and keeps the latest thread watches', () => {
    for (let index = 0; index < MAX_WATCHED_COMPLETION_NOTIFICATIONS + 5; index += 1) {
      watchTurnCompletionNotification(`thread-${index}`, index)
    }

    expect(completionNotificationDedupeKeyForWatchedThread('thread-0', 999)).toBe('watch:thread-0:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-4', 999)).toBe('watch:thread-4:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-5', 999)).toBe('watch:thread-5:5')
    expect(
      completionNotificationDedupeKeyForWatchedThread(`thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}`, 999)
    ).toBe(`watch:thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}:${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}`)
  })

  it('refreshes existing watched threads as the most recent entry', () => {
    watchTurnCompletionNotification('thread-0', 0)
    for (let index = 1; index < MAX_WATCHED_COMPLETION_NOTIFICATIONS; index += 1) {
      watchTurnCompletionNotification(`thread-${index}`, index)
    }
    watchTurnCompletionNotification('thread-0', 1000)
    watchTurnCompletionNotification(`thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS}`, 2000)

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 999)).toBe('watch:thread-1:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-0', 999)).toBe('watch:thread-0:1000')
  })
})
