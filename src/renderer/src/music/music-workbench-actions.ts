// 音乐工作台的纯编排函数（Task 6）。
//
// 把提交、轮询、下载等副作用从 React 组件里剥离出来，只依赖
// 通过参数注入的最小 kunGui 子集与 store 动作，便于在 node 环境下用
// renderToStaticMarkup + mock 直接单测（与 my-page-actions.ts 同款抽离）。
//
// Risk Notes：renderer 绝不持有/输入 API Key；轮询失败上限在 store 侧兜底，
// UI 侧只负责“有活跃任务才继续 tick”。
import type {
  Claude360MusicCreateForm,
  Claude360MusicFetchResult,
  Claude360MusicMediaBlobResult,
  Claude360MusicSubmitPayload,
  Claude360MusicSubmitResult,
  Claude360Song
} from '@shared/claude360-music'
import type { Claude360TokenListItem } from '@shared/claude360'
import type { MusicTasksState } from './music-task-store'
import { buildSubmitPayload, validateForm } from './suno-params'

/** 音乐工作台需要用到的 kunGui 子集（与真实签名一致）。 */
export type MusicWorkbenchApi = {
  claude360MusicSubmit: (payload: Claude360MusicSubmitPayload) => Promise<Claude360MusicSubmitResult>
  claude360MusicFetch: (taskId: string) => Promise<Claude360MusicFetchResult>
  claude360MusicMediaBlob?: (url: string) => Promise<Claude360MusicMediaBlobResult>
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

export type MusicPlaybackAudioElement = Pick<HTMLAudioElement, 'src' | 'volume' | 'currentTime' | 'play' | 'pause'>

export type MusicPlaybackResult =
  | { ok: true; sourceUrl: string; usedFallback: boolean }
  | { ok: false; reason: 'missing-url' }
  | { ok: false; reason: 'play-failed'; message: string }
type MusicPlayFailed = Extract<MusicPlaybackResult, { reason: 'play-failed' }>

export type MusicPlaybackOptions = {
  resolvePlayableUrl?: (audioUrl: string, error: unknown) => Promise<string | null>
  logError?: (message: string, detail: unknown) => void
}

function clampPlaybackVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0.8
  return Math.max(0, Math.min(1, volume))
}

function playbackErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function redactPlaybackUrl(value: string): string {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

async function tryPlayAudio(audio: MusicPlaybackAudioElement): Promise<MusicPlayFailed | null> {
  try {
    await audio.play()
    return null
  } catch (error) {
    return {
      ok: false,
      reason: 'play-failed',
      message: playbackErrorMessage(error)
    }
  }
}

/**
 * 在用户点击链路内调用：校验音频地址、复用 <audio>、切歌时停掉旧音频，并立即 play。
 * store 仍只负责状态；这里负责浏览器/Electron 的真实音频副作用。
 */
export async function playSongOnAudioElement(
  audio: MusicPlaybackAudioElement,
  song: Pick<Claude360Song, 'audioUrl'>,
  volume: number,
  options: MusicPlaybackOptions = {}
): Promise<MusicPlaybackResult> {
  const audioUrl = song.audioUrl.trim()
  if (!audioUrl) return { ok: false, reason: 'missing-url' }

  if (audio.src !== audioUrl) {
    audio.pause()
    audio.src = audioUrl
    audio.currentTime = 0
  }
  audio.volume = clampPlaybackVolume(volume)

  const directFailure = await tryPlayAudio(audio)
  if (!directFailure) return { ok: true, sourceUrl: audioUrl, usedFallback: false }

  options.logError?.('[claude360-music] audio.play failed', {
    message: directFailure.message,
    url: redactPlaybackUrl(audioUrl)
  })

  const fallbackUrl = await options.resolvePlayableUrl?.(audioUrl, new Error(directFailure.message))
  if (fallbackUrl) {
    audio.pause()
    audio.src = fallbackUrl
    audio.currentTime = 0
    const fallbackFailure = await tryPlayAudio(audio)
    if (!fallbackFailure) {
      return { ok: true, sourceUrl: fallbackUrl, usedFallback: true }
    }
    options.logError?.('[claude360-music] fallback audio.play failed', {
      message: fallbackFailure.message,
      url: redactPlaybackUrl(audioUrl),
      fallbackUrl
    })
    return fallbackFailure
  }
  return directFailure
}
