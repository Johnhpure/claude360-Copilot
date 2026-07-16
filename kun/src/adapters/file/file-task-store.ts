import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { TaskRecordSchema, type TaskRecord } from '../../contracts/tasks.js'
import type {
  TaskStore,
  TaskStoreCompareAndSwapResult,
  TaskStoreListOptions
} from '../../ports/task-store.js'
import { atomicWriteFile } from './atomic-write.js'

const TASK_FILE_PATTERN = /^([A-Za-z0-9_-]+)\.json$/

export type FileTaskStoreOptions = {
  rootDir: string
  writeAtomic?: (path: string, contents: string) => Promise<void>
  warn?: (message: string) => void
}

export class FileTaskStore implements TaskStore {
  private readonly rootDir: string
  private readonly writeAtomic: (path: string, contents: string) => Promise<void>
  private readonly warn: (message: string) => void
  private readonly queues = new Map<string, Promise<void>>()
  private readonly warnedFiles = new Set<string>()

  constructor(options: FileTaskStoreOptions) {
    this.rootDir = resolve(options.rootDir)
    this.writeAtomic = options.writeAtomic ?? atomicWriteFile
    this.warn = options.warn ?? ((message) => console.warn(message))
  }

  async create(record: TaskRecord): Promise<TaskRecord> {
    const validated = TaskRecordSchema.parse(record)
    return this.enqueue(validated.id, async () => {
      await mkdir(this.rootDir, { recursive: true })
      const path = this.recordPath(validated.id)
      const exists = await lstat(path).then(() => true).catch(() => false)
      if (exists) throw new Error(`task already exists: ${validated.id}`)
      await this.writeRecord(path, validated)
      return cloneRecord(validated)
    })
  }

  async get(id: string): Promise<TaskRecord | null> {
    if (!isSafeTaskId(id)) return null
    const path = this.recordPath(id)
    try {
      const info = await lstat(path)
      if (!info.isFile()) {
        this.warnOnce(path, 'non-regular task record')
        return null
      }
      const parsed = TaskRecordSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      if (parsed.success) return parsed.data
      this.warnOnce(path, 'invalid task record')
      return null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      this.warnOnce(path, 'unreadable task record')
      return null
    }
  }

  async list(options: TaskStoreListOptions = {}): Promise<TaskRecord[]> {
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir, { withFileTypes: true }).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.isFile() && TASK_FILE_PATTERN.test(entry.name))
      .map((entry) => this.get(TASK_FILE_PATTERN.exec(entry.name)?.[1] ?? '')))
    const beforeTime = options.before ? Date.parse(options.before.updatedAt) : null
    const filtered = records
      .filter((record): record is TaskRecord => record !== null)
      .filter((record) => !options.status || record.status === options.status)
      .filter((record) => !options.threadId || record.threadId === options.threadId)
      .filter((record) => {
        if (!options.before || beforeTime === null) return true
        const recordTime = Date.parse(record.updatedAt)
        return recordTime < beforeTime || (
          recordTime === beforeTime && record.id < options.before.id
        )
      })
      .sort(compareTaskRecordsDescending)
    return filtered.slice(0, options.limit ?? filtered.length).map(cloneRecord)
  }

  async compareAndSwap(
    id: string,
    expectedUpdatedAt: string,
    next: TaskRecord
  ): Promise<TaskStoreCompareAndSwapResult> {
    const validated = TaskRecordSchema.parse(next)
    if (validated.id !== id || !isSafeTaskId(id)) {
      throw new Error(`task id mismatch: ${id}`)
    }
    return this.enqueue(id, async () => {
      const current = await this.get(id)
      if (!current) return 'missing'
      if (current.updatedAt !== expectedUpdatedAt) return 'conflict'
      await this.writeRecord(this.recordPath(id), validated)
      return 'updated'
    })
  }

  private recordPath(id: string): string {
    return join(this.rootDir, `${id}.json`)
  }

  private async writeRecord(path: string, record: TaskRecord): Promise<void> {
    await this.writeAtomic(path, `${JSON.stringify(record, null, 2)}\n`)
  }

  private warnOnce(path: string, reason: string): void {
    if (this.warnedFiles.has(path)) return
    this.warnedFiles.add(path)
    this.warn(`[kun] skipped ${reason}: ${basename(path)}`)
  }

  private enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(id, settled)
    void settled.finally(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id)
    })
    return result
  }
}

function isSafeTaskId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value)
}

function cloneRecord(record: TaskRecord): TaskRecord {
  return TaskRecordSchema.parse(structuredClone(record))
}

function compareTaskRecordsDescending(left: TaskRecord, right: TaskRecord): number {
  const timeDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  if (timeDifference !== 0) return timeDifference
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}
