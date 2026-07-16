import { z } from 'zod'
import {
  CreateTaskRequest,
  ResumeTaskRequest,
  TaskIdSchema,
  TaskSchema,
  TaskStatus,
  TransitionTaskRequest,
  UpdateTaskStepRequest
} from '../../contracts/tasks.js'
import type { TaskService } from '../../services/task-service.js'
import { TaskServiceError } from '../../services/task-service.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { SessionStore } from '../../ports/session-store.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { buildEventStreamResponse } from './events.js'
import { ERRORS } from './runtime-error.js'

const ListTasksQuery = z
  .object({
    status: TaskStatus.optional(),
    thread_id: TaskIdSchema.optional(),
    threadId: TaskIdSchema.optional(),
    cursor: z.string().min(1).max(2_048).optional(),
    limit: z.preprocess((value) => {
      if (typeof value !== 'string' || value.trim() === '') return undefined
      return Number(value)
    }, z.number().int().positive().max(100).default(20))
  })
  .strict()
  .refine(
    (value) => !value.thread_id || !value.threadId || value.thread_id === value.threadId,
    { message: 'threadId filters must match' }
  )

export async function listTasks(
  service: TaskService,
  request: Request
): Promise<JsonResponse> {
  const url = new URL(request.url)
  const parsed = ListTasksQuery.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) return ERRORS.validation('invalid list tasks query', parsed.error.issues)
  try {
    const threadId = parsed.data.threadId ?? parsed.data.thread_id
    return jsonResponse(await service.list({
      limit: parsed.data.limit,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(threadId ? { threadId } : {}),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {})
    }))
  } catch (error) {
    return taskErrorResponse(error)
  }
}

export async function createTask(
  service: TaskService,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = CreateTaskRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid create task body', parsed.error.issues)
  try {
    return jsonResponse(TaskSchema.parse(await service.create(parsed.data)), 201)
  } catch (error) {
    return taskErrorResponse(error)
  }
}

export async function getTask(service: TaskService, taskId: string): Promise<JsonResponse> {
  const task = await service.get(taskId)
  return task
    ? jsonResponse(TaskSchema.parse(task))
    : ERRORS.notFound(`task not found: ${taskId}`)
}

export async function transitionTask(
  service: TaskService,
  taskId: string,
  request: Request
): Promise<JsonResponse> {
  return parseTaskMutation(request, TransitionTaskRequest, (value) =>
    service.transition(taskId, value))
}

export async function updateTaskStep(
  service: TaskService,
  taskId: string,
  request: Request
): Promise<JsonResponse> {
  return parseTaskMutation(request, UpdateTaskStepRequest, (value) =>
    service.updateStep(taskId, value))
}

export async function resumeTask(
  service: TaskService,
  taskId: string,
  request: Request
): Promise<JsonResponse> {
  return parseTaskMutation(request, ResumeTaskRequest, (value) =>
    service.resume(taskId, value))
}

export async function taskEvents(
  service: TaskService,
  taskId: string,
  request: Request,
  eventBus: EventBus,
  sessionStore: SessionStore
): Promise<Response | JsonResponse> {
  const task = await service.get(taskId)
  if (!task) return ERRORS.notFound(`task not found: ${taskId}`)
  return buildEventStreamResponse({
    request,
    threadId: task.threadId,
    eventBus,
    sessionStore,
    predicate: (event) => event.kind === 'task_event' && event.taskId === taskId
  })
}

async function parseTaskMutation<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  mutate: (value: z.output<Schema>) => Promise<unknown>
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid task mutation body', parsed.error.issues)
  try {
    return jsonResponse(TaskSchema.parse(await mutate(parsed.data)))
  } catch (error) {
    return taskErrorResponse(error)
  }
}

function taskErrorResponse(error: unknown): JsonResponse {
  if (!(error instanceof TaskServiceError)) throw error
  if (error.code === 'validation') return ERRORS.validation(error.message)
  if (error.code === 'not_found') return ERRORS.notFound(error.message)
  if (error.code === 'conflict') return ERRORS.conflict(error.message)
  return ERRORS.invalidTransition(error.message)
}
