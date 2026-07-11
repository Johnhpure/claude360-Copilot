import { randomUUID } from 'node:crypto'
import type { Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import type { Claude360TokenPurpose } from '../../shared/claude360'
import type {
  Claude360CanvasImage,
  Claude360ImageEditPayload,
  Claude360ImageGeneratePayload,
  Claude360ImageResult
} from '../../shared/claude360-canvas'
import {
  Claude360ApiError,
  sanitizeClaude360Message,
  type Claude360ImagesRawEnvelope
} from './claude360-api-client'
import type { Claude360SecretStore } from './claude360-secret-store'

/**
 * Claude360 原生生图工作台服务（plan-06 Task 2）。
 *
 * - 依赖注入构造 + 端口，风格与 claude360-model-service / music-service 一致。
 * - 从 `settings.claude360.selectedImageGroup` 取 image 分组，用 `ensureGroupKey`
 *   拿到该分组 image Key，调 `/v1/images/generations`（JSON）与 `/v1/images/edits`
 *   （multipart）。
 * - **API Key 只在 main 进程使用，绝不出现在返回给 renderer 的结果里**（Risk Notes）。
 * - 生图/编辑走 OpenAI-compatible 原始 body（`{ data:[{ url | b64_json }] }`），由
 *   apiClient.postImagesRaw/postImagesMultipart 原样带回，本服务自行归一化。
 * - url 与 b64_json 两类结果归一为 `Claude360CanvasImage[]`；未知字段忽略。
 */

// 编辑源图解码后允许的最大字节数（约 25MB，避免超大图打爆 main/上游）。
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export type Claude360CanvasApiClientPort = {
  postImagesRaw(
    path: string,
    body: unknown,
    token: string | undefined,
    options?: { timeoutMs?: number }
  ): Promise<Claude360ImagesRawEnvelope>
  postImagesMultipart(
    path: string,
    form: FormData,
    token: string | undefined
  ): Promise<Claude360ImagesRawEnvelope>
}

export type Claude360CanvasServiceDeps = {
  apiClient: Claude360CanvasApiClientPort
  secretStore: Claude360SecretStore
  /** 读 Claude360 settings（取 selectedImageGroup）。 */
  readClaude360(): Claude360SettingsV1 | Promise<Claude360SettingsV1>
  /** 确保某分组对应用途的 Key 并返回明文（token service + secret store 提供）。 */
  ensureGroupKey: (group: string, purpose: Claude360TokenPurpose) => Promise<string>
}

// —— /v1/images/* 原始返回的图片结果提取（多格式兼容）——
//
// 实测上游/中转不一定走标准 `data:[{url|b64_json}]`：还可能是 images[]、
// output[].content[]（Responses 风格）、顶层 url / image_url / b64、data URL
// 或裸 base64 串。这里做统一提取：**只要任一路径能解出可用图片就算成功**，
// 不因 body 里同时带 message/warning 文案而误判失败。

export type NormalizedImage = { url?: string; b64?: string; mimeType?: string }

export type NormalizedImageResponse = {
  success: boolean
  images: NormalizedImage[]
  error?: {
    code?: string
    message?: string
    type?: string
  }
  warnings?: string[]
}

const DATA_URL_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i
const IMAGE_CONTAINER_KEYS = ['data', 'images', 'output', 'result', 'content'] as const

/** 字符串 → 图片：data URL / http(s) URL / 长裸 base64（字符集+长度双重把关）。 */
function extractFromString(value: string): NormalizedImage | null {
  const raw = value.trim()
  if (!raw) return null
  const dataUrl = DATA_URL_IMAGE.exec(raw)
  if (dataUrl) return { b64: dataUrl[2].replace(/\s+/g, ''), mimeType: dataUrl[1].toLowerCase() }
  if (/^https?:\/\//i.test(raw)) return { url: raw }
  if (raw.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(raw)) return { b64: raw.replace(/\s+/g, '') }
  return null
}

/** 单条目 → 图片：string 直取；object 依次试 url/image_url(含嵌套 {url})/b64 系字段。 */
function extractFromEntry(entry: unknown): NormalizedImage | null {
  if (typeof entry === 'string') return extractFromString(entry)
  if (!entry || typeof entry !== 'object') return null
  const item = entry as Record<string, unknown>
  for (const key of ['url', 'image_url', 'imageUrl', 'image', 'result']) {
    const value = item[key]
    if (typeof value === 'string') {
      const found = extractFromString(value)
      if (found) return found
    }
    // Responses/chat vision 风格：{ image_url: { url } }
    if (value && typeof value === 'object') {
      const nested = (value as Record<string, unknown>).url
      if (typeof nested === 'string') {
        const found = extractFromString(nested)
        if (found) return found
      }
    }
  }
  for (const key of ['b64_json', 'b64', 'base64']) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return { b64: value.trim().replace(/\s+/g, '') }
  }
  return null
}

/**
 * 遍历所有已知容器路径收集图片：data[]/images[]/output[](含 content[])/result/顶层。
 * NewAPI 有时会再套一层 `{ success, data: { data: [...] } }`，因此容器键递归
 * 扫描；但不扫描任意字符串字段，避免把普通 message 里的 URL 当成图片。
 */
function collectImages(env: Claude360ImagesRawEnvelope): NormalizedImage[] {
  const found: NormalizedImage[] = []
  const walk = (entry: unknown, depth = 0): void => {
    if (depth > 8 || entry === undefined || entry === null) return
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item, depth + 1)
      return
    }
    const direct = extractFromEntry(entry)
    if (direct) found.push(direct)
    if (!entry || typeof entry !== 'object') return
    const record = entry as Record<string, unknown>
    for (const key of IMAGE_CONTAINER_KEYS) {
      if (key in record) walk(record[key], depth + 1)
    }
  }
  walk(env)
  return dedupeImages(found)
}

/** 去重：同一 url / 同一 base64（前缀足够区分）只保留一张，避免 data+images 并存时重复。 */
function dedupeImages(images: NormalizedImage[]): NormalizedImage[] {
  const seen = new Set<string>()
  const unique: NormalizedImage[] = []
  for (const image of images) {
    const key = image.url ?? `b64:${image.b64?.slice(0, 128)}:${image.b64?.length}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(image)
  }
  return unique
}

// —— 调试日志：完整打印真实响应结构（超长 base64 摘要化，字段名全量可见）——

function summarizeForLog(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    // 长 base64（含 data URL 载荷）替换为长度摘要，避免几 MB 淹没控制台；
    // URL / 普通文案含 ":/" 等字符不会被误伤。
    if (value.length > 512 && /^(data:image\/[a-z0-9.+-]+;base64,)?[A-Za-z0-9+/=\s]+$/i.test(value)) {
      return `<base64 length=${value.length}>`
    }
    return sanitizeClaude360Message(value)
  }
  if (Array.isArray(value)) {
    return depth > 6 ? '<max-depth>' : value.map((item) => summarizeForLog(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    if (depth > 6) return '<max-depth>'
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = summarizeForLog(item, depth + 1)
    }
    return out
  }
  return value
}

function collectFieldsByName(value: unknown, matcher: RegExp, depth = 0): unknown[] {
  if (depth > 8 || value === undefined || value === null) return []
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFieldsByName(item, matcher, depth + 1))
  }
  if (typeof value !== 'object') return []
  const out: unknown[] = []
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (matcher.test(key)) out.push(summarizeForLog(item))
    out.push(...collectFieldsByName(item, matcher, depth + 1))
  }
  return out
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? sanitizeClaude360Message(value.trim()) : undefined
}

function envelopeErrorDetails(
  env: Claude360ImagesRawEnvelope
): NormalizedImageResponse['error'] | undefined {
  const record = env as Record<string, unknown>
  const err = record.error
  if (typeof err === 'string' && err.trim()) {
    return { message: sanitizeClaude360Message(err.trim()) }
  }
  if (err && typeof err === 'object') {
    const errorRecord = err as Record<string, unknown>
    const message = stringField(errorRecord, 'message')
    return {
      ...(stringField(errorRecord, 'code') ? { code: stringField(errorRecord, 'code') } : {}),
      ...(message ? { message } : {}),
      ...(stringField(errorRecord, 'type') ? { type: stringField(errorRecord, 'type') } : {})
    }
  }
  const message = stringField(record, 'message') ?? stringField(record, 'msg')
  return message ? { message } : undefined
}

function normalizeWarningValue(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [sanitizeClaude360Message(value.trim())]
  if (Array.isArray(value)) return value.flatMap((item) => normalizeWarningValue(item))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return ['message', 'msg', 'warning', 'warnings']
      .flatMap((key) => normalizeWarningValue(record[key]))
  }
  return []
}

function collectWarnings(env: Claude360ImagesRawEnvelope): string[] {
  const record = env as Record<string, unknown>
  const values: string[] = [
    ...normalizeWarningValue(record.warning),
    ...normalizeWarningValue(record.warnings)
  ]
  const message = stringField(record, 'message') ?? stringField(record, 'msg')
  if (message) values.push(message)
  return [...new Set(values)]
}

export function normalizeImageResponse(env: Claude360ImagesRawEnvelope): NormalizedImageResponse {
  const images = collectImages(env)
  if (images.length > 0) {
    const warnings = collectWarnings(env)
    return {
      success: true,
      images,
      ...(warnings.length > 0 ? { warnings } : {})
    }
  }
  const error = envelopeErrorDetails(env)
  return {
    success: false,
    images: [],
    ...(error && error.message ? { error } : {})
  }
}

function logImagesShape(path: string, env: Claude360ImagesRawEnvelope, extracted: NormalizedImage[]): void {
  if (process.env.NODE_ENV === 'test') return
  const record = env as Record<string, unknown>
  // 按任务书要求打印完整真实响应（原始 body 结构 / 提取到的图片字段），不猜字段名。
  // 仅 main 进程控制台，不入 renderer。
  console.info(`[claude360-canvas] ${path} raw response`, JSON.stringify(summarizeForLog(env)))
  console.info(
    `[claude360-canvas] ${path} response fields`,
    JSON.stringify({
      data: summarizeForLog(record.data ?? null),
      error: summarizeForLog(record.error ?? null),
      message: typeof record.message === 'string' ? sanitizeClaude360Message(record.message) : null,
      msg: typeof record.msg === 'string' ? sanitizeClaude360Message(record.msg) : null,
      imageUrls: extracted.map((image) => image.url).filter((url): url is string => Boolean(url)),
      base64Images: extracted
        .filter((image) => Boolean(image.b64))
        .map((image) => ({ b64Length: image.b64?.length ?? 0, mimeType: image.mimeType ?? null })),
      finishReasons: collectFieldsByName(env, /^finish[_-]?reason$/i),
      safety: collectFieldsByName(env, /safety|safe|blocked|policy|moderation/i)
    })
  )
  console.info(
    `[claude360-canvas] ${path} extracted images`,
    JSON.stringify(
      extracted.map((image) => ({
        kind: image.url ? 'url' : 'base64',
        url: image.url ?? null,
        b64Length: image.b64?.length ?? null,
        mimeType: image.mimeType ?? null
      }))
    )
  )
}

function logImageRequest(path: string, payload: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test') return
  console.info(`[claude360-canvas] ${path} request`, JSON.stringify(summarizeForLog(payload)))
}

function logNormalizeResult(path: string, normalized: NormalizedImageResponse): void {
  if (process.env.NODE_ENV === 'test') return
  console.info(`[claude360-canvas] ${path} normalize result`, JSON.stringify(summarizeForLog(normalized)))
}

function logFinalDecision(
  path: string,
  decision: {
    ok: boolean
    reason: string
    imageCount: number
    message?: string
  }
): void {
  if (process.env.NODE_ENV === 'test') return
  console.info(`[claude360-canvas] ${path} final decision`, JSON.stringify(decision))
}

/** 解出上游可展示错误信息（error.message / message / msg），已脱敏。 */
function envelopeError(env: Claude360ImagesRawEnvelope): string | null {
  return envelopeErrorDetails(env)?.message ?? null
}

function isSafetyRefusal(message: string): boolean {
  return /unsafe|safety|policy|blocked|moderation|refus/i.test(message)
}

function upstreamFailureMessage(message: string): string {
  return `${isSafetyRefusal(message) ? '模型拒绝' : '上游接口错误'}：${message}`
}

/** 归一化单张图片：url 优先，base64 带真实 mimeType；两者皆无返回 null。 */
function mapImage(
  item: NormalizedImage,
  meta: { prompt: string; model: string; createdAt: string }
): Claude360CanvasImage | null {
  if (item.url) {
    return {
      id: randomUUID(),
      source: 'url',
      url: item.url,
      mimeType: item.mimeType ?? 'image/png',
      prompt: meta.prompt,
      model: meta.model,
      createdAt: meta.createdAt
    }
  }
  if (item.b64) {
    return {
      id: randomUUID(),
      source: 'base64',
      b64Json: item.b64,
      mimeType: item.mimeType ?? 'image/png',
      prompt: meta.prompt,
      model: meta.model,
      createdAt: meta.createdAt
    }
  }
  return null
}

/** 把 dataURL 或纯 base64 解码为 { buffer, byteLength, mimeType }；失败返回 null。 */
function decodeImageInput(
  input: string
): { buffer: ArrayBuffer; byteLength: number; mimeType: string } | null {
  const value = (input ?? '').trim()
  if (!value) return null
  let base64 = value
  let mimeType = 'image/png'
  const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(value)
  if (dataUrl) {
    mimeType = dataUrl[1].trim() || 'image/png'
    base64 = dataUrl[2].trim()
  }
  if (!base64) return null
  // 去除 base64 中可能的空白（换行等），再校验字符集。
  const compact = base64.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null
  let decoded: Buffer
  try {
    decoded = Buffer.from(compact, 'base64')
  } catch {
    return null
  }
  if (decoded.length === 0) return null
  // 复制到独立 ArrayBuffer 供 Blob 使用（Node Buffer 可能由共享/池化 ArrayBuffer
  // 支撑，直接作 BlobPart 与 DOM 类型不兼容；ArrayBuffer 本身是合法 BlobPart）。
  const buffer = new ArrayBuffer(decoded.byteLength)
  new Uint8Array(buffer).set(decoded)
  return { buffer, byteLength: decoded.byteLength, mimeType }
}

export class Claude360CanvasService {
  private readonly deps: Claude360CanvasServiceDeps

  constructor(deps: Claude360CanvasServiceDeps) {
    this.deps = deps
  }

  /** 取 image 分组的 image Key；未登录/未选分组分别抛出可展示错误。 */
  private async imageKey(): Promise<string> {
    const settings = await this.deps.readClaude360()
    const group = (settings.selectedImageGroup ?? '').trim()
    if (!group) {
      throw new Claude360ApiError('尚未选择生图分组，请打开 设置 → 分组及 Key 选择 image 分组。')
    }
    // ensureGroupKey 内部会校验登录态（cli_token 缺失时抛「未登录」）。
    return this.deps.ensureGroupKey(group, 'image')
  }

  async generateImages(input: Claude360ImageGeneratePayload): Promise<Claude360ImageResult> {
    let apiKey: string
    try {
      apiKey = await this.imageKey()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    // 只发送后端需要的稳定字段，避免把无关字段透给上游。
    const body: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      n: input.n ?? 1
    }
    if (input.size) body.size = input.size
    if (input.quality) body.quality = input.quality
    if (input.output_format) body.output_format = input.output_format
    // output_compression 仅对有损格式（jpeg/webp）发送；png 无压缩语义，上游会报参数错误。
    if (
      typeof input.output_compression === 'number' &&
      (input.output_format === 'jpeg' || input.output_format === 'webp')
    ) {
      body.output_compression = input.output_compression
    }
    if (input.moderation) body.moderation = input.moderation
    if (input.response_format) body.response_format = input.response_format
    // stream / codex_cli：随请求体透传（newapi images 通道现状忽略，见 prd C4）。
    if (typeof input.stream === 'boolean') body.stream = input.stream
    if (typeof input.codex_cli === 'boolean') body.codex_cli = input.codex_cli
    // timeout_ms 为本端专用：剥离出请求体，转为该次请求的 fetch 超时。
    const timeoutMs =
      typeof input.timeout_ms === 'number' && Number.isFinite(input.timeout_ms) && input.timeout_ms > 0
        ? Math.floor(input.timeout_ms)
        : undefined
    logImageRequest('/v1/images/generations', body)

    let env: Claude360ImagesRawEnvelope
    try {
      env = await this.deps.apiClient.postImagesRaw(
        '/v1/images/generations',
        body,
        apiKey,
        timeoutMs !== undefined ? { timeoutMs } : undefined
      )
    } catch (error) {
      // 网络/传输错误：可重试。
      return { ok: false, message: `接口请求失败：${errorMessage(error)}`, retryable: true }
    }

    return this.normalize('/v1/images/generations', env, { prompt: input.prompt, model: input.model })
  }

  async editImage(input: Claude360ImageEditPayload): Promise<Claude360ImageResult> {
    // 先鉴权，未登录/无 image 分组的请求提前短路，避免对大图 base64 做无谓解码。
    let apiKey: string
    try {
      apiKey = await this.imageKey()
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }

    const decoded = decodeImageInput(input.image)
    if (!decoded) {
      return { ok: false, message: '图片格式不支持，请提供 PNG/JPEG 图片' }
    }
    if (decoded.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, message: '图片过大，请压缩到 25MB 以内后重试' }
    }

    // 标准 FormData + Blob（Electron 34 / Node 全局可用），交由 fetch 带 boundary。
    const form = new FormData()
    form.append('model', input.model)
    form.append('prompt', input.prompt)
    form.append('image', new Blob([decoded.buffer], { type: decoded.mimeType }), 'image.png')
    let maskByteLength: number | undefined
    if (input.mask) {
      const mask = decodeImageInput(input.mask)
      if (!mask) {
        return { ok: false, message: '蒙版图片格式不支持' }
      }
      if (mask.byteLength > MAX_IMAGE_BYTES) {
        return { ok: false, message: '蒙版图片过大，请压缩到 25MB 以内后重试' }
      }
      maskByteLength = mask.byteLength
      form.append('mask', new Blob([mask.buffer], { type: mask.mimeType }), 'mask.png')
    }
    if (input.size) form.append('size', input.size)
    // 参考图(图生图)一并透传质量与输出格式；newapi edits 走 multipart 全字段转发上游。
    if (input.quality) form.append('quality', input.quality)
    if (input.output_format) form.append('output_format', input.output_format)
    logImageRequest('/v1/images/edits', {
      model: input.model,
      prompt: input.prompt,
      size: input.size ?? null,
      quality: input.quality ?? null,
      output_format: input.output_format ?? null,
      imageBytes: decoded.byteLength,
      maskBytes: maskByteLength ?? null
    })

    let env: Claude360ImagesRawEnvelope
    try {
      env = await this.deps.apiClient.postImagesMultipart('/v1/images/edits', form, apiKey)
    } catch (error) {
      return { ok: false, message: `接口请求失败：${errorMessage(error)}`, retryable: true }
    }

    return this.normalize('/v1/images/edits', env, { prompt: input.prompt, model: input.model })
  }

  /**
   * 归一化上游 body 为结果：**先提取图片，有任一可用图片即成功**；
   * 只有在没有任何图片时才把 error/message 当失败原因——上游 200 成功响应
   * 可能同时带非空 message/warning 文案，按文案先行判失败会把成功结果误判掉
   * （NewAPI 后台已成功、软件内却显示失败的根因）。
   */
  private normalize(
    path: string,
    env: Claude360ImagesRawEnvelope,
    meta: { prompt: string; model: string }
  ): Claude360ImageResult {
    const normalized = normalizeImageResponse(env)
    logImagesShape(path, env, normalized.images)
    logNormalizeResult(path, normalized)
    const createdAt = new Date().toISOString()
    const images = normalized.images
      .map((row) => mapImage(row, { ...meta, createdAt }))
      .filter((img): img is Claude360CanvasImage => img !== null)
    if (images.length > 0) {
      logFinalDecision(path, { ok: true, reason: 'image_result_present', imageCount: images.length })
      return { ok: true, images }
    }
    const upstreamError = envelopeError(env)
    if (upstreamError) {
      const message = upstreamFailureMessage(upstreamError)
      logFinalDecision(path, { ok: false, reason: 'upstream_error_without_image', imageCount: 0, message })
      return { ok: false, message }
    }
    const message = '图片字段缺失：接口响应中未找到可用图片字段'
    logFinalDecision(path, { ok: false, reason: 'missing_image_fields', imageCount: 0, message })
    return { ok: false, message }
  }
}

/** 统一错误取信息（Claude360ApiError 已脱敏；其余给中性提示，绝不透出栈/凭据）。 */
function errorMessage(error: unknown): string {
  if (error instanceof Claude360ApiError) return error.message
  return '发生未知错误，请稍后重试'
}
