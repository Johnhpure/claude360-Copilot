import type { Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import type { Claude360TokenPurpose } from '../../shared/claude360'
import type {
  Claude360MusicFetchedTask,
  Claude360MusicFetchResult,
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
  /** 读 Claude360 settings（取 selectedMusicGroup）。 */
  readClaude360(): Claude360SettingsV1 | Promise<Claude360SettingsV1>
  /** 确保某分组对应用途的 Key 并返回明文（token service + secret store 提供）。 */
  ensureGroupKey: (group: string, purpose: Claude360TokenPurpose) => Promise<string>
}

// —— /suno/fetch 原始返回项（与 music-web api/suno.ts RawTask/RawSong 同契约）——
interface SunoRawSong {
  id: string
  audio_url?: string
  image_url?: string
  model_name?: string
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

function mapSong(s: SunoRawSong): Claude360Song {
  return {
    id: s.id,
    audioUrl: s.audio_url ?? '',
    imageUrl: s.image_url,
    title: s.title ?? '未命名',
    text: s.text,
    duration: s.metadata?.duration ?? s.duration,
    tags: s.metadata?.tags,
    modelName: s.model_name
  }
}

function parseTask(t: SunoRawTask): Claude360MusicFetchedTask {
  const mapped = STATUS_MAP[t.status]
  return {
    taskId: t.task_id,
    status: mapped ?? 'in_progress',
    failReason: t.fail_reason || undefined,
    songs: (t.data ?? []).filter((s) => s.audio_url).map(mapSong),
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

  /** 取 music 分组的 music Key；未登录/未选分组分别抛出可展示错误。 */
  private async musicKey(): Promise<string> {
    const settings = await this.deps.readClaude360()
    const group = (settings.selectedMusicGroup ?? '').trim()
    if (!group) {
      throw new Claude360ApiError('尚未选择音乐分组，请到「我的」页选择 music 分组')
    }
    // ensureGroupKey 内部会校验登录态（cli_token 缺失时抛「未登录」）。
    return this.deps.ensureGroupKey(group, 'music')
  }

  async submitMusic(input: Claude360MusicSubmitPayload): Promise<Claude360MusicSubmitResult> {
    let apiKey: string
    try {
      apiKey = await this.musicKey()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    let env: Claude360SunoRawEnvelope
    try {
      env = await this.deps.apiClient.postSunoRaw('/suno/submit/music', input, apiKey)
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

    let apiKey: string
    try {
      apiKey = await this.musicKey()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    let env: Claude360SunoRawEnvelope
    try {
      env = await this.deps.apiClient.postSunoRaw('/suno/fetch', { ids: [id] }, apiKey)
    } catch (error) {
      return { ok: false, message: errorMessage(error), retryable: true }
    }

    if (!isSuccessCode(env.code)) {
      return { ok: false, message: envelopeMessage(env, '查询失败，请稍后重试') }
    }

    const rows = Array.isArray(env.data) ? (env.data as SunoRawTask[]) : []
    const raw = rows.find((t) => t?.task_id === id)
    if (!raw) {
      // 上游本次成功但未返回该任务（最常见的"尚未同步"）：作为可归约的 unresolved
      // 结果返回,让 renderer 轮询按 miss 计数并在达到失败上限后兜底 failure,
      // 避免与网络错误混同被跳过而导致无限轮询(区别于上面 catch 的 retryable 网络失败)。
      return { ok: true, task: { taskId: id, status: 'in_progress', songs: [], unresolved: true } }
    }
    return { ok: true, task: parseTask(raw) }
  }
}

/** 统一错误取信息（Claude360ApiError 已脱敏；其余给中性提示，绝不透出栈/凭据）。 */
function errorMessage(error: unknown): string {
  if (error instanceof Claude360ApiError) return error.message
  return '发生未知错误，请稍后重试'
}
