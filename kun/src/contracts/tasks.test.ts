import { describe, expect, it } from 'vitest'
import {
  CreateTaskRequest,
  TaskRecordSchema,
  TaskResultSchema,
  TaskSchema,
  TaskStatus,
  TransitionTaskRequest,
  decodeTaskCursor,
  encodeTaskCursor
} from './tasks.js'
import { RuntimeEvent, RuntimeEventKind } from './events.js'

const CREATED_AT = '2026-07-15T10:00:00.000Z'

function taskFixture(): unknown {
  return {
    id: 'task_1',
    threadId: 'thr_1',
    title: 'Prepare release',
    status: 'created',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    steps: [{
      id: 'step_1',
      title: 'Run checks',
      status: 'pending',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    }],
    events: [{
      id: 'task_evt_1',
      taskId: 'task_1',
      type: 'created',
      at: CREATED_AT
    }],
    result: null
  }
}

describe('task contracts', () => {
  it('accepts exactly the seven task states', () => {
    expect(TaskStatus.options).toEqual([
      'created',
      'planning',
      'running',
      'waiting',
      'verifying',
      'completed',
      'failed'
    ])
    expect(() => TaskStatus.parse('queued')).toThrow()
  })

  it('round-trips a complete task entity and its persisted record', () => {
    const task = TaskSchema.parse(taskFixture())
    expect(TaskSchema.parse(JSON.parse(JSON.stringify(task)))).toEqual(task)

    const record = TaskRecordSchema.parse({
      ...task,
      schemaVersion: 1,
      pendingPublicationEventIds: ['task_evt_1'],
      processedRequests: []
    })
    expect(record.schemaVersion).toBe(1)
  })

  it('rejects inconsistent entity and outbox invariants at the disk boundary', () => {
    expect(() => TaskSchema.parse({
      ...taskFixture() as Record<string, unknown>,
      status: 'completed',
      result: null
    })).toThrow(/completed task requires a result/)
    expect(() => TaskSchema.parse({
      ...taskFixture() as Record<string, unknown>,
      status: 'waiting'
    })).toThrow(/waiting task requires resumeStatus/)
    expect(() => TaskSchema.parse({
      ...taskFixture() as Record<string, unknown>,
      events: [{
        id: 'task_evt_1',
        taskId: 'task_other',
        type: 'created',
        at: CREATED_AT
      }]
    })).toThrow(/event taskId/)
    expect(() => TaskRecordSchema.parse({
      ...taskFixture() as Record<string, unknown>,
      schemaVersion: 1,
      pendingPublicationEventIds: ['task_evt_missing'],
      processedRequests: []
    })).toThrow(/pending publication/)
  })

  it('accepts bounded JSON result data and rejects unsafe values', () => {
    expect(TaskResultSchema.parse({
      summary: 'Checks passed',
      data: { counts: [1, 2, 3], stable: true, note: null }
    })).toMatchObject({ summary: 'Checks passed' })

    expect(() => TaskResultSchema.parse({ summary: 'bad', data: Buffer.from('secret') })).toThrow()
    expect(() => TaskResultSchema.parse({ summary: 'bad', data: { run: () => 'nope' } })).toThrow()
    expect(() => TaskResultSchema.parse({
      summary: 'too large',
      data: { text: 'x'.repeat(70 * 1024) }
    })).toThrow(/64 KiB/)

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => TaskResultSchema.parse({ summary: 'cycle', data: circular })).toThrow()
  })

  it('validates create and transition request boundaries', () => {
    expect(CreateTaskRequest.parse({
      threadId: 'thr_1',
      title: '  Prepare release  ',
      steps: [{ title: '  Run checks  ' }]
    })).toEqual({
      threadId: 'thr_1',
      title: 'Prepare release',
      steps: [{ title: 'Run checks' }]
    })
    expect(() => CreateTaskRequest.parse({
      threadId: 'thr_1',
      title: 'Prepare release',
      steps: [
        { id: 'step_duplicate', title: 'First' },
        { id: 'step_duplicate', title: 'Second' }
      ]
    })).toThrow(/duplicate step id/)

    expect(TransitionTaskRequest.parse({
      to: 'running',
      expectedUpdatedAt: CREATED_AT,
      requestId: 'request_1'
    })).toMatchObject({ to: 'running', requestId: 'request_1' })
    expect(() => TransitionTaskRequest.parse({
      to: 'completed',
      expectedUpdatedAt: CREATED_AT,
      result: { summary: '', data: undefined }
    })).toThrow()
  })

  it('encodes an opaque base64url cursor and rejects malformed cursors', () => {
    const cursor = encodeTaskCursor({ updatedAt: CREATED_AT, id: 'task_1' })
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeTaskCursor(cursor)).toEqual({
      version: 1,
      updatedAt: CREATED_AT,
      id: 'task_1'
    })
    expect(decodeTaskCursor('not/a/cursor')).toBeNull()
    expect(decodeTaskCursor(Buffer.from('{}').toString('base64url'))).toBeNull()
  })

  it('adds one lightweight task_event runtime event kind', () => {
    expect(RuntimeEventKind.options.filter((kind) => kind === 'task_event')).toEqual(['task_event'])
    expect(RuntimeEvent.parse({
      kind: 'task_event',
      seq: 7,
      timestamp: CREATED_AT,
      threadId: 'thr_1',
      taskId: 'task_1',
      event: {
        id: 'task_evt_1',
        taskId: 'task_1',
        type: 'status_changed',
        at: CREATED_AT,
        fromStatus: 'planning',
        toStatus: 'running'
      }
    })).toMatchObject({ kind: 'task_event', taskId: 'task_1' })
  })
})
