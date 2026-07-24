import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'
import { builtinAssistantById } from '../features/assistants'

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnUserId: null,
    error: 'previous error',
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread('thr_existing')]
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  state.drainQueuedMessages = actions.drainQueuedMessages
  return { actions, state }
}

function expectSink(sink: ThreadEventSink | null): ThreadEventSink {
  expect(sink).not.toBeNull()
  return sink as ThreadEventSink
}

describe('chat-store-thread-actions queued messages', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('does not queue GUI plan messages while another turn is active', async () => {
    const { actions, state } = buildHarness()
    const guiPlan: GuiPlanMessageContext = {
      operation: 'draft',
      workspaceRoot: '/workspace/deepseek-gui',
      relativePath: '.kunsdd/plan/feature.md',
      planId: 'plan-1',
      sourceRequest: 'feature'
    }

    await expect(actions.sendMessage('prompt one', 'plan', {
      displayText: 'Generate implementation plan',
      guiPlan
    })).resolves.toBe(false)

    expect(state.queuedMessages).toHaveLength(0)
    expect(state.error).toBeTruthy()
  })

  it('removes stale queued GUI plan messages before draining normal queued messages', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [
      {
        id: 'q-plan',
        text: 'internal plan prompt',
        mode: 'plan',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/workspace/deepseek-gui',
          relativePath: '.kunsdd/plan/one.md',
          planId: 'plan-1'
        }
      },
      {
        id: 'q-user',
        text: 'normal follow-up',
        mode: 'agent',
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        }]
      }
    ]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([])
    expect(sendMessage).toHaveBeenCalledWith('normal follow-up', 'agent', {
      queued: expect.objectContaining({
        id: 'q-user',
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        }]
      })
    })
  })

  it('applies the selected composer provider before sending a turn', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const saveSettingsSilent = vi.fn(async () => ({
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2.5' } },
      codePromptPrefix: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M2' } },
          codePromptPrefix: ''
        })),
        saveSettingsSilent,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerModel = 'mimo-v2.5'
    state.composerProviderId = 'xiaomi-token-plan'

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(true)

    expect(saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2.5' } }
    })
    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello',
      expect.objectContaining({ model: 'mimo-v2.5' })
    )
  })

  it('applies an override provider before sending from the write route', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const saveSettingsSilent = vi.fn(async () => ({
      agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M3' } },
      codePromptPrefix: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: ''
        })),
        saveSettingsSilent,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.route = 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing') as never

    await expect(actions.sendMessage('make a prototype', 'agent', {
      model: 'MiniMax-M3',
      providerId: 'minimax-token-plan'
    })).resolves.toBe(true)

    expect(saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M3' } }
    })
    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'make a prototype',
      expect.objectContaining({ model: 'MiniMax-M3' })
    )
  })

  it('forwards aborted settlement info through the normal send perf sink', async () => {
    let capturedSink: ThreadEventSink | null = null
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_abort',
        userMessageItemId: 'user_abort'
      })),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, _sinceSeq: number, sink: ThreadEventSink) => {
          capturedSink = sink
          return { streamId: 'stream_abort' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: ''
        })),
        showTurnCompleteNotification,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false

    await expect(actions.sendMessage('stop this turn', 'agent')).resolves.toBe(true)
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'partial answer', seq: 1 }])
    sink.onTurnComplete({ aborted: true })
    await Promise.resolve()

    expect(state.busy).toBe(false)
    expect(showTurnCompleteNotification).not.toHaveBeenCalled()
  })
})

describe('chat-store-thread-actions send failure rollback (review I1)', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('keeps messages queued during the send when sendUserMessage fails', async () => {
    let stateRef: ChatState | null = null
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => {
        // 模拟网络等待期间用户又排队了一条新消息，然后发送失败。
        if (stateRef) {
          const optimisticUser = stateRef.blocks.find((block) => block.kind === 'user' && block.text === 'hello-fail')
          if (optimisticUser) {
            stateRef.turnDurationByUserId = { ...stateRef.turnDurationByUserId, [optimisticUser.id]: 1200 }
            stateRef.turnReasoningFirstAtByUserId = {
              ...stateRef.turnReasoningFirstAtByUserId,
              [optimisticUser.id]: 1300
            }
            stateRef.turnReasoningLastAtByUserId = {
              ...stateRef.turnReasoningLastAtByUserId,
              [optimisticUser.id]: 1400
            }
          }
          stateRef.queuedMessages = [
            ...stateRef.queuedMessages,
            { id: 'q-live', text: 'typed while sending', mode: 'agent' as const }
          ]
        }
        throw new Error('network exploded')
      }),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: '', model: '' } },
          codePromptPrefix: ''
        })),
        saveSettingsSilent: vi.fn(async () => ({})),
        restartRuntime: vi.fn(async () => undefined),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    stateRef = state
    state.busy = false

    await expect(actions.sendMessage('hello-fail', 'agent')).resolves.toBe(false)

    // 并发排队的新消息不能被快照覆盖吞掉。
    expect(state.queuedMessages.some((message) => message.id === 'q-live')).toBe(true)
    // 乐观 user block 被摘除、busy 复位、计时映射无残留。
    expect(state.blocks.some((block) => block.kind === 'user' && block.text === 'hello-fail')).toBe(false)
    expect(state.busy).toBe(false)
    expect(state.turnStartedAtByUserId).toEqual({})
    expect(state.turnDurationByUserId).toEqual({})
    expect(state.turnReasoningFirstAtByUserId).toEqual({})
    expect(state.turnReasoningLastAtByUserId).toEqual({})
    expect(state.error).toBeTruthy()
  })

  it('restores the drained queued message to the front when createThread fails', async () => {
    let stateRef: ChatState | null = null
    const provider = {
      connect: vi.fn(async () => undefined),
      listThreads: vi.fn(async () => []),
      createThread: vi.fn(async () => {
        if (stateRef) {
          stateRef.queuedMessages = [
            ...stateRef.queuedMessages,
            { id: 'q-live2', text: 'typed during create', mode: 'agent' as const }
          ]
        }
        throw new Error('create failed')
      }),
      sendUserMessage: vi.fn(async () => ({ threadId: 't', turnId: 'u', userMessageItemId: 'x' })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/deepseek-gui',
          agents: { kun: { providerId: '', model: '' } },
          codePromptPrefix: ''
        })),
        saveSettingsSilent: vi.fn(async () => ({})),
        restartRuntime: vi.fn(async () => undefined),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    stateRef = state
    state.busy = false
    state.activeThreadId = null
    state.threads = []
    const queued = { id: 'q-drained', text: 'queued original', mode: 'agent' as const }
    state.queuedMessages = [queued]

    await expect(actions.sendMessage('queued original', 'agent', { queued })).resolves.toBe(false)

    // 本次 drain 的消息回到队首，发送期间新排队的消息保留在其后。
    expect(state.queuedMessages[0]?.id).toBe('q-drained')
    expect(state.queuedMessages[1]?.text).toBe('typed during create')
    expect(state.blocks).toEqual([])
    expect(state.busy).toBe(false)
    expect(state.activeThreadId).toBeNull()
  })
})

describe('chat-store-thread-actions subscribeThreadEventsLive', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('opens SSE with sinceSeq=0 in parallel with the fetch, so deltas flow in immediately', async () => {
    const subscribeCalls: Array<{ threadId: string; sinceSeq: number }> = []
    const getDetailCalls: string[] = []
    let capturedSink: ThreadEventSink | null = null

    const provider = {
      getThreadDetail: vi.fn(async (id: string) => {
        getDetailCalls.push(id)
        return { blocks: [], latestSeq: 0, threadStatus: 'idle' }
      }),
      subscribeThreadEvents: vi.fn(
        async (threadId: string, sinceSeq: number, sink: ThreadEventSink) => {
          subscribeCalls.push({ threadId, sinceSeq })
          capturedSink = sink
          return { streamId: 'stream_1' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true
    state.runtimeConnection = 'ready'

    await actions.subscribeThreadEventsLive('thr_live')

    // Both HTTP fetch and SSE are kicked off in parallel.
    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_live')
    expect(getDetailCalls).toEqual(['thr_live'])
    // SSE opens with sinceSeq=0 so all events replay.
    expect(subscribeCalls).toEqual([{ threadId: 'thr_live', sinceSeq: 0 }])
    // The chat view switches to the live thread.
    expect(state.activeThreadId).toBe('thr_live')
    // SSE-sourced deltas flow into the chat-store's live state.
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'hello', seq: 1 }])
    expect(state.liveAssistant).toBe('hello')
    sink.onDeltas([{ kind: 'agent_message', text: ' world', seq: 2 }])
    expect(state.liveAssistant).toBe('hello world')
  })

  it('merges fetched history without overwriting live buffers, and takes lastSeq = max(fetched, current)', async () => {
    let capturedSink: ThreadEventSink | null = null
    const fetchedBlocks = [
      { id: 'b1', kind: 'user', text: 'prior turn' }
    ]
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: fetchedBlocks,
        latestSeq: 5,
        threadStatus: 'idle'
      })),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, _sinceSeq: number, sink: ThreadEventSink) => {
          capturedSink = sink
          return { streamId: 'stream_2' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_other'
    state.busy = false
    state.runtimeConnection = 'ready'
    state.blocks = []
    state.lastSeq = 0

    await actions.subscribeThreadEventsLive('thr_live')

    // Wait a microtask for the fetch promise to settle into the store.
    await new Promise((r) => setTimeout(r, 0))

    // Fetched blocks are written.
    expect(state.blocks.length).toBeGreaterThan(0)
    expect(state.blocks[0].id).toBe('b1')
    // SSE deltas that arrived during the fetch are preserved.
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'live text', seq: 8 }])
    expect(state.liveAssistant).toBe('live text')
    // lastSeq is bumped to the max of fetched and current (SSE advanced it).
    expect(state.lastSeq).toBeGreaterThanOrEqual(8)
  })

  it('falls back gracefully when the fetch fails: SSE stays open and the error is surfaced', async () => {
    let capturedSink: ThreadEventSink | null = null
    const provider = {
      getThreadDetail: vi.fn(async () => {
        throw new Error('network down')
      }),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, _sinceSeq: number, sink: ThreadEventSink) => {
          capturedSink = sink
          return { streamId: 'stream_3' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_other'
    state.busy = false
    state.runtimeConnection = 'ready'

    await actions.subscribeThreadEventsLive('thr_live')
    await new Promise((r) => setTimeout(r, 0))

    // SSE is still open and deltas still flow.
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'still works', seq: 1 }])
    expect(state.liveAssistant).toBe('still works')
    // Error is surfaced.
    expect(state.error).toBeTruthy()
  })
})

describe('chat-store-thread-actions recoverActiveTurn settles interrupted work', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  function providerWith(threadStatus: string) {
    return {
      getThreadDetail: vi.fn(async () => ({
        blocks: [
          { id: 'u1', kind: 'user', text: 'do the big thing' },
          { id: 'tool1', kind: 'tool', name: 'delegate_task', status: 'running' }
        ],
        latestSeq: 3,
        threadStatus,
        latestTurnId: 'turn_1',
        latestUserMessageId: 'u1'
      })),
      subscribeThreadEvents: vi.fn(async () => ({ streamId: 'stream_recover' }))
    }
  }

  it('settles a stuck running tool block when the server has already settled (#621)', async () => {
    const provider = providerWith('idle')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(false)
    expect(state.busy).toBe(false)
    // The interrupted delegate_task block is settled, so hasPendingRuntimeWork
    // is no longer true and queued/new messages can actually send.
    const tool = state.blocks.find((block) => block.kind === 'tool')
    expect(tool?.status).toBe('error')
  })

  it('keeps a running tool block when the server reports the thread still running', async () => {
    const provider = providerWith('running')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(true)
    // A genuinely live turn must keep its running block so the GUI reconnects.
    const tool = state.blocks.find((block) => block.kind === 'tool')
    expect(tool?.status).toBe('running')
  })
})

describe('chat-store-thread-actions createThread conversation mode', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('creates a conversation thread bound to the auto-created timestamped workspace', async () => {
    const createdPath = '/home/alice/.local/share/Kun/conversations/20260626-153012'
    const selectThread = vi.fn(async () => undefined)
    const refreshThreads = vi.fn(async () => undefined)
    const createThreadProvider = vi.fn(async () => ({
      id: 'thr_new',
      title: 'New',
      updatedAt: '2026-06-26T15:30:12.000Z',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      workspace: createdPath,
      status: 'idle'
    }))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })

    vi.stubGlobal('window', {
      kunGui: {
        platform: 'linux',
        getSettings: vi.fn(async () => ({
          version: 1,
          locale: 'en',
          theme: 'system',
          uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
          provider: { providers: [], apiKey: '', baseUrl: '', proxy: { enabled: false } },
          agents: { kun: { model: 'deepseek-v4-pro', apiKey: 'k', baseUrl: '' } },
          workspaceRoot: '/tmp/workspace',
          conversationWorkspaceRoot: '~/.local/share/Kun/conversations',
          log: { enabled: false, retentionDays: 7 },
          checkpointCleanup: { enabled: false, intervalDays: 3 },
          notifications: { turnComplete: true },
          appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false, windowMaterial: 'none' },
          keyboardShortcuts: { bindings: [] },
          write: { workspaces: [], defaultWorkspaceRoot: '', activeWorkspaceRoot: '' },
          claw: { channels: [], tasks: [], im: { workspaceRoot: '' }, enabled: false, skills: { extraDirs: [] } },
          schedule: { tasks: [], defaultWorkspaceRoot: '', skills: { extraDirs: [] } },
          workflow: { workflows: [] },
          terminal: { colors: {} },
          guiUpdate: { channel: 'stable' },
          codePromptPrefix: '',
          disabledSkillIds: []
        })),
        createConversationWorkspace: vi.fn(async () => ({ ok: true, path: createdPath }))
      }
    })

    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never
    state.refreshThreads = refreshThreads as never

    await actions.createThread({ conversation: true })

    expect(window.kunGui.createConversationWorkspace).toHaveBeenCalled()
    expect(createThreadProvider).toHaveBeenCalledWith(expect.objectContaining({ workspace: createdPath }))
    expect(state.activeThreadId).toBe('thr_new')
    expect(selectThread).toHaveBeenCalledWith('thr_new')
    expect(refreshThreads).toHaveBeenCalled()
  })
})

describe('chat-store-thread-actions assistant persona (PR-2)', () => {
  const OFFICIAL_DOC = 'builtin.official-document'
  const officialDocPersona = builtinAssistantById.get(OFFICIAL_DOC)?.systemPrompt ?? ''

  const writerProfile = {
    id: 'custom-writer',
    enabled: true,
    name: 'Writer',
    mode: 'primary' as const,
    toolPolicy: 'inherit' as const,
    providerId: 'deepseek',
    model: 'deepseek-v4-pro',
    systemPrompt: 'You are a careful writer.'
  }

  function settingsPayload(profiles: unknown[] = [writerProfile]) {
    return {
      workspaceRoot: '/workspace/deepseek-gui',
      conversationWorkspaceRoot: '~/conversations',
      codePromptPrefix: '',
      agents: { kun: { providerId: '', model: '', subagents: { enabled: true, profiles } } }
    }
  }

  function stubKunGui(overrides: Record<string, unknown> = {}) {
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => settingsPayload()),
        saveSettingsSilent: vi.fn(async () => ({})),
        restartRuntime: vi.fn(async () => undefined),
        logError: vi.fn(async () => undefined),
        ...overrides
      }
    })
    return (window as unknown as { kunGui: Record<string, ReturnType<typeof vi.fn>> }).kunGui
  }

  function personaEchoProvider(overrides: Record<string, unknown> = {}) {
    return {
      connect: vi.fn(async () => undefined),
      createThread: vi.fn(async (input: { workspace?: string; agentId?: string }) => ({
        id: 'thr_new',
        title: '',
        updatedAt: '2026-07-24T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        workspace: input.workspace,
        ...(input.agentId ? { agentId: input.agentId } : {})
      })),
      deleteThread: vi.fn(async () => undefined),
      getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 0, threadStatus: 'idle' })),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_new',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      renameThread: vi.fn(async () => undefined),
      subscribeThreadEvents: vi.fn(async () => undefined),
      ...overrides
    }
  }

  function emptyPersonaThread(id: string): NormalizedThread {
    return {
      id,
      title: '',
      updatedAt: '2026-07-24T10:00:00.000Z',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      workspace: '/workspace/deepseek-gui',
      agentId: OFFICIAL_DOC,
      systemPrompt: officialDocPersona.trim()
    }
  }

  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('creates a conversation thread with the builtin persona picked via composerAgentId', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui({
      createConversationWorkspace: vi.fn(async () => ({ ok: true, path: '/conv/20260724' }))
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = OFFICIAL_DOC
    state.selectThread = vi.fn(async () => undefined) as never

    await actions.createThread({ conversation: true })

    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/conv/20260724',
      agentId: OFFICIAL_DOC,
      systemPrompt: officialDocPersona
    }))
    expect(state.activeThreadId).toBe('thr_new')
  })

  it('honors an explicit empty agentId as the general assistant without falling back', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui({
      createConversationWorkspace: vi.fn(async () => ({ ok: true, path: '/conv/20260724' }))
    })
    const { actions, state } = buildHarness()
    state.threads = [{ ...thread('thr_existing'), agentId: OFFICIAL_DOC }]
    state.composerAgentId = OFFICIAL_DOC
    state.selectThread = vi.fn(async () => undefined) as never

    await actions.createThread({ conversation: true, agentId: '' })

    const input = provider.createThread.mock.calls[0][0] as Record<string, unknown>
    expect(input.agentId).toBeUndefined()
    expect(input.systemPrompt).toBeUndefined()
    expect(state.activeThreadId).toBe('thr_new')
  })

  it('snapshots an eligible custom profile on the plain workspace path', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = 'custom-writer'
    state.selectThread = vi.fn(async () => undefined) as never

    await actions.createThread({ forceNew: true })

    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/workspace/deepseek-gui',
      agentId: 'custom-writer',
      providerId: 'deepseek',
      model: 'deepseek-v4-pro',
      systemPrompt: 'You are a careful writer.'
    }))
    expect(state.activeThreadId).toBe('thr_new')
  })

  it('prefers the active thread agentId over the composer pending selection', async () => {
    const provider = personaEchoProvider({
      createThread: vi.fn(async (input: { workspace?: string; agentId?: string }) => ({
        id: 'thr_new',
        title: '',
        updatedAt: '2026-07-24T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        workspace: input.workspace,
        ...(input.agentId ? { agentId: input.agentId } : {})
      }))
    })
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.threads = [{ ...thread('thr_existing'), agentId: 'custom-writer' }]
    state.composerAgentId = OFFICIAL_DOC
    state.selectThread = vi.fn(async () => undefined) as never

    await actions.createThread({ forceNew: true })

    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'custom-writer',
      systemPrompt: 'You are a careful writer.'
    }))
  })

  it('fails closed without creating a thread when the selection is invalid', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = 'ghost-profile'

    await actions.createThread({ forceNew: true })

    expect(provider.createThread).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.error).toContain('ghost-profile')
  })

  it('deletes and does not activate a thread whose returned agentId mismatches', async () => {
    const provider = personaEchoProvider({
      createThread: vi.fn(async (input: { workspace?: string }) => ({
        id: 'thr_wrong',
        title: '',
        updatedAt: '2026-07-24T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        workspace: input.workspace
      }))
    })
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const selectThread = vi.fn(async () => undefined)
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = OFFICIAL_DOC
    state.selectThread = selectThread as never

    await actions.createThread({ forceNew: true })

    expect(provider.deleteThread).toHaveBeenCalledWith('thr_wrong')
    expect(state.activeThreadId).toBeNull()
    expect(selectThread).not.toHaveBeenCalled()
    expect(state.error).toBeTruthy()
  })

  it('applies the persona to a worktree pool thread bound to the acquired worktree', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui({
      checkoutGitBranchWorktree: vi.fn(async () => ({
        ok: true,
        sourceRepositoryRoot: '/workspace/deepseek-gui',
        worktreePath: '/workspace/.worktrees/main',
        currentBranch: 'main'
      }))
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = OFFICIAL_DOC
    state.selectThread = vi.fn(async () => undefined) as never

    await actions.createThread({
      useWorktreePool: true,
      worktreeBranch: 'main',
      workspaceRoot: '/workspace/deepseek-gui'
    })

    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/workspace/.worktrees/main',
      agentId: OFFICIAL_DOC,
      systemPrompt: officialDocPersona
    }))
    expect(state.activeThreadId).toBe('thr_new')
  })

  it('sends the first message onto a new thread bound to the composer-picked builtin assistant', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.busy = false
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = OFFICIAL_DOC

    await expect(actions.sendMessage('draft a notice', 'agent')).resolves.toBe(true)

    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      agentId: OFFICIAL_DOC,
      systemPrompt: officialDocPersona
    }))
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_new',
      expect.any(String),
      expect.anything()
    )
    expect(state.activeThreadId).toBe('thr_new')
  })

  it('re-reads fresh settings on first send and fails closed when the profile was deleted', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    const kunGui = stubKunGui()
    // Simulate: the profile existed when the user picked it (cached settings)…
    await rendererRuntimeClient.getSettings()
    // …but has been deleted by the time the first message is sent.
    kunGui.getSettings.mockImplementation(async () => settingsPayload([]))
    const { actions, state } = buildHarness()
    state.busy = false
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = 'custom-writer'

    await expect(actions.sendMessage('hello there', 'agent')).resolves.toBe(false)

    expect(provider.createThread).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks.some((block) => block.kind === 'user')).toBe(false)
    expect(state.busy).toBe(false)
    expect(state.error).toContain('custom-writer')
  })

  it('does not reuse an assistant-bound empty thread for a general first send', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.busy = false
    state.activeThreadId = null
    state.threads = [emptyPersonaThread('thr_persona_empty')]
    state.composerAgentId = ''

    await expect(actions.sendMessage('general question', 'agent')).resolves.toBe(true)

    // The persona thread is filtered out before any emptiness probe.
    expect(provider.getThreadDetail).not.toHaveBeenCalled()
    const input = provider.createThread.mock.calls[0][0] as Record<string, unknown>
    expect(input.agentId).toBeUndefined()
    expect(input.systemPrompt).toBeUndefined()
    expect(provider.sendUserMessage).toHaveBeenCalledWith('thr_new', expect.any(String), expect.anything())
  })

  it('reuses an empty thread only when its persona snapshot matches the selection', async () => {
    const provider = personaEchoProvider()
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.busy = false
    state.activeThreadId = null
    state.threads = [emptyPersonaThread('thr_persona_empty')]
    state.composerAgentId = OFFICIAL_DOC

    await expect(actions.sendMessage('draft a notice', 'agent')).resolves.toBe(true)

    expect(provider.createThread).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_persona_empty',
      expect.any(String),
      expect.anything()
    )
    expect(state.activeThreadId).toBe('thr_persona_empty')
  })

  it('rolls back the optimistic block and cleans up when the created thread mismatches on first send', async () => {
    const provider = personaEchoProvider({
      createThread: vi.fn(async (input: { workspace?: string }) => ({
        id: 'thr_wrong',
        title: '',
        updatedAt: '2026-07-24T00:00:00.000Z',
        model: 'deepseek-v4-pro',
        mode: 'agent',
        workspace: input.workspace
      }))
    })
    registryMock.getProvider.mockReturnValue(provider)
    stubKunGui()
    const { actions, state } = buildHarness()
    state.busy = false
    state.activeThreadId = null
    state.threads = []
    state.composerAgentId = OFFICIAL_DOC

    await expect(actions.sendMessage('draft a notice', 'agent')).resolves.toBe(false)

    expect(provider.deleteThread).toHaveBeenCalledWith('thr_wrong')
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks.some((block) => block.kind === 'user')).toBe(false)
    expect(state.busy).toBe(false)
    expect(state.error).toBeTruthy()
  })
})
