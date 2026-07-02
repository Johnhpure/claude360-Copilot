// 音乐任务 store 测试（Task 5）。
// 状态机用例迁移自 claude360-music-web/src/store/tasks.test.ts 语义，
// 轮询参数（interval / 失败上限）迁移自 usePolling.ts + tasks.ts。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Claude360MusicFetchedTask, Claude360Song, Claude360MusicSubmitPayload } from '@shared/claude360-music'
import {
  createMusicTaskStore,
  sanitizeRehydratedTasks,
  selectActiveTaskIds,
  hasActiveTask,
  loadPersistedTasks,
  serializeTasksForPersist,
  MUSIC_TASK_HISTORY_LIMIT,
  MUSIC_POLL_INTERVAL_MS,
  MUSIC_POLL_FAILURE_LIMIT,
  MUSIC_TASKS_STORAGE_KEY,
  type MusicGenTask
} from './music-task-store'

const payload = (): Claude360MusicSubmitPayload => ({ prompt: '城市夜晚', model: 'V5_5' })
const song = (id: string): Claude360Song => ({ id, audioUrl: `https://cdn/${id}.mp3`, title: `歌曲${id}`, imageUrl: `https://cdn/${id}.png` })

function fetched(overrides: Partial<Claude360MusicFetchedTask> & { taskId: string }): Claude360MusicFetchedTask {
  return { status: 'in_progress', songs: [], ...overrides }
}

// —— 轮询参数：迁移自 music-web ——
describe('轮询参数迁移', () => {
  it('保留 music-web 的失败上限与轮询间隔，均有上限（不无限请求）', () => {
    expect(MUSIC_POLL_FAILURE_LIMIT).toBe(10)
    expect(MUSIC_POLL_INTERVAL_MS).toBe(12000)
    // 本地历史不能无限增长
    expect(MUSIC_TASK_HISTORY_LIMIT).toBeGreaterThan(0)
    expect(MUSIC_TASK_HISTORY_LIMIT).toBeLessThanOrEqual(100)
  })
})

describe('music-task-store 状态机', () => {
  it('submit 后新增一个 submitting 的 local task（无 taskId）', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    const [task] = store.getState().tasks
    expect(task.id).toBe('tmp1')
    expect(task.status).toBe('submitting')
    expect(task.taskId).toBeUndefined()
    expect(task.songs).toEqual([])
  })

  it('markSubmitted 后写入 taskId 并转为 queued', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    store.getState().markSubmitted('tmp1', 'task-abc')
    const [task] = store.getState().tasks
    expect(task.taskId).toBe('task-abc')
    expect(task.status).toBe('queued')
  })

  it('fetch success 后写入 songs 且状态转 success', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    store.getState().markSubmitted('tmp1', 'task-abc')
    store.getState().applyFetched([fetched({ taskId: 'task-abc', status: 'success', songs: [song('s1'), song('s2')] })])
    const [task] = store.getState().tasks
    expect(task.status).toBe('success')
    expect(task.songs.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('fetch failure 后标记 failure 并保留 failReason', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    store.getState().markSubmitted('tmp1', 'task-abc')
    store.getState().applyFetched([fetched({ taskId: 'task-abc', status: 'failure', failReason: '余额不足' })])
    const [task] = store.getState().tasks
    expect(task.status).toBe('failure')
    expect(task.failReason).toBe('余额不足')
  })

  it('markFailed 直接标记提交失败并保留错误', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    store.getState().markFailed('tmp1', '网络错误')
    const [task] = store.getState().tasks
    expect(task.status).toBe('failure')
    expect(task.failReason).toBe('网络错误')
  })

  it('轮询累计 miss 达上限时兜底为 failure（避免未知终态永久轮询）', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    store.getState().markSubmitted('tmp1', 'task-abc')
    // 上游持续不返回该任务：连续 miss
    for (let i = 0; i < MUSIC_POLL_FAILURE_LIMIT; i += 1) {
      store.getState().applyFetched([])
    }
    const [task] = store.getState().tasks
    expect(task.status).toBe('failure')
  })

  it('unresolved（未知上游状态）也计入 miss，不当作 in_progress', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', '城市夜晚', payload())
    store.getState().markSubmitted('tmp1', 'task-abc')
    store.getState().applyFetched([fetched({ taskId: 'task-abc', status: 'in_progress', unresolved: true })])
    const [task] = store.getState().tasks
    expect(task.pollMisses).toBe(1)
    expect(task.status).toBe('queued')
  })

  it('removeTask 删除指定任务', () => {
    const store = createMusicTaskStore()
    store.getState().addSubmitting('tmp1', 'a', payload())
    store.getState().addSubmitting('tmp2', 'b', payload())
    store.getState().removeTask('tmp1')
    expect(store.getState().tasks.map((t) => t.id)).toEqual(['tmp2'])
  })

  it('removeSong 删除单首成功歌曲，任务无歌曲后移除', () => {
    const store = createMusicTaskStore({
      initialTasks: [
        { id: 'task-a', taskId: 'up-a', status: 'success', createdAt: 1, title: 'a', params: payload(), songs: [song('s1'), song('s2')] },
        { id: 'task-b', taskId: 'up-b', status: 'success', createdAt: 2, title: 'b', params: payload(), songs: [song('s3')] }
      ]
    })
    store.getState().removeSong('s1')
    expect(store.getState().tasks.find((t) => t.id === 'task-a')?.songs.map((s) => s.id)).toEqual(['s2'])

    store.getState().removeSong('s3')
    expect(store.getState().tasks.map((t) => t.id)).toEqual(['task-a'])
  })

  it('clearFinishedTasks 清空成功/失败历史，但保留提交中/排队/生成中任务以继续轮询', () => {
    const store = createMusicTaskStore({
      initialTasks: [
        { id: 'submitting', status: 'submitting', createdAt: 1, title: 'submitting', params: payload(), songs: [] },
        { id: 'queued', taskId: 'q', status: 'queued', createdAt: 2, title: 'queued', params: payload(), songs: [] },
        { id: 'running', taskId: 'r', status: 'in_progress', createdAt: 3, title: 'running', params: payload(), songs: [] },
        { id: 'done', taskId: 'd', status: 'success', createdAt: 4, title: 'done', params: payload(), songs: [song('s1')] },
        { id: 'bad', taskId: 'b', status: 'failure', createdAt: 5, title: 'bad', params: payload(), songs: [], failReason: '余额不足' }
      ]
    })
    store.getState().clearFinishedTasks()
    expect(store.getState().tasks.map((t) => t.id)).toEqual(['submitting', 'queued', 'running'])
  })
})

describe('selectActiveTaskIds / hasActiveTask', () => {
  it('只挑出有 taskId 且 queued/in_progress 的任务', () => {
    const tasks: MusicGenTask[] = [
      { id: 'a', taskId: 't-a', status: 'queued', createdAt: 1, title: 'a', params: payload(), songs: [] },
      { id: 'b', taskId: 't-b', status: 'success', createdAt: 1, title: 'b', params: payload(), songs: [] },
      { id: 'c', status: 'submitting', createdAt: 1, title: 'c', params: payload(), songs: [] }
    ]
    expect(selectActiveTaskIds(tasks)).toEqual(['t-a'])
    expect(hasActiveTask(tasks)).toBe(true)
  })
  it('无占用任务时 hasActiveTask 为 false', () => {
    const tasks: MusicGenTask[] = [
      { id: 'b', taskId: 't-b', status: 'success', createdAt: 1, title: 'b', params: payload(), songs: [] }
    ]
    expect(hasActiveTask(tasks)).toBe(false)
  })
})

describe('刷新恢复（sanitizeRehydratedTasks）', () => {
  it('submitting 的僵尸任务（无 taskId）恢复时转 failure，不永久卡住', () => {
    const tasks: MusicGenTask[] = [
      { id: 'a', status: 'submitting', createdAt: 1, title: 'a', params: payload(), songs: [] },
      { id: 'b', taskId: 't-b', status: 'queued', createdAt: 1, title: 'b', params: payload(), songs: [] }
    ]
    const sanitized = sanitizeRehydratedTasks(tasks)
    expect(sanitized[0].status).toBe('failure')
    // 有 taskId 的排队任务保留，刷新后继续轮询
    expect(sanitized[1].status).toBe('queued')
  })
})

describe('本地持久化', () => {
  const store: Record<string, string> = {}
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      }
    }
  })
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage
  })

  it('只保存最近 N 个任务', () => {
    const many: MusicGenTask[] = Array.from({ length: MUSIC_TASK_HISTORY_LIMIT + 5 }, (_, i) => ({
      id: `t${i}`,
      status: 'success',
      createdAt: i,
      title: `t${i}`,
      params: payload(),
      songs: []
    }))
    const serialized = serializeTasksForPersist(many)
    expect(serialized.length).toBe(MUSIC_TASK_HISTORY_LIMIT)
  })

  it('持久化数据不包含 API Key 字段', () => {
    const tasks: MusicGenTask[] = [
      { id: 't1', taskId: 'x', status: 'success', createdAt: 1, title: 't1', params: payload(), songs: [song('s')] }
    ]
    store[MUSIC_TASKS_STORAGE_KEY] = JSON.stringify({ tasks })
    const raw = store[MUSIC_TASKS_STORAGE_KEY]
    expect(raw.toLowerCase()).not.toContain('apikey')
    expect(raw.toLowerCase()).not.toContain('api_key')
    expect(raw).not.toContain('Authorization')
  })

  it('数据损坏时安全恢复为空列表', () => {
    store[MUSIC_TASKS_STORAGE_KEY] = '{not valid json'
    expect(loadPersistedTasks()).toEqual([])
  })

  it('缺 localStorage 时返回空列表', () => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage
    expect(loadPersistedTasks()).toEqual([])
  })

  it('恢复时对 submitting 僵尸任务做 sanitize', () => {
    const tasks: MusicGenTask[] = [
      { id: 'a', status: 'submitting', createdAt: 1, title: 'a', params: payload(), songs: [] }
    ]
    store[MUSIC_TASKS_STORAGE_KEY] = JSON.stringify({ tasks })
    const restored = loadPersistedTasks()
    expect(restored[0].status).toBe('failure')
  })
})
