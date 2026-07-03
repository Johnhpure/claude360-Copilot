import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import type { Claude360TokenPurpose } from '../../shared/claude360'
import type {
  Claude360MusicFetchedTask,
  Claude360MusicFetchResult,
  Claude360MusicMediaBlobResult,
  Claude360MusicSubmitPayload,
  Claude360MusicSubmitResult,
  Claude360MusicTaskStatus,
  Claude360Song
} from '../../shared/claude360-music'
import {
  Claude360ApiError,
  sanitizeClaude360Message,
  type Claude360SunoRawEnvelope
} from './claude360-api-client'
import type { Claude360SecretStore } from './claude360-secret-store'

/**
 * Claude360 原生音乐工作台服务（plan-05 Task 2）。
 *
 * - 依赖注入构造 + 端口，风格与 claude360-model-service / billing-service 一致。
 * - 从 `settings.claude360.selectedMusicGroup` 取 music 分组，用 `ensureGroupKey`
 *   拿到该分组 music Key，调 `/suno/submit/music` 与 `/suno/fetch`。
 * - **API Key 只在 main 进程使用，绝不出现在返回给 renderer 的结果里**（Risk Notes）。
 * - Suno 返回 `{ code, message?, data }`（非 `{success}` 信封），由 apiClient.postSunoRaw
 *   原样带回，本服务自行判定 code === 'success'。
 * - 未知/异常字段保留但不依赖；UI 只消费稳定字段（audioUrl/title/...）。
 */

export type Claude360MusicApiClientPort = {
  postSunoRaw(
    path: string,
    body: unknown,
    token: string | undefined
  ): Promise<Claude360SunoRawEnvelope>
}

export type Claude360MusicServiceDeps = {
  apiClient: Claude360MusicApiClientPort
  secretStore: Claude360SecretStore
  fetchImpl?: typeof fetch
  /** 读 Claude360 settings（取 selectedMusicGroup）。 */
  readClaude360(): Claude360SettingsV1 | Promise<Claude360SettingsV1>
  /** 确保某分组对应用途的 Key 并返回明文（token service + secret store 提供）。 */
  ensureGroupKey: (group: string, purpose: Claude360TokenPurpose) => Promise<string>
}

// —— /suno/fetch 原始返回项（与 music-web api/suno.ts RawTask/RawSong 同契约）——
interface SunoRawSong {
  id: string
  audio_url?: string
  audioUrl?: string
  music_url?: string
  musicUrl?: string
  audio?: string
  url?: string
  sourceAudioUrl?: string
  source_audio_url?: string
  streamAudioUrl?: string
  stream_audio_url?: string
  streamUrl?: string
  stream_url?: string
  fileUrl?: string
  file_url?: string
  image_url?: string
  imageUrl?: string
  image?: string
  coverUrl?: string
  cover_url?: string
  cover?: string
  artworkUrl?: string
  artwork_url?: string
  thumbnail?: string
  model_name?: string
  modelName?: string
  title?: string
  text?: string
  metadata?: { tags?: string; duration?: number }
  duration?: number
}
interface SunoRawTask {
  task_id: string
  action?: string
  status: string
  fail_reason?: string
  data?: SunoRawSong[]
}

// 上游状态 → 本地状态映射（迁移自 music-web STATUS_MAP，命名不变）。
const STATUS_MAP: Record<string, Claude360MusicTaskStatus> = {
  NOT_START: 'queued',
  SUBMITTED: 'queued',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUCCESS: 'success',
  FAILURE: 'failure'
}

const DEFAULT_CLAUDE360_BASE_URL = 'https://claude360.xyz'
const MAX_MEDIA_BLOB_BYTES = 80 * 1024 * 1024

type PickedString = {
  field: string
  value: string
}

type MusicContext = {
  apiKey: string
  baseUrl: string
}

function stringFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = stringFromUnknown(value)
    if (found) return found
  }
  return undefined
}

function pickString(candidates: Array<[string, unknown]>): PickedString | undefined {
  for (const [field, value] of candidates) {
    const found = stringFromUnknown(value)
    if (found) return { field, value: found }
  }
  return undefined
}

function pickSongAudio(s: SunoRawSong): PickedString | undefined {
  return pickString([
    ['audio_url', s.audio_url],
    ['audioUrl', s.audioUrl],
    ['music_url', s.music_url],
    ['musicUrl', s.musicUrl],
    ['audio', s.audio],
    ['url', s.url],
    ['sourceAudioUrl', s.sourceAudioUrl],
    ['source_audio_url', s.source_audio_url],
    ['streamAudioUrl', s.streamAudioUrl],
    ['stream_audio_url', s.stream_audio_url],
    ['streamUrl', s.streamUrl],
    ['stream_url', s.stream_url],
    ['fileUrl', s.fileUrl],
    ['file_url', s.file_url]
  ])
}

function pickSongImage(s: SunoRawSong): PickedString | undefined {
  return pickString([
    ['image_url', s.image_url],
    ['imageUrl', s.imageUrl],
    ['image', s.image],
    ['coverUrl', s.coverUrl],
    ['cover_url', s.cover_url],
    ['cover', s.cover],
    ['artworkUrl', s.artworkUrl],
    ['artwork_url', s.artwork_url],
    ['thumbnail', s.thumbnail]
  ])
}

function safeBaseUrl(baseUrl: string): URL {
  try {
    return new URL(baseUrl.trim() || DEFAULT_CLAUDE360_BASE_URL)
  } catch {
    return new URL(DEFAULT_CLAUDE360_BASE_URL)
  }
}

function windowsPathToFileUrl(value: string): string {
  return `file:///${value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')}`
}

function uncPathToFileUrl(value: string): string {
  return `file://${value.replace(/^\\\\/, '').replace(/\\/g, '/')}`
}

function isLikelyPosixFilePath(value: string): boolean {
  return /^\/(?:Users|home|tmp|var|opt|Volumes)\//u.test(value)
}

function normalizeLocalPath(value: string): string | null {
  if (/^[A-Za-z]:[\\/]/u.test(value)) return windowsPathToFileUrl(value)
  if (value.startsWith('\\\\')) return uncPathToFileUrl(value)
  if (value.startsWith('~/') || value === '~') {
    const suffix = value === '~' ? '' : value.slice(2)
    return pathToFileURL(`${homedir()}/${suffix}`).toString()
  }
  if (isLikelyPosixFilePath(value)) return pathToFileURL(value).toString()
  return null
}

function normalizeResourceUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined
  const raw = value.trim()
  if (!raw) return undefined
  const local = normalizeLocalPath(raw)
  if (local) return local
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw)) return raw

  const base = safeBaseUrl(baseUrl)
  if (raw.startsWith('//')) return `${base.protocol}${raw}`
  try {
    return new URL(raw, base).toString()
  } catch {
    return raw
  }
}

function normalizedSongAudioUrl(s: SunoRawSong, baseUrl: string): string | undefined {
  return normalizeResourceUrl(pickSongAudio(s)?.value, baseUrl)
}

function normalizedSongImageUrl(s: SunoRawSong, baseUrl: string): string | undefined {
  return normalizeResourceUrl(pickSongImage(s)?.value, baseUrl)
}

function taskLogShape(task: SunoRawTask, baseUrl: string): unknown {
  return {
    taskId: task.task_id,
    status: task.status,
    songCount: task.data?.length ?? 0,
    songs: (task.data ?? []).map((song) => {
      const audio = pickSongAudio(song)
      const image = pickSongImage(song)
      return {
        id: song.id,
        keys: Object.keys(song).sort(),
        audioField: audio?.field ?? null,
        imageField: image?.field ?? null,
        normalizedAudioUrl: redactUrl(normalizeResourceUrl(audio?.value, baseUrl)),
        normalizedImageUrl: redactUrl(normalizeResourceUrl(image?.value, baseUrl))
      }
    })
  }
}

function logFetchShape(taskId: string, rows: SunoRawTask[], baseUrl: string): void {
  if (process.env.NODE_ENV === 'test') return
  console.info('[claude360-music] /suno/fetch raw task shape', {
    requestedTaskId: taskId,
    taskCount: rows.length,
    tasks: rows.map((task) => taskLogShape(task, baseUrl))
  })
}

function redactUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function shouldAttachMusicToken(targetUrl: string, baseUrl: string): boolean {
  try {
    return new URL(targetUrl).origin === safeBaseUrl(baseUrl).origin
  } catch {
    return false
  }
}

function mapSong(s: SunoRawSong, baseUrl: string): Claude360Song {
  return {
    id: s.id,
    audioUrl: normalizedSongAudioUrl(s, baseUrl) ?? '',
    imageUrl: normalizedSongImageUrl(s, baseUrl),
    title: s.title ?? '未命名',
    text: s.text,
    duration: s.metadata?.duration ?? s.duration,
    tags: s.metadata?.tags,
    modelName: firstNonEmptyString(s.model_name, s.modelName)
  }
}

function parseTask(t: SunoRawTask, baseUrl: string): Claude360MusicFetchedTask {
  const mapped = STATUS_MAP[t.status]
  return {
    taskId: t.task_id,
    status: mapped ?? 'in_progress',
    failReason: t.fail_reason || undefined,
    songs: (t.data ?? []).filter((s) => Boolean(normalizedSongAudioUrl(s, baseUrl))).map((s) => mapSong(s, baseUrl)),
    unresolved: mapped === undefined
  }
}

function isSuccessCode(code: string | number | undefined): boolean {
  // shim → newapi 出参 code 为字符串 "success"；容错数字 200 之类。
  return code === 'success' || code === 200 || code === '200'
}

function envelopeMessage(env: Claude360SunoRawEnvelope, fallback: string): string {
  const raw = (typeof env.message === 'string' && env.message.trim())
    || (typeof env.msg === 'string' && env.msg.trim())
    || ''
  return raw ? sanitizeClaude360Message(raw) : fallback
}

export class Claude360MusicService {
  private readonly deps: Claude360MusicServiceDeps

  constructor(deps: Claude360MusicServiceDeps) {
    this.deps = deps
  }

  /** 取 music 分组的 music Key 与 baseUrl；未登录/未选分组分别抛出可展示错误。 */
  private async musicContext(): Promise<MusicContext> {
    const settings = await this.deps.readClaude360()
    const group = (settings.selectedMusicGroup ?? '').trim()
    if (!group) {
      throw new Claude360ApiError('尚未选择音乐分组，请打开 设置 → 分组及 Key 选择 music 分组。')
    }
    // ensureGroupKey 内部会校验登录态（cli_token 缺失时抛「未登录」）。
    return {
      apiKey: await this.deps.ensureGroupKey(group, 'music'),
      baseUrl: safeBaseUrl(settings.baseUrl).toString()
    }
  }

  async submitMusic(input: Claude360MusicSubmitPayload): Promise<Claude360MusicSubmitResult> {
    let context: MusicContext
    try {
      context = await this.musicContext()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    let env: Claude360SunoRawEnvelope
    try {
      env = await this.deps.apiClient.postSunoRaw('/suno/submit/music', input, context.apiKey)
    } catch (error) {
      // 网络/传输错误：可重试。
      return { ok: false, message: errorMessage(error), retryable: true }
    }

    if (!isSuccessCode(env.code) || typeof env.data !== 'string' || !env.data) {
      return { ok: false, message: envelopeMessage(env, '提交失败，请稍后重试') }
    }
    return { ok: true, taskId: env.data }
  }

  async fetchMusic(taskId: string): Promise<Claude360MusicFetchResult> {
    const id = (taskId ?? '').trim()
    if (!id) {
      return { ok: false, message: 'taskId 不能为空' }
    }

    let context: MusicContext
    try {
      context = await this.musicContext()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    let env: Claude360SunoRawEnvelope
    try {
      env = await this.deps.apiClient.postSunoRaw('/suno/fetch', { ids: [id] }, context.apiKey)
    } catch (error) {
      return { ok: false, message: errorMessage(error), retryable: true }
    }

    if (!isSuccessCode(env.code)) {
      return { ok: false, message: envelopeMessage(env, '查询失败，请稍后重试') }
    }

    const rows = Array.isArray(env.data) ? (env.data as SunoRawTask[]) : []
    logFetchShape(id, rows, context.baseUrl)
    const raw = rows.find((t) => t?.task_id === id)
    if (!raw) {
      // 上游本次成功但未返回该任务（最常见的"尚未同步"）：作为可归约的 unresolved
      // 结果返回,让 renderer 轮询按 miss 计数并在达到失败上限后兜底 failure,
      // 避免与网络错误混同被跳过而导致无限轮询(区别于上面 catch 的 retryable 网络失败)。
      return { ok: true, task: { taskId: id, status: 'in_progress', songs: [], unresolved: true } }
    }
    return { ok: true, task: parseTask(raw, context.baseUrl) }
  }

  async fetchMusicMedia(url: string): Promise<Claude360MusicMediaBlobResult> {
    const raw = (url ?? '').trim()
    if (!raw) return { ok: false, message: '音频地址不能为空' }

    let context: MusicContext
    try {
      context = await this.musicContext()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    const normalized = normalizeResourceUrl(raw, context.baseUrl)
    if (!normalized || !isHttpUrl(normalized)) {
      return { ok: false, message: '音频地址不可播放' }
    }

    const headers: Record<string, string> = {}
    if (shouldAttachMusicToken(normalized, context.baseUrl)) {
      headers.Authorization = `Bearer ${context.apiKey}`
    }

    try {
      const response = await (this.deps.fetchImpl ?? fetch)(normalized, { headers })
      if (!response.ok) {
        return {
          ok: false,
          message: `音频请求失败 (HTTP ${response.status})`,
          retryable: response.status >= 500
        }
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > MAX_MEDIA_BLOB_BYTES) {
        return { ok: false, message: '音频文件过大，无法直接播放' }
      }
      return {
        ok: true,
        url: normalized,
        mimeType: response.headers.get('content-type') || 'audio/mpeg',
        base64: buffer.toString('base64')
      }
    } catch (error) {
      return { ok: false, message: errorMessage(error), retryable: true }
    }
  }
}

/** 统一错误取信息（Claude360ApiError 已脱敏；其余给中性提示，绝不透出栈/凭据）。 */
function errorMessage(error: unknown): string {
  if (error instanceof Claude360ApiError) return error.message
  return '发生未知错误，请稍后重试'
}
