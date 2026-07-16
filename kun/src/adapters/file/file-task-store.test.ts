import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskRecordSchema, type TaskRecord, type TaskStatus } from '../../contracts/tasks.js'
import { FileTaskStore } from './file-task-store.js'

const roots: string[] = []
const BASE_TIME = Date.parse('2026-07-15T10:00:00.000Z')

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-task-store-'))
  roots.push(root)
  return root
}

function recordFixture(options: {
  id?: string
  threadId?: string
  status?: TaskStatus
  offsetMs?: number
} = {}): TaskRecord {
  const id = options.id ?? 'task_1'
  const at = new Date(BASE_TIME + (options.offsetMs ?? 0)).toISOString()
  const eventId = `task_evt_${id}`
  return TaskRecordSchema.parse({
    schemaVersion: 1,
    id,
    threadId: options.threadId ?? 'thr_1',
    title: `Task ${id}`,
    status: options.status ?? 'created',
    createdAt: at,
    updatedAt: at,
    steps: [],
    events: [{ id: eventId, taskId: id, type: 'created', at, runtimeSeq: 1 }],
    result: null,
    pendingPublicationEventIds: [],
    processedRequests: []
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('FileTaskStore', () => {
  it('round-trips a task across store instances using one atomic JSON file', async () => {
    const rootDir = await makeRoot()
    const record = recordFixture()
    await new FileTaskStore({ rootDir }).create(record)

    expect(await new FileTaskStore({ rootDir }).get(record.id)).toEqual(record)
    expect(await readdir(rootDir)).toEqual([`${record.id}.json`])
  })

  it('allows only one concurrent compare-and-swap for the same updatedAt', async () => {
    const rootDir = await makeRoot()
    const store = new FileTaskStore({ rootDir })
    const current = recordFixture()
    await store.create(current)
    const planning = TaskRecordSchema.parse({
      ...current,
      status: 'planning',
      updatedAt: new Date(BASE_TIME + 1).toISOString()
    })
    const failed = TaskRecordSchema.parse({
      ...current,
      status: 'failed',
      updatedAt: new Date(BASE_TIME + 2).toISOString()
    })

    const results = await Promise.all([
      store.compareAndSwap(current.id, current.updatedAt, planning),
      store.compareAndSwap(current.id, current.updatedAt, failed)
    ])

    expect(results.sort()).toEqual(['conflict', 'updated'])
  })

  it('lists by stable descending cursor order and isolates corrupt files', async () => {
    const rootDir = await makeRoot()
    const warnings: string[] = []
    const store = new FileTaskStore({ rootDir, warn: (message) => warnings.push(message) })
    const old = recordFixture({ id: 'task_old', offsetMs: 1 })
    const tieA = recordFixture({ id: 'task_a', threadId: 'thr_2', status: 'running', offsetMs: 2 })
    const tieB = recordFixture({ id: 'task_b', threadId: 'thr_2', status: 'running', offsetMs: 2 })
    await Promise.all([store.create(old), store.create(tieA), store.create(tieB)])
    await writeFile(join(rootDir, 'task_broken.json'), '{bad-json', 'utf8')

    expect((await store.list({ limit: 2 })).map((record) => record.id)).toEqual([
      'task_b',
      'task_a'
    ])
    expect((await store.list({
      threadId: 'thr_2',
      status: 'running',
      before: { updatedAt: tieB.updatedAt, id: tieB.id },
      limit: 10
    })).map((record) => record.id)).toEqual(['task_a'])
    expect(warnings).toEqual([expect.stringContaining('task_broken.json')])
  })

  it('uses the same bytewise id order for sorting and cursor filtering', async () => {
    const rootDir = await makeRoot()
    const store = new FileTaskStore({ rootDir })
    const upper = recordFixture({ id: 'task_Z', offsetMs: 1 })
    const lower = recordFixture({ id: 'task_a', offsetMs: 1 })
    await Promise.all([store.create(upper), store.create(lower)])

    const firstPage = await store.list({ limit: 1 })
    expect(firstPage.map((record) => record.id)).toEqual(['task_a'])
    expect((await store.list({
      before: { updatedAt: lower.updatedAt, id: lower.id },
      limit: 1
    })).map((record) => record.id)).toEqual(['task_Z'])
  })

  it.skipIf(process.platform === 'win32')('does not follow task record symlinks', async () => {
    const rootDir = await makeRoot()
    const externalRoot = await makeRoot()
    const record = recordFixture({ id: 'task_link' })
    const externalPath = join(externalRoot, 'external.json')
    const warnings: string[] = []
    await writeFile(externalPath, JSON.stringify(record), 'utf8')
    await symlink(externalPath, join(rootDir, 'task_link.json'))
    const store = new FileTaskStore({ rootDir, warn: (message) => warnings.push(message) })

    expect(await store.get(record.id)).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('non-regular task record')])
    await expect(store.create(record)).rejects.toThrow('task already exists')
  })

  it('keeps the previous record when the atomic writer fails', async () => {
    const rootDir = await makeRoot()
    const current = recordFixture()
    await new FileTaskStore({ rootDir }).create(current)
    const next = TaskRecordSchema.parse({
      ...current,
      status: 'planning',
      updatedAt: new Date(BASE_TIME + 1).toISOString()
    })
    const failing = new FileTaskStore({
      rootDir,
      writeAtomic: async () => {
        throw new Error('rename failed')
      }
    })

    await expect(failing.compareAndSwap(current.id, current.updatedAt, next))
      .rejects.toThrow('rename failed')
    expect(await new FileTaskStore({ rootDir }).get(current.id)).toEqual(current)
  })
})
