import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileTaskStore } from '../src/adapters/file/file-task-store.js'
import { SequentialIdGenerator } from '../src/ports/id-generator.js'
import { dispatchRequest } from '../src/server/http-server.js'
import { TaskService } from '../src/services/task-service.js'
import {
  buildHarness,
  readJson,
  readSseEvents
} from './http-server-test-harness.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function buildTaskHarness() {
  const harness = buildHarness()
  const rootDir = await mkdtemp(join(tmpdir(), 'kun-task-http-'))
  roots.push(rootDir)
  let clock = Date.parse('2026-07-15T10:00:00.000Z')
  const taskService = new TaskService({
    store: new FileTaskStore({ rootDir }),
    sessionStore: harness.sessionStore,
    events: harness.runtime.events,
    ids: new SequentialIdGenerator(),
    nowIso: () => new Date(clock++).toISOString(),
    getThread: (threadId) => harness.threadService.get(threadId)
  })
  Object.assign(harness.runtime, { taskService })
  const thread = await harness.threadService.create(
    { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
    { id: 'thr_tasks', title: 'Task thread' }
  )
  return { ...harness, taskService, thread }
}

function request(path: string, options: RequestInit = {}): Request {
  const headers = new Headers(options.headers)
  headers.set('authorization', 'Bearer tok-1')
  if (options.body) headers.set('content-type', 'application/json')
  return new Request(`http://localhost${path}`, { ...options, headers })
}

async function createTask(
  harness: Awaited<ReturnType<typeof buildTaskHarness>>,
  title = 'Release task'
) {
  const response = await dispatchRequest(
    harness.router,
    request('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        threadId: harness.thread.id,
        title,
        steps: [{ title: 'Run checks' }]
      })
    })
  )
  return { response, body: await readJson(response) as {
    id: string
    status: string
    updatedAt: string
    result: unknown
    steps: Array<{ id: string; status: string }>
    events: Array<{ runtimeSeq?: number }>
  } }
}

describe('task HTTP API', () => {
  it('creates, queries, transitions, and updates a task step', async () => {
    const harness = await buildTaskHarness()
    const created = await createTask(harness)

    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'created', result: null })
    const planningResponse = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${created.body.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          to: 'planning',
          expectedUpdatedAt: created.body.updatedAt,
          requestId: 'request_http_1'
        })
      })
    )
    const planning = await readJson(planningResponse) as { updatedAt: string; status: string }
    expect(planningResponse.status).toBe(200)
    expect(planning.status).toBe('planning')

    const stepResponse = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${created.body.id}/steps`, {
        method: 'PATCH',
        body: JSON.stringify({
          stepId: created.body.steps[0]?.id,
          status: 'completed',
          expectedUpdatedAt: planning.updatedAt,
          result: { summary: 'passed' }
        })
      })
    )
    expect(stepResponse.status).toBe(200)
    expect(await readJson(stepResponse)).toMatchObject({
      steps: [expect.objectContaining({ status: 'completed' })]
    })

    const detail = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${created.body.id}`)
    )
    const list = await dispatchRequest(
      harness.router,
      request(`/v1/tasks?thread_id=${harness.thread.id}&limit=1`)
    )
    const camelCaseList = await dispatchRequest(
      harness.router,
      request(`/v1/tasks?threadId=${harness.thread.id}&limit=1`)
    )
    expect(detail.status).toBe(200)
    expect(await readJson(list)).toMatchObject({
      tasks: [expect.objectContaining({ id: created.body.id })],
      hasMore: false,
      nextCursor: null
    })
    expect(camelCaseList.status).toBe(200)
  })

  it('maps validation, not-found, stale-write, and invalid-transition errors', async () => {
    const harness = await buildTaskHarness()
    const invalid = await dispatchRequest(
      harness.router,
      request('/v1/tasks', { method: 'POST', body: '{}' })
    )
    expect(invalid.status).toBe(400)
    expect(await readJson(invalid)).toMatchObject({ code: 'validation_error' })

    const invalidFilter = await dispatchRequest(
      harness.router,
      request('/v1/tasks?threadId=not%2Fa%2Fthread')
    )
    expect(invalidFilter.status).toBe(400)
    expect(await readJson(invalidFilter)).toMatchObject({ code: 'validation_error' })

    const duplicateSteps = await dispatchRequest(
      harness.router,
      request('/v1/tasks', {
        method: 'POST',
        body: JSON.stringify({
          threadId: harness.thread.id,
          title: 'Duplicate steps',
          steps: [
            { id: 'step_duplicate', title: 'First' },
            { id: 'step_duplicate', title: 'Second' }
          ]
        })
      })
    )
    expect(duplicateSteps.status).toBe(400)
    expect(await readJson(duplicateSteps)).toMatchObject({ code: 'validation_error' })

    const missing = await dispatchRequest(harness.router, request('/v1/tasks/task_missing'))
    expect(missing.status).toBe(404)
    expect(await readJson(missing)).toMatchObject({ code: 'not_found' })

    const created = await createTask(harness)
    const planning = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${created.body.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ to: 'planning', expectedUpdatedAt: created.body.updatedAt })
      })
    )
    const planningBody = await readJson(planning) as { updatedAt: string }
    const stale = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${created.body.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ to: 'failed', expectedUpdatedAt: created.body.updatedAt })
      })
    )
    expect(stale.status).toBe(409)
    expect(await readJson(stale)).toMatchObject({ code: 'conflict' })

    const invalidTransition = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${created.body.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({
          to: 'completed',
          expectedUpdatedAt: planningBody.updatedAt,
          result: { summary: 'too soon' }
        })
      })
    )
    expect(invalidTransition.status).toBe(409)
    expect(await readJson(invalidTransition)).toMatchObject({ code: 'invalid_transition' })
  })

  it('resumes a waiting task only to its persisted resumeStatus', async () => {
    const harness = await buildTaskHarness()
    const created = await createTask(harness)
    let task = await harness.taskService.transition(created.body.id, {
      to: 'planning',
      expectedUpdatedAt: created.body.updatedAt
    })
    task = await harness.taskService.transition(task.id, {
      to: 'running',
      expectedUpdatedAt: task.updatedAt
    })
    task = await harness.taskService.transition(task.id, {
      to: 'waiting',
      expectedUpdatedAt: task.updatedAt,
      waitingFor: { kind: 'user_input', refId: 'input_1' }
    })

    const response = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${task.id}/resume`, {
        method: 'POST',
        body: JSON.stringify({ expectedUpdatedAt: task.updatedAt })
      })
    )

    expect(response.status).toBe(200)
    expect(await readJson(response)).toMatchObject({ status: 'running' })
  })

  it('replays only the selected task events through since_seq SSE', async () => {
    const harness = await buildTaskHarness()
    const first = await createTask(harness, 'First')
    const planning = await harness.taskService.transition(first.body.id, {
      to: 'planning',
      expectedUpdatedAt: first.body.updatedAt
    })
    await createTask(harness, 'Second')
    const firstSeq = first.body.events[0]?.runtimeSeq ?? 0
    const controller = new AbortController()

    const response = await dispatchRequest(
      harness.router,
      request(`/v1/tasks/${first.body.id}/events?since_seq=${firstSeq}`, {
        signal: controller.signal
      })
    )
    const frames = await readSseEvents(response)
    controller.abort()
    const payloads = frames
      .flatMap((frame) => frame.split('\n').filter((line) => line.startsWith('data: ')))
      .map((line) => JSON.parse(line.slice(6)) as {
        kind: string
        taskId?: string
        event?: { id: string }
      })

    expect(response.status).toBe(200)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({
      kind: 'task_event',
      taskId: first.body.id,
      event: { id: planning.events.at(-1)?.id }
    })
  })
})
