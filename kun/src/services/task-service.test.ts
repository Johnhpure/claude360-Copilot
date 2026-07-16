import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { TaskRecordSchema, type TaskRecord } from '../contracts/tasks.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type {
  TaskStore,
  TaskStoreCompareAndSwapResult,
  TaskStoreListOptions
} from '../ports/task-store.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TaskService, TaskServiceError } from './task-service.js'

class MemoryTaskStore implements TaskStore {
  private readonly records = new Map<string, TaskRecord>()

  async create(record: TaskRecord): Promise<TaskRecord> {
    if (this.records.has(record.id)) throw new Error(`task already exists: ${record.id}`)
    const stored = cloneRecord(record)
    this.records.set(stored.id, stored)
    return cloneRecord(stored)
  }

  async get(id: string): Promise<TaskRecord | null> {
    const record = this.records.get(id)
    return record ? cloneRecord(record) : null
  }

  async list(options: TaskStoreListOptions = {}): Promise<TaskRecord[]> {
    return [...this.records.values()]
      .filter((record) => !options.status || record.status === options.status)
      .filter((record) => !options.threadId || record.threadId === options.threadId)
      .filter((record) => !options.before || (
        record.updatedAt < options.before.updatedAt ||
        (record.updatedAt === options.before.updatedAt && record.id < options.before.id)
      ))
      .sort((left, right) => (
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
      ))
      .slice(0, options.limit ?? this.records.size)
      .map(cloneRecord)
  }

  async compareAndSwap(
    id: string,
    expectedUpdatedAt: string,
    next: TaskRecord
  ): Promise<TaskStoreCompareAndSwapResult> {
    const current = this.records.get(id)
    if (!current) return 'missing'
    if (current.updatedAt !== expectedUpdatedAt) return 'conflict'
    this.records.set(id, cloneRecord(next))
    return 'updated'
  }
}

class FailOnceSessionStore extends InMemorySessionStore {
  failNextAppend = true

  override async appendEvent(
    threadId: string,
    event: Parameters<InMemorySessionStore['appendEvent']>[1]
  ): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false
      throw new Error('event persistence interrupted')
    }
    return super.appendEvent(threadId, event)
  }
}

class RacingSessionStore extends InMemorySessionStore {
  failNextAppend = false
  slowNextAppend = false

  override async appendEvent(
    threadId: string,
    event: Parameters<InMemorySessionStore['appendEvent']>[1]
  ): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false
      throw new Error('event persistence interrupted')
    }
    if (this.slowNextAppend) {
      this.slowNextAppend = false
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return super.appendEvent(threadId, event)
  }
}

class AcknowledgementBlockingStore implements TaskStore {
  blockAcknowledgements = true

  constructor(private readonly delegate: MemoryTaskStore) {}

  create(record: TaskRecord): Promise<TaskRecord> {
    return this.delegate.create(record)
  }

  get(id: string): Promise<TaskRecord | null> {
    return this.delegate.get(id)
  }

  list(options?: TaskStoreListOptions): Promise<TaskRecord[]> {
    return this.delegate.list(options)
  }

  async compareAndSwap(
    id: string,
    expectedUpdatedAt: string,
    next: TaskRecord
  ): Promise<TaskStoreCompareAndSwapResult> {
    const current = await this.delegate.get(id)
    const acknowledgesEvent = Boolean(
      current && next.pendingPublicationEventIds.length < current.pendingPublicationEventIds.length
    )
    if (this.blockAcknowledgements && acknowledgesEvent) return 'conflict'
    return this.delegate.compareAndSwap(id, expectedUpdatedAt, next)
  }
}

function cloneRecord(record: TaskRecord): TaskRecord {
  return TaskRecordSchema.parse(structuredClone(record))
}

function createHarness(options: {
  relation?: 'primary' | 'side'
  missingThread?: boolean
  store?: TaskStore
  sessionStore?: InMemorySessionStore
} = {}) {
  const store = options.store ?? new MemoryTaskStore()
  const sessionStore = options.sessionStore ?? new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso: () => '2026-07-15T10:00:00.000Z'
  })
  let clock = Date.parse('2026-07-15T10:00:00.000Z')
  const service = new TaskService({
    store,
    sessionStore,
    events,
    ids: new SequentialIdGenerator(),
    nowIso: () => new Date(clock++).toISOString(),
    getThread: async (threadId) => options.missingThread
      ? null
      : { id: threadId, relation: options.relation ?? 'primary' }
  })
  return { service, store, sessionStore, events }
}

async function createTask(service: TaskService) {
  return service.create({
    threadId: 'thr_1',
    title: 'Secret release title',
    steps: [{ title: 'Run checks' }]
  })
}

describe('TaskService state machine', () => {
  it('creates a task and completes the legal planning/running/verifying path', async () => {
    const { service, sessionStore } = createHarness()
    let task = await createTask(service)

    expect(task.status).toBe('created')
    expect(task.events[0]).toMatchObject({ type: 'created', runtimeSeq: 1 })
    expect(task.steps[0]).toMatchObject({ title: 'Run checks', status: 'pending' })

    task = await service.transition(task.id, {
      to: 'planning',
      expectedUpdatedAt: task.updatedAt
    })
    task = await service.transition(task.id, {
      to: 'running',
      expectedUpdatedAt: task.updatedAt
    })
    task = await service.transition(task.id, {
      to: 'verifying',
      expectedUpdatedAt: task.updatedAt
    })
    task = await service.transition(task.id, {
      to: 'completed',
      expectedUpdatedAt: task.updatedAt,
      result: { summary: 'private result details', data: { score: 1 } }
    })

    expect(task.status).toBe('completed')
    expect(task.result).toEqual({ summary: 'private result details', data: { score: 1 } })
    const runtimeEvents = await sessionStore.loadEventsSince('thr_1', 0)
    expect(runtimeEvents).toHaveLength(5)
    expect(JSON.stringify(runtimeEvents)).not.toContain('Secret release title')
    expect(JSON.stringify(runtimeEvents)).not.toContain('private result details')
  })

  it('rejects illegal and terminal transitions', async () => {
    const { service } = createHarness()
    const created = await createTask(service)

    await expect(service.transition(created.id, {
      to: 'running',
      expectedUpdatedAt: created.updatedAt
    })).rejects.toMatchObject({ code: 'invalid_transition' })

    const failed = await service.transition(created.id, {
      to: 'failed',
      expectedUpdatedAt: created.updatedAt,
      message: 'validation failed'
    })
    await expect(service.transition(failed.id, {
      to: 'planning',
      expectedUpdatedAt: failed.updatedAt
    })).rejects.toMatchObject({ code: 'invalid_transition' })
  })

  it('persists a resume target while waiting and clears it on resume', async () => {
    const { service } = createHarness()
    let task = await createTask(service)
    task = await service.transition(task.id, { to: 'planning', expectedUpdatedAt: task.updatedAt })
    task = await service.transition(task.id, { to: 'running', expectedUpdatedAt: task.updatedAt })
    task = await service.transition(task.id, {
      to: 'waiting',
      expectedUpdatedAt: task.updatedAt,
      waitingFor: { kind: 'approval', refId: 'approval_1' }
    })

    expect(task).toMatchObject({
      status: 'waiting',
      resumeStatus: 'running',
      waitingFor: { kind: 'approval', refId: 'approval_1' }
    })
    const resumed = await service.resume(task.id, { expectedUpdatedAt: task.updatedAt })
    expect(resumed.status).toBe('running')
    expect(resumed.resumeStatus).toBeUndefined()
    expect(resumed.waitingFor).toBeUndefined()
  })

  it('allows only one concurrent update with the same optimistic token', async () => {
    const { service } = createHarness()
    const task = await createTask(service)

    const results = await Promise.allSettled([
      service.transition(task.id, { to: 'planning', expectedUpdatedAt: task.updatedAt }),
      service.transition(task.id, {
        to: 'failed',
        expectedUpdatedAt: task.updatedAt,
        message: 'stopped'
      })
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'conflict' })
    })
  })

  it('deduplicates a retried transition by requestId', async () => {
    const { service, sessionStore } = createHarness()
    const created = await createTask(service)
    const request = {
      to: 'planning' as const,
      expectedUpdatedAt: created.updatedAt,
      requestId: 'request_1'
    }

    const first = await service.transition(created.id, request)
    const retried = await service.transition(created.id, request)

    expect(retried).toEqual(first)
    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(2)
  })

  it('deduplicates concurrent transitions with the same requestId and payload', async () => {
    const { service, sessionStore } = createHarness()
    const created = await createTask(service)
    const request = {
      to: 'planning' as const,
      expectedUpdatedAt: created.updatedAt,
      requestId: 'request_concurrent_1'
    }

    const [first, second] = await Promise.all([
      service.transition(created.id, request),
      service.transition(created.id, request)
    ])

    expect(first.status).toBe('planning')
    expect(second.status).toBe('planning')
    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(2)
  })

  it('rejects reuse of a requestId with a different transition payload', async () => {
    const { service } = createHarness()
    const created = await createTask(service)
    await service.transition(created.id, {
      to: 'planning',
      expectedUpdatedAt: created.updatedAt,
      requestId: 'request_1'
    })

    await expect(service.transition(created.id, {
      to: 'failed',
      expectedUpdatedAt: created.updatedAt,
      requestId: 'request_1',
      message: 'different operation'
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects missing and side threads when creating a task', async () => {
    await expect(createTask(createHarness({ missingThread: true }).service))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(createTask(createHarness({ relation: 'side' }).service))
      .rejects.toMatchObject({ code: 'validation' })
  })

  it('exposes typed service errors', () => {
    const error = new TaskServiceError('conflict', 'stale task')
    expect(error).toMatchObject({ name: 'TaskServiceError', code: 'conflict' })
  })

  it('updates one step and publishes no title or result body', async () => {
    const { service, sessionStore } = createHarness()
    let task = await createTask(service)
    const step = task.steps[0]
    if (!step) throw new Error('expected task step')

    task = await service.updateStep(task.id, {
      stepId: step.id,
      status: 'completed',
      expectedUpdatedAt: task.updatedAt,
      result: { summary: 'private step result' }
    })

    expect(task.steps[0]).toMatchObject({
      id: step.id,
      status: 'completed',
      result: { summary: 'private step result' }
    })
    expect(task.events.at(-1)).toMatchObject({
      type: 'step_updated',
      stepId: step.id,
      stepStatus: 'completed'
    })
    const runtimeEvents = await sessionStore.loadEventsSince('thr_1', 0)
    expect(JSON.stringify(runtimeEvents)).not.toContain('private step result')
    expect(JSON.stringify(runtimeEvents)).not.toContain('Run checks')
  })

  it('paginates task history with an opaque cursor and filters', async () => {
    const { service } = createHarness()
    const first = await createTask(service)
    const second = await service.create({ threadId: 'thr_1', title: 'Second' })
    const third = await service.create({ threadId: 'thr_2', title: 'Third' })
    await service.transition(first.id, {
      to: 'planning',
      expectedUpdatedAt: first.updatedAt
    })

    const pageOne = await service.list({ limit: 2 })
    expect(pageOne.tasks).toHaveLength(2)
    expect(pageOne).toMatchObject({ hasMore: true, nextCursor: expect.any(String) })
    const pageTwo = await service.list({ limit: 2, cursor: pageOne.nextCursor ?? undefined })
    expect(pageTwo.tasks).toHaveLength(1)
    expect(new Set([...pageOne.tasks, ...pageTwo.tasks].map((task) => task.id))).toEqual(
      new Set([first.id, second.id, third.id])
    )
    expect((await service.list({ status: 'planning' })).tasks.map((task) => task.id)).toEqual([
      first.id
    ])
    expect((await service.list({ threadId: 'thr_2' })).tasks.map((task) => task.id)).toEqual([
      third.id
    ])
    await expect(service.list({ cursor: 'not/a/cursor' })).rejects.toMatchObject({
      code: 'validation'
    })
  })

  it('replays an event left pending before SSE persistence', async () => {
    const sessionStore = new FailOnceSessionStore()
    const { service, store } = createHarness({ sessionStore })
    const created = await createTask(service)
    const pending = await store.get(created.id)
    expect(pending?.pendingPublicationEventIds).toHaveLength(1)
    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(0)

    const result = await service.reconcile()

    expect(result).toMatchObject({ published: 1, interrupted: 0 })
    expect((await store.get(created.id))?.pendingPublicationEventIds).toEqual([])
    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(1)
  })

  it('flushes older pending events before publishing a newer mutation', async () => {
    const sessionStore = new FailOnceSessionStore()
    const { service } = createHarness({ sessionStore })
    const created = await createTask(service)

    await service.transition(created.id, {
      to: 'planning',
      expectedUpdatedAt: created.updatedAt
    })

    const runtimeEvents = await sessionStore.loadEventsSince('thr_1', 0)
    expect(runtimeEvents.map((event) => event.kind === 'task_event' ? event.event.type : event.kind))
      .toEqual(['created', 'status_changed'])
  })

  it('acknowledges an already-persisted event without publishing a duplicate', async () => {
    const delegate = new MemoryTaskStore()
    const store = new AcknowledgementBlockingStore(delegate)
    const { service, sessionStore } = createHarness({ store })
    const created = await createTask(service)
    expect((await delegate.get(created.id))?.pendingPublicationEventIds).toHaveLength(1)
    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(1)
    store.blockAcknowledgements = false

    const result = await service.reconcile()

    expect(result).toMatchObject({ acknowledged: 1, published: 0 })
    expect((await delegate.get(created.id))?.pendingPublicationEventIds).toEqual([])
    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(1)
  })

  it('recovers running and verifying tasks with a fresh runtime recorder', async () => {
    const store = new MemoryTaskStore()
    const sessionStore = new InMemorySessionStore()
    const initial = createHarness({ store, sessionStore })
    let running = await createTask(initial.service)
    running = await initial.service.transition(running.id, {
      to: 'planning', expectedUpdatedAt: running.updatedAt
    })
    running = await initial.service.transition(running.id, {
      to: 'running', expectedUpdatedAt: running.updatedAt
    })
    let verifying = await initial.service.create({ threadId: 'thr_1', title: 'Verify release' })
    verifying = await initial.service.transition(verifying.id, {
      to: 'planning', expectedUpdatedAt: verifying.updatedAt
    })
    verifying = await initial.service.transition(verifying.id, {
      to: 'running', expectedUpdatedAt: verifying.updatedAt
    })
    verifying = await initial.service.transition(verifying.id, {
      to: 'verifying', expectedUpdatedAt: verifying.updatedAt
    })
    const highestSeqBeforeRestart = await sessionStore.highestSeq('thr_1')

    const restarted = createHarness({ store, sessionStore })
    const result = await restarted.service.reconcile()
    const recoveredRunning = await restarted.service.get(running.id)
    const recoveredVerifying = await restarted.service.get(verifying.id)

    expect(result.interrupted).toBe(2)
    expect(recoveredRunning).toMatchObject({
      status: 'waiting',
      waitingFor: { kind: 'runtime_recovery' },
      resumeStatus: 'running'
    })
    expect(recoveredRunning?.events.at(-1)).toMatchObject({
      type: 'runtime_recovery',
      fromStatus: 'running',
      toStatus: 'waiting'
    })
    expect(recoveredVerifying).toMatchObject({
      status: 'waiting',
      waitingFor: { kind: 'runtime_recovery' },
      resumeStatus: 'verifying'
    })
    expect(recoveredVerifying?.events.at(-1)).toMatchObject({
      type: 'runtime_recovery',
      fromStatus: 'verifying',
      toStatus: 'waiting'
    })
    const recoveryEvents = (await sessionStore.loadEventsSince('thr_1', highestSeqBeforeRestart))
      .filter((event) => event.kind === 'task_event' && event.event.type === 'runtime_recovery')
    expect(recoveryEvents).toHaveLength(2)
    expect(recoveryEvents.every((event) => event.seq > highestSeqBeforeRestart)).toBe(true)

    if (!recoveredRunning) throw new Error('expected recovered running task')
    const resumed = await restarted.service.resume(recoveredRunning.id, {
      expectedUpdatedAt: recoveredRunning.updatedAt
    })
    expect(resumed.status).toBe('running')
  })

  it('does not allow step mutation after a task reaches a terminal state', async () => {
    const { service } = createHarness()
    const created = await createTask(service)
    const failed = await service.transition(created.id, {
      to: 'failed',
      expectedUpdatedAt: created.updatedAt,
      message: 'stopped'
    })
    const step = failed.steps[0]
    if (!step) throw new Error('expected task step')

    await expect(service.updateStep(failed.id, {
      stepId: step.id,
      status: 'failed',
      expectedUpdatedAt: failed.updatedAt
    })).rejects.toMatchObject({ code: 'invalid_transition' })
  })

  it('publishes a pending event exactly once when reconcile races a flush', async () => {
    const sessionStore = new RacingSessionStore()
    // Leave the 'created' event unpublished, as after a crash between the
    // record write and its runtime-stream publication.
    sessionStore.failNextAppend = true
    const { service } = createHarness({ sessionStore })
    const created = await createTask(service)
    expect(created.events[0]?.runtimeSeq).toBeUndefined()
    const step = created.steps[0]
    if (!step) throw new Error('expected a seeded step')

    // Widen the race window: whichever publisher reaches the runtime stream
    // first stalls inside events.record() while the other checks the same
    // pending id.
    sessionStore.slowNextAppend = true
    await Promise.all([
      service.reconcile(),
      service.updateStep(created.id, {
        stepId: step.id,
        status: 'running',
        expectedUpdatedAt: created.updatedAt
      })
    ])

    const runtimeEvents = await sessionStore.loadEventsSince('thr_1', 0)
    const createdPublications = runtimeEvents.filter(
      (event) => event.kind === 'task_event' && event.event.type === 'created'
    )
    expect(createdPublications).toHaveLength(1)
    const task = await service.get(created.id)
    expect(task?.events.every((event) => event.runtimeSeq !== undefined)).toBe(true)
  })
})
