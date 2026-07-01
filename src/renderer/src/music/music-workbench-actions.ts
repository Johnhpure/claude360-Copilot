// 音乐工作台的纯编排函数（Task 6）。
//
// 把提交、轮询、下载、登录/分组检测等副作用从 React 组件里剥离出来，只依赖
// 通过参数注入的最小 kunGui 子集与 store 动作，便于在 node 环境下用
// renderToStaticMarkup + mock 直接单测（与 my-page-actions.ts 同款抽离）。
//
// Risk Notes：renderer 绝不持有/输入 API Key；轮询失败上限在 store 侧兜底，
// UI 侧只负责“有活跃任务才继续 tick”。
import type {
  Claude360MusicCreateForm,
  Claude360MusicFetchResult,
  Claude360MusicSubmitPayload,
  Claude360MusicSubmitResult
} from '@shared/claude360-music'
import type { Claude360TokenListItem } from '@shared/claude360'
import type { MusicTasksState } from './music-task-store'
import { buildSubmitPayload, validateForm } from './suno-params'

/** 音乐工作台需要用到的 kunGui 子集（与真实签名一致）。 */
export type MusicWorkbenchApi = {
  claude360MusicSubmit: (payload: Claude360MusicSubmitPayload) => Promise<Claude360MusicSubmitResult>
  claude360MusicFetch: (taskId: string) => Promise<Claude360MusicFetchResult>
  claude360TokensList: () => Promise<Claude360TokenListItem[]>
}

let seq = 0
function tempId(): string {
  seq += 1
  return `tmp_${seq}_${Date.now().toString(36)}`
}

export type SubmitMusicResult = { ok: boolean; taskId?: string; errors?: string[] }

/**
 * 提交一次音乐生成：表单校验 → 构造 payload → 本地新增 submitting 任务 →
 * 调 main 提交 → 成功 markSubmitted / 失败 markFailed。
 * store 动作由参数注入，便于测试断言其调用顺序与入参。
 */
export async function submitMusic(
  api: Pick<MusicWorkbenchApi, 'claude360MusicSubmit'>,
  store: Pick<MusicTasksState, 'addSubmitting' | 'markSubmitted' | 'markFailed'>,
  form: Claude360MusicCreateForm
): Promise<SubmitMusicResult> {
  const errors = validateForm(form)
  if (errors.length) return { ok: false, errors }

  const payload = buildSubmitPayload(form)
  const id = tempId()
  const title = form.title.trim() || form.description.trim().split('\n')[0] || '未命名'
  store.addSubmitting(id, title, payload)
  try {
    const result = await api.claude360MusicSubmit(payload)
    if (result.ok) {
      store.markSubmitted(id, result.taskId)
      return { ok: true, taskId: result.taskId }
    }
    store.markFailed(id, result.message)
    return { ok: false, errors: [result.message] }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    store.markFailed(id, message)
    return { ok: false, errors: [message] }
  }
}

/**
 * 轮询一批活跃任务一次：逐个 fetch，把成功解析的任务喂给 applyFetched。
 * 网络/传输错误跳过本轮该任务（不累加 miss），与 music-web usePolling 一致；
 * store 侧只有“上游明确缺失/未知状态”才累加 miss 并最终兜底 failure。
 */
export async function pollActiveTasksOnce(
  api: Pick<MusicWorkbenchApi, 'claude360MusicFetch'>,
  store: Pick<MusicTasksState, 'applyFetched'>,
  activeTaskIds: string[]
): Promise<void> {
  if (activeTaskIds.length === 0) return
  const settled = await Promise.all(
    activeTaskIds.map(async (taskId) => {
      try {
        const r = await api.claude360MusicFetch(taskId)
        return r.ok ? r.task : null
      } catch {
        return null
      }
    })
  )
  const resolved = settled.filter((t): t is NonNullable<typeof t> => t !== null)
  // 即使本轮全部为网络错误也调用 applyFetched：store 只对“有 taskId 却未在结果里”的
  // 任务累加 miss。但网络错误不应累加 miss —— 故仅在拿到 >=1 条结果时才归约。
  if (resolved.length > 0) store.applyFetched(resolved)
}

export type MusicAccess = {
  /** 已登录（token 列表可用视为已登录，main 会在未登录时抛错，UI 兜底为未登录）。 */
  loggedIn: boolean
  /** 是否存在 music 分组的 API Key。 */
  hasMusicGroup: boolean
}

/** 从 token 列表判断是否有 music 分组 Key（大小写不敏感，含子串匹配 music）。 */
export function hasMusicGroupToken(tokens: Claude360TokenListItem[]): boolean {
  return tokens.some((t) => (t.group || '').toLowerCase().includes('music'))
}

/**
 * 探测音乐可用性：拉取 token 列表，判断登录态与 music 分组。
 * 失败（未登录/网络）时返回 loggedIn:false，让 UI 显示“去我的页修复”入口。
 */
export async function detectMusicAccess(
  api: Pick<MusicWorkbenchApi, 'claude360TokensList'>
): Promise<MusicAccess> {
  try {
    const tokens = await api.claude360TokensList()
    return { loggedIn: true, hasMusicGroup: hasMusicGroupToken(tokens) }
  } catch {
    return { loggedIn: false, hasMusicGroup: false }
  }
}

// —— 下载（迁移自 music-web download.ts；仅允许 http(s)，纵深防御）——
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function safeSongFilename(title: string): string {
  const base = (title?.trim() || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  return `${base}.mp3`
}

export type DownloadDeps = {
  fetch: typeof fetch
  createObjectURL: (b: Blob) => string
  revokeObjectURL: (u: string) => void
  triggerDownload: (url: string, filename: string) => void
  openFallback: (url: string) => void
}

/** 下载歌曲：成功用 blob 触发下载，失败回退到新标签打开；非法链接直接拒绝。 */
export async function downloadSong(
  audioUrl: string,
  title: string,
  deps: DownloadDeps
): Promise<'blob' | 'fallback' | 'invalid'> {
  if (!isSafeHttpUrl(audioUrl)) return 'invalid'
  const filename = safeSongFilename(title)
  try {
    const res = await deps.fetch(audioUrl)
    if (!res.ok) throw new Error('bad status')
    const blob = await res.blob()
    const url = deps.createObjectURL(blob)
    deps.triggerDownload(url, filename)
    deps.revokeObjectURL(url)
    return 'blob'
  } catch {
    deps.openFallback(audioUrl)
    return 'fallback'
  }
}
