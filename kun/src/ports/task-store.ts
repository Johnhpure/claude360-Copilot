import type { TaskRecord, TaskStatus } from '../contracts/tasks.js'

export type TaskStoreCursor = Pick<TaskRecord, 'updatedAt' | 'id'>

export type TaskStoreListOptions = {
  status?: TaskStatus
  threadId?: string
  before?: TaskStoreCursor
  limit?: number
}

export type TaskStoreCompareAndSwapResult = 'updated' | 'conflict' | 'missing'

export interface TaskStore {
  create(record: TaskRecord): Promise<TaskRecord>
  get(id: string): Promise<TaskRecord | null>
  list(options?: TaskStoreListOptions): Promise<TaskRecord[]>
  compareAndSwap(
    id: string,
    expectedUpdatedAt: string,
    next: TaskRecord
  ): Promise<TaskStoreCompareAndSwapResult>
}
