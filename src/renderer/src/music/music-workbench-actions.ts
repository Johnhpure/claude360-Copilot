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
  Claude360MusicMediaProbeResult,
  Claude360MusicSubmitPayload,
  Claude360MusicSubmitResult,
  Claude360Song
} from '@shared/claude360-music'
import type { Claude360TokenListItem } from '@shared/claude360'
import type {
  MediaAssetsListResult,
  MediaAssetsSaveMusicPayload,
  MediaAssetsSaveMusicResult
} from '@shared/media-assets'
import type { WorkspaceFileSaveAsPayload, WorkspaceFileSaveAsResult } from '@shared/workspace-file'
import type { MusicTasksState } from './music-task-store'
import { buildSubmitPayload, validateForm } from './suno-params'

/** 音乐工作台需要用到的 kunGui 子集（与真实签名一致）。 */
export type MusicWorkbenchApi = {
  claude360MusicSubmit: (payload: Claude360MusicSubmitPayload) => Promise<Claude360MusicSubmitResult>
  claude360MusicFetch: (taskId: string) => Promise<Claude360MusicFetchResult>
  claude360MusicMediaBlob?: (url: string) => Promise<Claude360MusicMediaBlobResult>
  claude360MusicMediaProbe?: (url: string) => Promise<Claude360MusicMediaProbeResult>
  saveWorkspaceFileAs?: (payload: WorkspaceFileSaveAsPayload) => Promise<WorkspaceFileSaveAsResult>
  claude360TokensList: () => Promise<Claude360TokenListItem[]>
}

/** 07-05 资产持久化需要的 kunGui 子集。 */
export type MusicPersistenceApi = {
  mediaAssetsSaveMusic: (payload: MediaAssetsSaveMusicPayload) => Promise<MediaAssetsSaveMusicResult>
  mediaAssetsList: (payload: { workspaceRoot: string }) => Promise<MediaAssetsListResult>
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
  activeTaskIds: string[],
  /** 07-05：本轮解析出的 success 任务回调（组件层用于触发本地落盘）。 */
  onCompleted?: (completed: { taskId: string; songs: Claude360Song[] }[]) => void
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
  if (resolved.length > 0) {
    store.applyFetched(resolved)
    const completed = resolved
      .filter((task) => task.status === 'success' && task.songs.length > 0)
      .map((task) => ({ taskId: task.taskId, songs: task.songs }))
    if (completed.length > 0) onCompleted?.(completed)
  }
}

// —— 07-05 本地持久化编排 ——

/**
 * 任务成功后把每首歌静默落盘（音频 + 封面）到工作空间 assets/：
 * main 代下载；成功回写 songAssets。单曲失败只记 console，不打断其余歌曲。
 * 音频下载窗口可达数十秒，期间用户可能已删歌：落盘完成后经 opts.isRemoved 复查，
 * 已删则调 opts.cleanupRemoved 反删磁盘记录（审查 Important 3）。
 */
export async function persistCompletedSongs(
  api: Pick<MusicPersistenceApi, 'mediaAssetsSaveMusic'>,
  store: Pick<MusicTasksState, 'attachSongAsset'>,
  workspaceRoot: string,
  completed: { taskId: string; songs: Claude360Song[] }[],
  meta: { model?: string; prompt?: string } = {},
  opts: {
    isRemoved?: (songId: string) => boolean
    cleanupRemoved?: (songId: string) => void
  } = {}
): Promise<void> {
  const root = workspaceRoot.trim()
  if (!root) return
  await Promise.all(
    completed.flatMap(({ taskId, songs }) =>
      songs.map(async (song) => {
        const audioUrl = song.audioUrl?.trim()
        if (!audioUrl) return
        try {
          const result = await api.mediaAssetsSaveMusic({
            workspaceRoot: root,
            record: {
              id: song.id,
              taskId,
              title: song.title || '未命名',
              createdAt: new Date().toISOString(),
              ...(song.text ? { lyrics: song.text } : {}),
              ...(meta.prompt ? { prompt: meta.prompt } : {}),
              ...(song.modelName || meta.model ? { model: song.modelName || meta.model } : {}),
              ...(song.duration !== undefined ? { duration: song.duration } : {}),
              ...(song.tags ? { tags: song.tags } : {})
            },
            audioUrl,
            ...(song.imageUrl?.trim() ? { coverUrl: song.imageUrl.trim() } : {})
          })
          if (opts.isRemoved?.(song.id)) {
            opts.cleanupRemoved?.(song.id)
            return
          }
          if (result.ok && (result.record.localAudioPath || result.record.localCoverPath)) {
            store.attachSongAsset(song.id, {
              ...(result.record.localAudioPath ? { localAudioPath: result.record.localAudioPath } : {}),
              ...(result.record.localCoverPath ? { localCoverPath: result.record.localCoverPath } : {})
            })
          }
        } catch (error) {
          console.warn('[media-assets] 歌曲落盘失败（不影响播放）:', error)
        }
      })
    )
  )
}

/** 启动 / 切换工作空间时从磁盘恢复音乐任务列表与本地资产映射（失败静默）。 */
export async function hydrateMusicFromDisk(
  api: Pick<MusicPersistenceApi, 'mediaAssetsList'>,
  store: Pick<MusicTasksState, 'hydrateFromDisk'>,
  workspaceRoot: string
): Promise<void> {
  const root = workspaceRoot.trim()
  if (!root) return
  try {
    const result = await api.mediaAssetsList({ workspaceRoot: root })
    if (result.ok) store.hydrateFromDisk(result.music)
  } catch (error) {
    console.warn('[media-assets] 音乐资产恢复失败:', error)
  }
}

// —— 下载（主进程链路：media-blob 代取鉴权音频 → file:save-as 保存对话框）——
// 旧实现 renderer 直接 fetch(audioUrl)，跨域/鉴权必失败后 window.open 兜底，
// 表现为「点下载弹出新窗口的浏览器播放器」。现已彻底移除任何打开页面的路径。

/** 由 content-type 推断音频扩展名；未知类型按 Suno 主流产物默认 mp3。 */
export function audioExtensionFromMimeType(mimeType: string): string {
  const normalized = (mimeType || '').trim().toLowerCase()
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('flac')) return 'flac'
  if (normalized.includes('mp4') || normalized.includes('m4a') || normalized.includes('aac')) return 'm4a'
  return 'mp3'
}

/**
 * 下载文件名：`歌曲标题-YYYYMMDD-HHmm.<ext>`；无标题用 `music-<时间戳>.<ext>`。
 * 过滤文件系统非法字符，标题限长防超长路径。
 */
export function songDownloadFilename(title: string, mimeType: string, now: Date = new Date()): string {
  const ext = audioExtensionFromMimeType(mimeType)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const base = (title ?? '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  if (!base) return `music-${now.getTime()}.${ext}`
  return `${base}-${stamp}.${ext}`
}

export type DownloadSongResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; message: string }

/**
 * 下载歌曲（只下载，绝不打开窗口/页面）：
 * 1. main 经 media-blob 代取音频（同源自动附 music Key；content-type 为 HTML/JSON 时明确报错）；
 * 2. 走 file:save-as 弹系统保存对话框写盘。
 * 失败原因原样打进控制台并返回给 UI 展示。
 */
export async function downloadSong(
  api: Pick<MusicWorkbenchApi, 'claude360MusicMediaBlob' | 'saveWorkspaceFileAs'>,
  song: Pick<Claude360Song, 'audioUrl' | 'title'>,
  log: (message: string, detail?: unknown) => void = (m, d) => console.error(m, d)
): Promise<DownloadSongResult> {
  const audioUrl = (song.audioUrl ?? '').trim()
  if (!audioUrl) return { ok: false, message: '该作品没有可下载的音频地址' }
  if (!api.claude360MusicMediaBlob || !api.saveWorkspaceFileAs) {
    return { ok: false, message: '下载功能不可用' }
  }
  log('[claude360-music] download start', { audioUrl, title: song.title })
  let media: Claude360MusicMediaBlobResult
  try {
    media = await api.claude360MusicMediaBlob(audioUrl)
  } catch (error) {
    log('[claude360-music] download media fetch threw', error)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (!media.ok) {
    log('[claude360-music] download media fetch failed', media)
    return { ok: false, message: media.message }
  }
  const filename = songDownloadFilename(song.title, media.mimeType)
  let saved: WorkspaceFileSaveAsResult
  try {
    saved = await api.saveWorkspaceFileAs({
      suggestedName: filename,
      dataBase64: media.base64,
      mimeType: media.mimeType
    })
  } catch (error) {
    log('[claude360-music] download save-as threw', error)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (!saved.ok) {
    if (!saved.canceled) log('[claude360-music] download save-as failed', saved)
    return { ok: false, canceled: saved.canceled, message: saved.message ?? '保存失败' }
  }
  return { ok: true, path: saved.path }
}

// —— 资源可访问性验证（临时调试：封面/音频逐项探测并打日志）——

export type SongProbeReport = {
  songId: string
  title: string
  coverUrl: string | null
  cover: Claude360MusicMediaProbeResult | { skipped: true } | null
  audioUrl: string | null
  audio: Claude360MusicMediaProbeResult | { skipped: true } | null
}

/**
 * 对一批成功歌曲验证 coverUrl / audioUrl：是否存在、能否请求成功、
 * content-type 是否可播放（audio/*）。结果整体打一条 console 日志，
 * 返回值供测试断言。探针失败不影响任何业务流程。
 */
export async function debugProbeSongs(
  api: Pick<MusicWorkbenchApi, 'claude360MusicMediaProbe'>,
  songs: Pick<Claude360Song, 'id' | 'title' | 'audioUrl' | 'imageUrl'>[],
  log: (message: string, detail?: unknown) => void = (m, d) => console.info(m, d)
): Promise<SongProbeReport[]> {
  const probe = api.claude360MusicMediaProbe
  const reports = await Promise.all(
    songs.map(async (song): Promise<SongProbeReport> => {
      const coverUrl = song.imageUrl?.trim() || null
      const audioUrl = song.audioUrl?.trim() || null
      const probeUrl = async (url: string | null): Promise<SongProbeReport['cover']> => {
        if (!url) return null
        if (!probe) return { skipped: true }
        try {
          return await probe(url)
        } catch (error) {
          return { ok: false, url, message: error instanceof Error ? error.message : String(error) }
        }
      }
      return {
        songId: song.id,
        title: song.title,
        coverUrl,
        cover: await probeUrl(coverUrl),
        audioUrl,
        audio: await probeUrl(audioUrl)
      }
    })
  )
  log('[claude360-music] song media accessibility report', reports)
  return reports
}

export type MusicPlaybackAudioElement = Pick<
  HTMLAudioElement,
  'src' | 'volume' | 'currentTime' | 'play' | 'pause'
> & {
  /** 媒体元素错误（audio.error），播放失败时读 code 定位具体原因。 */
  readonly error?: MediaError | null
  /** 网络/就绪状态（networkState/readyState），播放失败时一并打进日志。 */
  readonly networkState?: number
  readonly readyState?: number
}

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
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/** MediaError.code → 可读名称（audio.error 的四种标准取值）。 */
function mediaErrorCodeName(code: number | undefined): string | undefined {
  if (code === undefined) return undefined
  const names: Record<number, string> = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
  }
  return names[code] ?? `MEDIA_ERR_${code}`
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
    const mediaCode = audio.error?.code
    const parts: string[] = []
    if (mediaCode !== undefined) parts.push(`audio.error.code=${mediaCode} ${mediaErrorCodeName(mediaCode)}`)
    if (audio.networkState !== undefined) parts.push(`networkState=${audio.networkState}`)
    if (audio.readyState !== undefined) parts.push(`readyState=${audio.readyState}`)
    const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
    return {
      ok: false,
      reason: 'play-failed',
      message: `${playbackErrorMessage(error)}${suffix}`
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
