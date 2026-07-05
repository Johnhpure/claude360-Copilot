// 音乐任务 store（Task 5）。
//
// 迁移自 claude360-music-web/src/store/tasks.ts 的状态机语义，并把轮询参数
// （interval / 失败上限）从 usePolling.ts 一并迁入。与源项目差异：
// - 不迁移独立 auth store；轮询由 UI 层通过 window.kunGui.claude360MusicFetch 驱动，
//   store 只负责状态归约与本地持久化。
// - 持久化用 @renderer/lib/browser-storage（localStorage 守卫），只存最近 N 个任务，
//   不写入任何 API Key / Authorization（Key 只在 main 进程使用）。
import { create, type StoreApi } from 'zustand'
import type {
  Claude360MusicFetchedTask,
  Claude360MusicSubmitPayload,
  Claude360MusicTaskStatus,
  Claude360Song
} from '@shared/claude360-music'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '@renderer/lib/browser-storage'

// —— 轮询 / 历史上限参数（迁移自 music-web；均为硬上限，避免无限请求 / 无限增长）——
export const MUSIC_POLL_INTERVAL_MS = 12000
export const MUSIC_POLL_FAILURE_LIMIT = 10
export const MUSIC_TASK_HISTORY_LIMIT = 60
export const MUSIC_TASKS_STORAGE_KEY = 'c360-copilot-music-tasks'

const POLL_FAILURE_MESSAGE = '任务状态同步失败，请重新提交或联系管理员'

// —— 本地任务（迁移自 music-web GenTask；action 恒为 MUSIC）——
export interface MusicGenTask {
  id: string // 提交前临时 id；拿到 taskId 后保留并补 taskId
  taskId?: string // 上游 task_id
  status: Claude360MusicTaskStatus
  createdAt: number
  title: string // 展示用标题
  params: Claude360MusicSubmitPayload
  songs: Claude360Song[]
  failReason?: string
  pollMisses?: number
}

/** 07-05 本地持久化：单首歌的本地资产状态（与 Claude360Song 平行，按 song.id 关联）。 */
export type SongAssetInfo = {
  localAudioPath?: string
  localCoverPath?: string
  audioMissing?: boolean
  coverMissing?: boolean
}

/** listAssets 返回的音乐记录最小结构（renderer 侧视角）。 */
export type DiskMusicRecord = {
  id: string
  taskId?: string
  status: 'pending' | 'completed' | 'failed'
  title: string
  lyrics?: string
  prompt?: string
  model?: string
  duration?: number
  tags?: string
  createdAt: string
  localAudioPath?: string
  localCoverPath?: string
  remoteAudioUrl?: string
  remoteCoverUrl?: string
  audioMissing?: boolean
  coverMissing?: boolean
}

export interface MusicTasksState {
  tasks: MusicGenTask[]
  /** 07-05：song.id → 本地资产信息（落盘回写 + 磁盘恢复时填充）。 */
  songAssets: Record<string, SongAssetInfo>
  addSubmitting: (tempId: string, title: string, params: Claude360MusicSubmitPayload) => void
  markSubmitted: (tempId: string, taskId: string) => void
  markFailed: (id: string, message: string) => void
  applyFetched: (results: Claude360MusicFetchedTask[]) => void
  removeTask: (id: string) => void
  removeSong: (id: string) => void
  clearFinishedTasks: () => void
  /** 07-05：磁盘资产记录并入任务列表 + songAssets（启动 / 切工作空间时调用）。 */
  hydrateFromDisk: (records: DiskMusicRecord[]) => void
  /** 07-05：单曲落盘成功后回写本地路径。 */
  attachSongAsset: (songId: string, info: SongAssetInfo) => void
}

/**
 * 从持久化恢复时清理“僵尸”任务：status === 'submitting'（无 taskId、刷新后
 * 永远无法完成）的任务归一为 failure，避免永久卡在提交中。
 */
export function sanitizeRehydratedTasks(tasks: MusicGenTask[]): MusicGenTask[] {
  return tasks.map((t) =>
    t.status === 'submitting'
      ? { ...t, status: 'failure', failReason: '刷新前未完成提交', pollMisses: 0 }
      : t
  )
}

/** 有 taskId 且处于 queued/in_progress 的任务 id 列表（供轮询）。 */
export function selectActiveTaskIds(tasks: MusicGenTask[]): string[] {
  return tasks
    .filter((t) => !!t.taskId && (t.status === 'queued' || t.status === 'in_progress'))
    .map((t) => t.taskId as string)
}

// 占用中的任务状态：提交网络请求中 / 上游排队 / 生成中。
const IN_FLIGHT_STATUSES: Claude360MusicTaskStatus[] = ['submitting', 'queued', 'in_progress']

/** 是否存在“占用中”的任务（提交中/排队/生成中），用于阻止重复提交。 */
export function hasActiveTask(tasks: MusicGenTask[]): boolean {
  return tasks.some((t) => IN_FLIGHT_STATUSES.includes(t.status))
}

/** 归约单轮 fetch 结果到任务列表（纯函数，便于测试与复用）。 */
export function reduceFetched(
  tasks: MusicGenTask[],
  results: Claude360MusicFetchedTask[]
): MusicGenTask[] {
  return tasks.map((t) => {
    const r = t.taskId ? results.find((x) => x.taskId === t.taskId) : undefined
    // 未返回该任务，或返回了无法解析的未知状态：累计失败计数，达阈值兜底为 failure，
    // 避免未知/UNKNOWN 终态被当作 in_progress 永久轮询。
    if (!r || r.unresolved) {
      if (t.status !== 'queued' && t.status !== 'in_progress') return t
      const pollMisses = (t.pollMisses ?? 0) + 1
      if (pollMisses >= MUSIC_POLL_FAILURE_LIMIT) {
        return { ...t, status: 'failure', failReason: POLL_FAILURE_MESSAGE, pollMisses }
      }
      return { ...t, pollMisses }
    }
    return {
      ...t,
      status: r.status,
      songs: r.songs.length ? r.songs : t.songs,
      failReason: r.failReason,
      pollMisses: 0
    }
  })
}

/** 序列化为持久化用的任务数组：只保留最近 N 个（按 createdAt 倒序裁剪）。 */
export function serializeTasksForPersist(tasks: MusicGenTask[]): MusicGenTask[] {
  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MUSIC_TASK_HISTORY_LIMIT)
}

// —— 07-05 磁盘持久化恢复 ——

/** 磁盘歌曲记录（按 taskId 分组）→ 恢复用 success 任务列表（纯函数，便于测试）。 */
export function diskRecordsToTasks(records: DiskMusicRecord[]): MusicGenTask[] {
  const byTask = new Map<string, DiskMusicRecord[]>()
  for (const record of records) {
    if (record.status === 'pending') continue
    const key = record.taskId ?? `disk-${record.id}`
    const group = byTask.get(key)
    if (group) group.push(record)
    else byTask.set(key, [record])
  }
  const tasks: MusicGenTask[] = []
  for (const [key, group] of byTask) {
    const first = group[0]
    const createdAt = Date.parse(first.createdAt)
    tasks.push({
      id: `disk-${key}`,
      taskId: first.taskId,
      status: 'success',
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      title: first.title || '未命名',
      // 磁盘记录只存展示态；params 以最小快照重建（重新生成时以此回填）。
      params: { prompt: first.lyrics ?? first.prompt ?? '', model: first.model ?? '' },
      songs: group.map((record) => ({
        id: record.id,
        audioUrl: record.remoteAudioUrl ?? '',
        ...(record.remoteCoverUrl ? { imageUrl: record.remoteCoverUrl } : {}),
        title: record.title,
        ...(record.lyrics ? { text: record.lyrics } : {}),
        ...(record.duration !== undefined ? { duration: record.duration } : {}),
        ...(record.tags ? { tags: record.tags } : {}),
        ...(record.model ? { modelName: record.model } : {})
      }))
    })
  }
  return tasks
}

/** 磁盘记录 → songAssets 映射（含缺失标注）。 */
export function diskRecordsToSongAssets(records: DiskMusicRecord[]): Record<string, SongAssetInfo> {
  const assets: Record<string, SongAssetInfo> = {}
  for (const record of records) {
    if (!record.localAudioPath && !record.localCoverPath) continue
    assets[record.id] = {
      ...(record.localAudioPath ? { localAudioPath: record.localAudioPath } : {}),
      ...(record.localCoverPath ? { localCoverPath: record.localCoverPath } : {}),
      ...(record.audioMissing ? { audioMissing: true } : {}),
      ...(record.coverMissing ? { coverMissing: true } : {})
    }
  }
  return assets
}

/**
 * 磁盘任务并入现有列表：内存任务优先（运行态较新）；磁盘补充「localStorage 上限
 * 裁剪 / 清缓存后丢失」的任务。旧的磁盘来源任务（disk- 前缀）先移除再并入，
 * 保证切换工作空间时只显示当前空间的资产。
 */
export function mergeDiskTasks(tasks: MusicGenTask[], diskTasks: MusicGenTask[]): MusicGenTask[] {
  const memoryTasks = tasks.filter((task) => !task.id.startsWith('disk-'))
  const existingTaskIds = new Set(memoryTasks.map((t) => t.taskId).filter(Boolean))
  const existingSongIds = new Set(memoryTasks.flatMap((t) => t.songs.map((song) => song.id)))
  const additions = diskTasks.filter((task) => {
    if (task.taskId && existingTaskIds.has(task.taskId)) return false
    return !task.songs.every((song) => existingSongIds.has(song.id))
  })
  return [...memoryTasks, ...additions].sort((a, b) => b.createdAt - a.createdAt)
}

/** 从本地存储读取任务；损坏/缺失时安全恢复空列表，并对僵尸任务做 sanitize。 */
export function loadPersistedTasks(): MusicGenTask[] {
  const raw = readBrowserStorageItem(MUSIC_TASKS_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { tasks?: unknown }
    if (!parsed || !Array.isArray(parsed.tasks)) return []
    return sanitizeRehydratedTasks(parsed.tasks as MusicGenTask[])
  } catch {
    return []
  }
}

/** 落盘：只写最近 N 个任务，绝不写入任何 API Key（payload 里也没有）。 */
function persistTasks(tasks: MusicGenTask[]): void {
  const persisted = serializeTasksForPersist(tasks)
  writeBrowserStorageItem(MUSIC_TASKS_STORAGE_KEY, JSON.stringify({ tasks: persisted }))
}

/**
 * 创建一个独立的音乐任务 store 实例。测试用 createMusicTaskStore() 得到隔离实例；
 * 应用侧用单例 useMusicTaskStore（自动从本地存储恢复并在变更时落盘）。
 */
export function createMusicTaskStore(
  options: { initialTasks?: MusicGenTask[]; persist?: boolean } = {}
): StoreApi<MusicTasksState> {
  const shouldPersist = options.persist === true
  const store = create<MusicTasksState>((set) => ({
    tasks: options.initialTasks ?? [],
    songAssets: {},
    addSubmitting: (tempId, title, params) =>
      set((s) => ({
        tasks: [
          { id: tempId, status: 'submitting', createdAt: Date.now(), title, params, songs: [] },
          ...s.tasks
        ]
      })),
    markSubmitted: (tempId, taskId) =>
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === tempId ? { ...t, taskId, status: 'queued' } : t))
      })),
    markFailed: (id, message) =>
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, status: 'failure', failReason: message, pollMisses: 0 } : t
        )
      })),
    applyFetched: (results) => set((s) => ({ tasks: reduceFetched(s.tasks, results) })),
    removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
    removeSong: (id) =>
      set((s) => ({
        tasks: s.tasks
          .map((t) =>
            t.songs.some((song) => song.id === id)
              ? { ...t, songs: t.songs.filter((song) => song.id !== id) }
              : t
          )
          .filter((t) => t.status !== 'success' || t.songs.length > 0)
      })),
    clearFinishedTasks: () =>
      set((s) => ({ tasks: s.tasks.filter((t) => IN_FLIGHT_STATUSES.includes(t.status)) })),
    hydrateFromDisk: (records) =>
      set((s) => ({
        tasks: mergeDiskTasks(s.tasks, diskRecordsToTasks(records)),
        // songAssets 全量重建：切换工作空间后旧空间的本地映射不再有效。
        songAssets: diskRecordsToSongAssets(records)
      })),
    attachSongAsset: (songId, info) =>
      set((s) => ({
        songAssets: {
          ...s.songAssets,
          [songId]: { ...s.songAssets[songId], ...info, audioMissing: undefined, coverMissing: undefined }
        }
      }))
  }))

  if (shouldPersist) {
    store.subscribe((state) => persistTasks(state.tasks))
  }
  return store
}

/** 应用单例：启动时从本地存储恢复，变更自动落盘。 */
export const useMusicTaskStore = createMusicTaskStore({
  initialTasks: loadPersistedTasks(),
  persist: true
})
