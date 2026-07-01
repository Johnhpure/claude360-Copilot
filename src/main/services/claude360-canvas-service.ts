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
    token: string | undefined
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

// —— /v1/images/* 原始返回项（OpenAI-compatible）——
interface OpenAIImageItem {
  url?: string
  b64_json?: string
}

/** 解出上游可展示错误信息（error.message / message / msg），已脱敏。 */
function envelopeError(env: Claude360ImagesRawEnvelope): string | null {
  const err = env.error
  const raw =
    (typeof err === 'string' && err.trim()) ||
    (err && typeof err === 'object' && typeof err.message === 'string' && err.message.trim()) ||
    (typeof env.message === 'string' && env.message.trim()) ||
    (typeof env.msg === 'string' && env.msg.trim()) ||
    ''
  return raw ? sanitizeClaude360Message(raw) : null
}

/** 归一化单张图片：优先 url，其次 b64_json；两者皆无则丢弃。 */
function mapImage(
  item: OpenAIImageItem,
  meta: { prompt: string; model: string; createdAt: string }
): Claude360CanvasImage | null {
  const url = typeof item.url === 'string' && item.url.trim() ? item.url.trim() : ''
  const b64 = typeof item.b64_json === 'string' && item.b64_json.trim() ? item.b64_json.trim() : ''
  if (url) {
    return {
      id: randomUUID(),
      source: 'url',
      url,
      mimeType: 'image/png',
      prompt: meta.prompt,
      model: meta.model,
      createdAt: meta.createdAt
    }
  }
  if (b64) {
    return {
      id: randomUUID(),
      source: 'base64',
      b64Json: b64,
      mimeType: 'image/png',
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
      throw new Claude360ApiError('尚未选择生图分组，请到「我的」页选择 image 分组')
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

    let env: Claude360ImagesRawEnvelope
    try {
      env = await this.deps.apiClient.postImagesRaw('/v1/images/generations', body, apiKey)
    } catch (error) {
      // 网络/传输错误：可重试。
      return { ok: false, message: errorMessage(error), retryable: true }
    }

    return this.normalize(env, { prompt: input.prompt, model: input.model })
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
    if (input.mask) {
      const mask = decodeImageInput(input.mask)
      if (!mask) {
        return { ok: false, message: '蒙版图片格式不支持' }
      }
      if (mask.byteLength > MAX_IMAGE_BYTES) {
        return { ok: false, message: '蒙版图片过大，请压缩到 25MB 以内后重试' }
      }
      form.append('mask', new Blob([mask.buffer], { type: mask.mimeType }), 'mask.png')
    }
    if (input.size) form.append('size', input.size)
    // 参考图(图生图)一并透传质量与输出格式；newapi edits 走 multipart 全字段转发上游。
    if (input.quality) form.append('quality', input.quality)
    if (input.output_format) form.append('output_format', input.output_format)

    let env: Claude360ImagesRawEnvelope
    try {
      env = await this.deps.apiClient.postImagesMultipart('/v1/images/edits', form, apiKey)
    } catch (error) {
      return { ok: false, message: errorMessage(error), retryable: true }
    }

    return this.normalize(env, { prompt: input.prompt, model: input.model })
  }

  /** 归一化上游 body 为结果：优先解 error；再取 data 数组归一化。 */
  private normalize(
    env: Claude360ImagesRawEnvelope,
    meta: { prompt: string; model: string }
  ): Claude360ImageResult {
    const upstreamError = envelopeError(env)
    if (upstreamError) {
      return { ok: false, message: upstreamError }
    }
    const rows = Array.isArray(env.data) ? (env.data as OpenAIImageItem[]) : []
    const createdAt = new Date().toISOString()
    const images = rows
      .map((row) => mapImage(row, { ...meta, createdAt }))
      .filter((img): img is Claude360CanvasImage => img !== null)
    if (images.length === 0) {
      return { ok: false, message: '生成失败，未返回图片，请稍后重试' }
    }
    return { ok: true, images }
  }
}

/** 统一错误取信息（Claude360ApiError 已脱敏；其余给中性提示，绝不透出栈/凭据）。 */
function errorMessage(error: unknown): string {
  if (error instanceof Claude360ApiError) return error.message
  return '发生未知错误，请稍后重试'
}
