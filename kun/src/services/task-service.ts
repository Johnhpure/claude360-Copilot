import { createHash } from 'node:crypto'
import {
  CreateTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  ResumeTaskRequest,
  TaskRecordSchema,
  TaskSchema,
  TransitionTaskRequest,
  UpdateTaskStepRequest,
  decodeTaskCursor,
  encodeTaskCursor,
  type CreateTaskRequest as CreateTaskRequestType,
  type ListTasksInput,
  type ListTasksResponse as ListTasksResponseType,
  type ResumeTaskRequest as ResumeTaskRequestType,
  type Task,
  type TaskEvent,
  type TaskRecord,
  type TaskResumeStatus,
  type TaskStatus,
  type TransitionTaskRequest as TransitionTaskRequestType,
  type UpdateTaskStepRequest as UpdateTaskStepRequestType
} from '../contracts/tasks.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { TaskStore } from '../ports/task-store.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'

export type TaskServiceErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'invalid_transition'

export class TaskServiceError extends Error {
  readonly code: TaskServiceErrorCode

  constructor(code: TaskServiceErrorCode, message: string) {
    super(message)
    this.name = 'TaskServiceError'
    this.code = code
  }
}

export const ALLOWED_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  created: ['planning', 'failed'],
  planning: ['running', 'waiting', 'failed'],
  running: ['waiting', 'verifying', 'failed'],
  waiting: ['planning', 'running', 'verifying', 'failed'],
  verifying: ['running', 'waiting', 'completed', 'failed'],
  completed: [],
  failed: []
}

export type TaskThreadReference = {
  id: string
  relation?: string
}

export type TaskServiceOptions = {
  store: TaskStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  ids: IdGenerator
  nowIso: () => string
  getThread: (threadId: string) => Promise<TaskThreadReference | null>
}

export type TaskReconcileResult = {
  acknowledged: number
  published: number
  interrupted: number
}

export class TaskService {
  private readonly store: TaskStore
  private readonly sessionStore: SessionStore
  private readonly events: RuntimeEventRecorder
  private readonly ids: IdGenerator
  private readonly nowIso: () => string
  private readonly getThreadReference: TaskServiceOptions['getThread']
  private reconcileInFlight: Promise<TaskReconcileResult> | null = null

  constructor(options: TaskServiceOptions) {
    this.store = options.store
    this.sessionStore = options.sessionStore
    this.events = options.events
    this.ids = options.ids
    this.nowIso = options.nowIso
    this.getThreadReference = options.getThread
  }

  async create(input: CreateTaskRequestType): Promise<Task> {
    const request = CreateTaskRequest.parse(input)
    const thread = await this.getThreadReference(request.threadId)
    if (!thread) {
      throw new TaskServiceError('not_found', `thread not found: ${request.threadId}`)
    }
    if ((thread.relation ?? 'primary') !== 'primary') {
      throw new TaskServiceError(
        'validation',
        `task thread must be primary: ${request.threadId}`
      )
    }

    const now = this.checkedNowIso()
    const id = this.ids.next('task')
    const eventIds = new Set<string>()
    const createdEvent: TaskEvent = {
      id: this.nextUniqueId('task_evt', eventIds),
      taskId: id,
      type: 'created',
      at: now
    }
    const stepIds = new Set(
      (request.steps ?? []).flatMap((step) => step.id ? [step.id] : [])
    )
    const record = TaskRecordSchema.parse({
      schemaVersion: 1,
      id,
      threadId: request.threadId,
      title: request.title,
      status: 'created',
      createdAt: now,
      updatedAt: now,
      steps: (request.steps ?? []).map((step) => ({
        id: step.id ?? this.nextUniqueId('task_step', stepIds),
        title: step.title,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      })),
      events: [createdEvent],
      result: null,
      pendingPublicationEventIds: [createdEvent.id],
      processedRequests: []
    })
    const created = await this.store.create(record)
    return toTask(await this.flushPendingEvents(created.id))
  }

  async get(id: string): Promise<Task | null> {
    const record = await this.store.get(id)
    return record ? toTask(record) : null
  }

  async list(input: ListTasksInput = {}): Promise<ListTasksResponseType> {
    const request = ListTasksRequest.parse(input)
    const before = request.cursor ? decodeTaskCursor(request.cursor) : null
    if (request.cursor && !before) {
      throw new TaskServiceError('validation', 'invalid task cursor')
    }
    const records = await this.store.list({
      ...(request.status ? { status: request.status } : {}),
      ...(request.threadId ? { threadId: request.threadId } : {}),
      ...(before ? { before: { updatedAt: before.updatedAt, id: before.id } } : {}),
      limit: request.limit + 1
    })
    const hasMore = records.length > request.limit
    const visible = hasMore ? records.slice(0, request.limit) : records
    const last = visible.at(-1)
    return ListTasksResponse.parse({
      tasks: visible.map(toTask),
      hasMore,
      nextCursor: hasMore && last
        ? encodeTaskCursor({ updatedAt: last.updatedAt, id: last.id })
        : null
    })
  }

  async transition(id: string, input: TransitionTaskRequestType): Promise<Task> {
    const request = TransitionTaskRequest.parse(input)
    const current = await this.requireRecord(id)
    const requestFingerprint = request.requestId
      ? transitionRequestFingerprint(request)
      : null
    let processedRequests = current.processedRequests
    if (request.requestId && requestFingerprint) {
      const processed = current.processedRequests.find((entry) => entry.id === request.requestId)
      if (processed) {
        if (processed.fingerprint !== requestFingerprint) {
          throw new TaskServiceError(
            'conflict',
            `requestId was already used with a different task transition: ${request.requestId}`
          )
        }
        return toTask(current)
      }
      processedRequests = [
        ...current.processedRequests,
        { id: request.requestId, fingerprint: requestFingerprint }
      ].slice(-100)
    }
    this.assertExpectedVersion(current, request.expectedUpdatedAt)
    this.assertTransition(current, request.to)
    if (request.to === 'completed' && !request.result) {
      throw new TaskServiceError('validation', 'completed tasks require a result')
    }

    const updatedAt = nextIsoAfter(current.updatedAt, this.checkedNowIso())
    const eventIds = new Set(current.events.map((event) => event.id))
    const event: TaskEvent = {
      id: this.nextUniqueId('task_evt', eventIds),
      taskId: current.id,
      type: request.to === 'failed' ? 'failed' : 'status_changed',
      at: updatedAt,
      fromStatus: current.status,
      toStatus: request.to,
      ...(request.to === 'failed'
        ? { message: request.message ?? 'Task failed.', ...(request.code ? { code: request.code } : {}) }
        : {})
    }
    const next = TaskRecordSchema.parse({
      ...withoutWaitingMetadata(current),
      status: request.to,
      updatedAt,
      events: [...current.events, event],
      result: request.result ?? current.result,
      ...(request.to === 'waiting'
        ? {
            ...(request.waitingFor ? { waitingFor: request.waitingFor } : {}),
            resumeStatus: asResumeStatus(current.status)
          }
        : {}),
      pendingPublicationEventIds: [...current.pendingPublicationEventIds, event.id],
      processedRequests
    })
    const result = await this.store.compareAndSwap(id, current.updatedAt, next)
    if (result === 'missing') throw new TaskServiceError('not_found', `task not found: ${id}`)
    if (result === 'conflict') {
      if (request.requestId && requestFingerprint) {
        const latest = await this.requireRecord(id)
        const processed = latest.processedRequests.find((entry) => entry.id === request.requestId)
        if (processed?.fingerprint === requestFingerprint) return toTask(latest)
        if (processed) {
          throw new TaskServiceError(
            'conflict',
            `requestId was already used with a different task transition: ${request.requestId}`
          )
        }
      }
      throw new TaskServiceError('conflict', `task changed: ${id}`)
    }
    return toTask(await this.flushPendingEvents(id))
  }

  async resume(id: string, input: ResumeTaskRequestType): Promise<Task> {
    const request = ResumeTaskRequest.parse(input)
    const current = await this.requireRecord(id)
    this.assertExpectedVersion(current, request.expectedUpdatedAt)
    if (current.status !== 'waiting' || !current.resumeStatus) {
      throw new TaskServiceError('invalid_transition', `task is not resumable: ${id}`)
    }
    return this.transition(id, {
      to: current.resumeStatus,
      expectedUpdatedAt: current.updatedAt
    })
  }

  async updateStep(id: string, input: UpdateTaskStepRequestType): Promise<Task> {
    const request = UpdateTaskStepRequest.parse(input)
    const current = await this.requireRecord(id)
    this.assertExpectedVersion(current, request.expectedUpdatedAt)
    if (current.status === 'completed' || current.status === 'failed') {
      throw new TaskServiceError(
        'invalid_transition',
        `cannot update steps for terminal task: ${id}`
      )
    }
    const stepIndex = current.steps.findIndex((step) => step.id === request.stepId)
    if (stepIndex < 0) {
      throw new TaskServiceError('not_found', `task step not found: ${request.stepId}`)
    }
    const currentStep = current.steps[stepIndex]
    if (!currentStep) {
      throw new TaskServiceError('not_found', `task step not found: ${request.stepId}`)
    }
    const updatedAt = nextIsoAfter(current.updatedAt, this.checkedNowIso())
    const eventIds = new Set(current.events.map((event) => event.id))
    const event: TaskEvent = {
      id: this.nextUniqueId('task_evt', eventIds),
      taskId: current.id,
      type: 'step_updated',
      at: updatedAt,
      stepId: currentStep.id,
      stepStatus: request.status
    }
    const next = TaskRecordSchema.parse({
      ...current,
      updatedAt,
      steps: current.steps.map((step, index) => index === stepIndex
        ? {
            ...step,
            status: request.status,
            updatedAt,
            ...(request.result ? { result: request.result } : {})
          }
        : step),
      events: [...current.events, event],
      pendingPublicationEventIds: [...current.pendingPublicationEventIds, event.id]
    })
    const result = await this.store.compareAndSwap(id, current.updatedAt, next)
    if (result === 'missing') throw new TaskServiceError('not_found', `task not found: ${id}`)
    if (result === 'conflict') throw new TaskServiceError('conflict', `task changed: ${id}`)
    return toTask(await this.flushPendingEvents(id))
  }

  async reconcile(): Promise<TaskReconcileResult> {
    if (this.reconcileInFlight) return this.reconcileInFlight
    const operation = this.runReconcile()
    this.reconcileInFlight = operation
    try {
      return await operation
    } finally {
      if (this.reconcileInFlight === operation) this.reconcileInFlight = null
    }
  }

  private async runReconcile(): Promise<TaskReconcileResult> {
    let acknowledged = 0
    let published = 0
    const initial = await this.store.list()
    const publishedByThread = new Map<string, Map<string, number> | null>()

    for (const threadId of new Set(
      initial.filter((record) => record.pendingPublicationEventIds.length > 0)
        .map((record) => record.threadId)
    )) {
      try {
        publishedByThread.set(threadId, await this.loadPublishedTaskEventSeqs(threadId))
      } catch {
        publishedByThread.set(threadId, null)
      }
    }

    for (const record of initial) {
      const known = publishedByThread.get(record.threadId)
      if (known === null) continue
      for (const eventId of record.pendingPublicationEventIds) {
        const existingSeq = known?.get(taskEventPublicationKey(record.id, eventId))
        if (existingSeq !== undefined) {
          const next = await this.acknowledgePublishedEvent(record.id, eventId, existingSeq)
          if (!next.pendingPublicationEventIds.includes(eventId)) acknowledged += 1
          continue
        }
        const next = await this.publishPendingEvent(record.id, eventId)
        if (!next.pendingPublicationEventIds.includes(eventId)) published += 1
      }
    }

    let interrupted = 0
    for (const record of await this.store.list()) {
      if (record.status !== 'running' && record.status !== 'verifying') continue
      if (await this.reconcileInterruptedTask(record.id)) interrupted += 1
    }
    return { acknowledged, published, interrupted }
  }

  private async reconcileInterruptedTask(taskId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await this.requireRecord(taskId)
      if (current.status !== 'running' && current.status !== 'verifying') return false
      const updatedAt = nextIsoAfter(current.updatedAt, this.checkedNowIso())
      const eventIds = new Set(current.events.map((event) => event.id))
      const event: TaskEvent = {
        id: this.nextUniqueId('task_evt', eventIds),
        taskId: current.id,
        type: 'runtime_recovery',
        at: updatedAt,
        fromStatus: current.status,
        toStatus: 'waiting'
      }
      const next = TaskRecordSchema.parse({
        ...withoutWaitingMetadata(current),
        status: 'waiting',
        updatedAt,
        waitingFor: { kind: 'runtime_recovery' },
        resumeStatus: current.status,
        events: [...current.events, event],
        pendingPublicationEventIds: [...current.pendingPublicationEventIds, event.id]
      })
      const result = await this.store.compareAndSwap(taskId, current.updatedAt, next)
      if (result === 'updated') {
        await this.flushPendingEvents(taskId)
        return true
      }
      if (result === 'missing') return false
    }
    throw new TaskServiceError('conflict', `task recovery conflicted: ${taskId}`)
  }

  private async publishPendingEvent(taskId: string, eventId: string): Promise<TaskRecord> {
    const current = await this.requireRecord(taskId)
    if (!current.pendingPublicationEventIds.includes(eventId)) return current
    const event = current.events.find((candidate) => candidate.id === eventId)
    if (!event) return current

    let runtimeSeq: number
    try {
      const runtimeEvent = await this.events.record({
        kind: 'task_event',
        threadId: current.threadId,
        taskId: current.id,
        event
      })
      runtimeSeq = runtimeEvent.seq
    } catch {
      return current
    }
    try {
      return await this.acknowledgePublishedEvent(taskId, eventId, runtimeSeq)
    } catch {
      return (await this.store.get(taskId)) ?? current
    }
  }

  private async flushPendingEvents(taskId: string): Promise<TaskRecord> {
    let current = await this.requireRecord(taskId)
    if (current.pendingPublicationEventIds.length === 0) return current
    if (current.pendingPublicationEventIds.length === 1) {
      const eventId = current.pendingPublicationEventIds[0]
      return eventId ? this.publishPendingEvent(taskId, eventId) : current
    }

    let published: Map<string, number>
    try {
      published = await this.loadPublishedTaskEventSeqs(current.threadId)
    } catch {
      return current
    }
    for (const eventId of [...current.pendingPublicationEventIds]) {
      current = await this.requireRecord(taskId)
      if (!current.pendingPublicationEventIds.includes(eventId)) continue
      const publicationKey = taskEventPublicationKey(current.id, eventId)
      const existingSeq = published.get(publicationKey)
      current = existingSeq !== undefined
        ? await this.acknowledgePublishedEvent(taskId, eventId, existingSeq)
        : await this.publishPendingEvent(taskId, eventId)
      if (current.pendingPublicationEventIds.includes(eventId)) break
      const runtimeSeq = current.events.find((event) => event.id === eventId)?.runtimeSeq
      if (runtimeSeq !== undefined) published.set(publicationKey, runtimeSeq)
    }
    return current
  }

  private async loadPublishedTaskEventSeqs(threadId: string): Promise<Map<string, number>> {
    const runtimeEvents = await this.sessionStore.loadEventsSince(threadId, 0)
    return new Map(runtimeEvents
      .filter((event) => event.kind === 'task_event')
      .filter((event) => event.taskId === event.event.taskId)
      .map((event) => [taskEventPublicationKey(event.taskId, event.event.id), event.seq]))
  }

  private async acknowledgePublishedEvent(
    taskId: string,
    eventId: string,
    runtimeSeq: number
  ): Promise<TaskRecord> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await this.requireRecord(taskId)
      if (!current.pendingPublicationEventIds.includes(eventId)) return current
      const next = TaskRecordSchema.parse({
        ...current,
        updatedAt: nextIsoAfter(current.updatedAt, this.checkedNowIso()),
        events: current.events.map((event) => (
          event.id === eventId ? { ...event, runtimeSeq } : event
        )),
        pendingPublicationEventIds: current.pendingPublicationEventIds.filter(
          (pendingId) => pendingId !== eventId
        )
      })
      const result = await this.store.compareAndSwap(taskId, current.updatedAt, next)
      if (result === 'updated') return next
      if (result === 'missing') {
        throw new TaskServiceError('not_found', `task not found: ${taskId}`)
      }
    }
    throw new TaskServiceError('conflict', `task publication acknowledgement conflicted: ${taskId}`)
  }

  private async requireRecord(id: string): Promise<TaskRecord> {
    const record = await this.store.get(id)
    if (!record) throw new TaskServiceError('not_found', `task not found: ${id}`)
    return record
  }

  private assertExpectedVersion(record: TaskRecord, expectedUpdatedAt: string): void {
    if (record.updatedAt !== expectedUpdatedAt) {
      throw new TaskServiceError('conflict', `task changed: ${record.id}`)
    }
  }

  private assertTransition(record: TaskRecord, target: TaskStatus): void {
    if (!ALLOWED_TASK_TRANSITIONS[record.status].includes(target)) {
      throw new TaskServiceError(
        'invalid_transition',
        `invalid task transition: ${record.status} -> ${target}`
      )
    }
    if (record.status === 'waiting' && target !== 'failed' && target !== record.resumeStatus) {
      throw new TaskServiceError(
        'invalid_transition',
        `waiting task must resume to ${record.resumeStatus ?? 'its saved status'}`
      )
    }
  }

  private checkedNowIso(): string {
    const value = this.nowIso()
    if (!Number.isFinite(Date.parse(value))) {
      throw new TaskServiceError('validation', 'task clock returned an invalid timestamp')
    }
    return value
  }

  private nextUniqueId(prefix: string, usedIds: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = this.ids.next(prefix)
      if (usedIds.has(id)) continue
      usedIds.add(id)
      return id
    }
    throw new TaskServiceError('conflict', `unable to allocate a unique ${prefix} id`)
  }

}

function withoutWaitingMetadata(record: TaskRecord): Omit<TaskRecord, 'waitingFor' | 'resumeStatus'> {
  const { waitingFor: _waitingFor, resumeStatus: _resumeStatus, ...rest } = record
  return rest
}

function asResumeStatus(status: TaskStatus): TaskResumeStatus {
  if (status === 'planning' || status === 'running' || status === 'verifying') return status
  throw new TaskServiceError('invalid_transition', `cannot wait from task status: ${status}`)
}

function nextIsoAfter(current: string, candidate: string): string {
  const currentMs = Date.parse(current)
  const candidateMs = Date.parse(candidate)
  return new Date(Math.max(candidateMs, currentMs + 1)).toISOString()
}

function transitionRequestFingerprint(request: TransitionTaskRequestType): string {
  const { requestId: _requestId, ...payload } = request
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function taskEventPublicationKey(taskId: string, eventId: string): string {
  return `${taskId}\u0000${eventId}`
}

function toTask(record: TaskRecord): Task {
  return TaskSchema.parse({
    id: record.id,
    threadId: record.threadId,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    steps: record.steps,
    events: record.events,
    result: record.result,
    ...(record.waitingFor ? { waitingFor: record.waitingFor } : {}),
    ...(record.resumeStatus ? { resumeStatus: record.resumeStatus } : {})
  })
}
