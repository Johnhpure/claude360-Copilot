import { z } from 'zod'

export const TASK_RESULT_MAX_BYTES = 64 * 1024
export const TASK_RESULT_MAX_DEPTH = 8

const TASK_ID_PATTERN = /^[A-Za-z0-9_-]+$/
export const TaskIdSchema = z.string().trim().min(1).max(256).regex(TASK_ID_PATTERN)
const TaskTimestamp = z.string().datetime({ offset: true })
const TaskTitle = z.string().trim().min(1).max(500)

export const TaskStatus = z.enum([
  'created',
  'planning',
  'running',
  'waiting',
  'verifying',
  'completed',
  'failed'
])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskResumeStatus = z.enum(['planning', 'running', 'verifying'])
export type TaskResumeStatus = z.infer<typeof TaskResumeStatus>

export const TaskStepStatus = z.enum([
  'pending',
  'running',
  'waiting',
  'verifying',
  'completed',
  'failed',
  'skipped'
])
export type TaskStepStatus = z.infer<typeof TaskStepStatus>

function jsonValueError(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>
): string | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'must contain finite numbers'
  if (typeof value !== 'object') return 'must contain JSON-serializable values only'
  if (depth > TASK_RESULT_MAX_DEPTH) return `must not exceed depth ${TASK_RESULT_MAX_DEPTH}`
  if (ancestors.has(value)) return 'must not contain circular references'

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const error = jsonValueError(entry, depth + 1, ancestors)
        if (error) return error
      }
      return null
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return 'must contain plain JSON objects only'
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return 'must not contain symbol properties'
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      const error = jsonValueError(child, depth + 1, ancestors)
      if (error) return error
    }
    return null
  } catch {
    return 'must be safely readable as JSON'
  } finally {
    ancestors.delete(value)
  }
}

const TaskJsonValue = z.preprocess((value, context) => {
  const error = jsonValueError(value, 0, new WeakSet<object>())
  if (!error) return value
  context.addIssue({ code: 'custom', message: `Task result data ${error}.` })
  return z.NEVER
}, z.json())

export const TaskResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(4_000),
    data: TaskJsonValue.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= TASK_RESULT_MAX_BYTES) return
    context.addIssue({
      code: 'custom',
      message: 'Task result exceeds the 64 KiB serialized limit.'
    })
  })
export type TaskResult = z.infer<typeof TaskResultSchema>

export const TaskWaitingForSchema = z
  .object({
    kind: z.enum(['approval', 'user_input', 'dependency', 'runtime_recovery', 'manual']),
    refId: TaskIdSchema.optional()
  })
  .strict()
export type TaskWaitingFor = z.infer<typeof TaskWaitingForSchema>

export const TaskStepSchema = z
  .object({
    id: TaskIdSchema,
    title: TaskTitle,
    status: TaskStepStatus,
    createdAt: TaskTimestamp,
    updatedAt: TaskTimestamp,
    result: TaskResultSchema.optional()
  })
  .strict()
export type TaskStep = z.infer<typeof TaskStepSchema>

export const TaskEventType = z.enum([
  'created',
  'status_changed',
  'step_updated',
  'result_set',
  'runtime_recovery',
  'failed'
])
export type TaskEventType = z.infer<typeof TaskEventType>

export const TaskEventSchema = z
  .object({
    id: TaskIdSchema,
    taskId: TaskIdSchema,
    type: TaskEventType,
    at: TaskTimestamp,
    fromStatus: TaskStatus.optional(),
    toStatus: TaskStatus.optional(),
    stepId: TaskIdSchema.optional(),
    stepStatus: TaskStepStatus.optional(),
    message: z.string().trim().min(1).max(2_000).optional(),
    code: z.string().trim().min(1).max(128).optional(),
    runtimeSeq: z.number().int().nonnegative().optional()
  })
  .strict()
export type TaskEvent = z.infer<typeof TaskEventSchema>

const TaskEntitySchema = z
  .object({
    id: TaskIdSchema,
    threadId: TaskIdSchema,
    title: TaskTitle,
    status: TaskStatus,
    createdAt: TaskTimestamp,
    updatedAt: TaskTimestamp,
    steps: z.array(TaskStepSchema).max(1_000),
    events: z.array(TaskEventSchema).max(10_000),
    result: TaskResultSchema.nullable(),
    waitingFor: TaskWaitingForSchema.optional(),
    resumeStatus: TaskResumeStatus.optional()
  })
  .strict()

function validateTaskEntity(
  task: z.infer<typeof TaskEntitySchema>,
  context: z.RefinementCtx
): void {
  if (task.status === 'completed' && task.result === null) {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: 'completed task requires a result'
    })
  }
  if (task.status === 'waiting' && !task.resumeStatus) {
    context.addIssue({
      code: 'custom',
      path: ['resumeStatus'],
      message: 'waiting task requires resumeStatus'
    })
  }
  if (task.status !== 'waiting' && (task.waitingFor || task.resumeStatus)) {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'waiting metadata is only valid for waiting tasks'
    })
  }

  const stepIds = new Set<string>()
  for (const [index, step] of task.steps.entries()) {
    if (!stepIds.has(step.id)) {
      stepIds.add(step.id)
      continue
    }
    context.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: 'duplicate step id' })
  }
  const eventIds = new Set<string>()
  for (const [index, event] of task.events.entries()) {
    if (event.taskId !== task.id) {
      context.addIssue({
        code: 'custom',
        path: ['events', index, 'taskId'],
        message: 'event taskId must match task id'
      })
    }
    if (eventIds.has(event.id)) {
      context.addIssue({
        code: 'custom',
        path: ['events', index, 'id'],
        message: 'duplicate task event id'
      })
    }
    eventIds.add(event.id)
  }
}

export const TaskSchema = TaskEntitySchema.superRefine(validateTaskEntity)
export type Task = z.infer<typeof TaskSchema>

const TaskProcessedRequestSchema = z
  .object({
    id: TaskIdSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()

export const TaskRecordSchema = TaskEntitySchema
  .extend({
    schemaVersion: z.literal(1),
    pendingPublicationEventIds: z.array(TaskIdSchema).max(10_000),
    processedRequests: z.array(TaskProcessedRequestSchema).max(100)
  })
  .strict()
  .superRefine((record, context) => {
    validateTaskEntity(record, context)
    const eventIds = new Set(record.events.map((event) => event.id))
    const pendingIds = new Set<string>()
    for (const [index, eventId] of record.pendingPublicationEventIds.entries()) {
      if (!eventIds.has(eventId)) {
        context.addIssue({
          code: 'custom',
          path: ['pendingPublicationEventIds', index],
          message: 'pending publication must reference an existing task event'
        })
      }
      if (pendingIds.has(eventId)) {
        context.addIssue({
          code: 'custom',
          path: ['pendingPublicationEventIds', index],
          message: 'duplicate pending publication id'
        })
      }
      pendingIds.add(eventId)
    }
    const processedRequestIds = new Set<string>()
    for (const [index, request] of record.processedRequests.entries()) {
      if (processedRequestIds.has(request.id)) {
        context.addIssue({
          code: 'custom',
          path: ['processedRequests', index, 'id'],
          message: 'duplicate processed request id'
        })
      }
      processedRequestIds.add(request.id)
    }
  })
export type TaskRecord = z.infer<typeof TaskRecordSchema>

const CreateTaskStepRequest = z
  .object({
    id: TaskIdSchema.optional(),
    title: TaskTitle
  })
  .strict()

export const CreateTaskRequest = z
  .object({
    threadId: TaskIdSchema,
    title: TaskTitle,
    steps: z.array(CreateTaskStepRequest).max(1_000).optional()
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>()
    for (const [index, step] of (request.steps ?? []).entries()) {
      if (!step.id) continue
      if (ids.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'id'],
          message: 'duplicate step id'
        })
      }
      ids.add(step.id)
    }
  })
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>

export const TransitionTaskRequest = z
  .object({
    to: TaskStatus,
    expectedUpdatedAt: TaskTimestamp,
    requestId: TaskIdSchema.optional(),
    waitingFor: TaskWaitingForSchema.optional(),
    result: TaskResultSchema.optional(),
    message: z.string().trim().min(1).max(2_000).optional(),
    code: z.string().trim().min(1).max(128).optional()
  })
  .strict()
export type TransitionTaskRequest = z.infer<typeof TransitionTaskRequest>

export const UpdateTaskStepRequest = z
  .object({
    stepId: TaskIdSchema,
    status: TaskStepStatus,
    expectedUpdatedAt: TaskTimestamp,
    result: TaskResultSchema.optional()
  })
  .strict()
export type UpdateTaskStepRequest = z.infer<typeof UpdateTaskStepRequest>

export const ResumeTaskRequest = z
  .object({ expectedUpdatedAt: TaskTimestamp })
  .strict()
export type ResumeTaskRequest = z.infer<typeof ResumeTaskRequest>

export const ListTasksRequest = z
  .object({
    status: TaskStatus.optional(),
    threadId: TaskIdSchema.optional(),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.number().int().positive().max(100).default(20)
  })
  .strict()
export type ListTasksRequest = z.infer<typeof ListTasksRequest>
export type ListTasksInput = z.input<typeof ListTasksRequest>

export const ListTasksResponse = z
  .object({
    tasks: z.array(TaskSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean()
  })
  .strict()
export type ListTasksResponse = z.infer<typeof ListTasksResponse>

export const TaskCursorSchema = z
  .object({
    version: z.literal(1),
    updatedAt: TaskTimestamp,
    id: TaskIdSchema
  })
  .strict()
export type TaskCursor = z.infer<typeof TaskCursorSchema>

export function encodeTaskCursor(input: Omit<TaskCursor, 'version'>): string {
  const cursor = TaskCursorSchema.parse({ version: 1, ...input })
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodeTaskCursor(value: string): TaskCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2_048) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    const cursor = TaskCursorSchema.safeParse(parsed)
    return cursor.success ? cursor.data : null
  } catch {
    return null
  }
}
