import type { Claude360Envelope } from '../../shared/claude360'

/**
 * Claude360 中转站 HTTP 客户端（plan-02 Task 3）。
 * 解析 newapi `{ success, data }` 信封；错误信息脱敏 Authorization / token / key /
 * password，绝不把敏感 header / body 拼进错误对象。
 */

export class Claude360ApiError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'Claude360ApiError'
    this.status = status
  }
}

/** 脱敏：移除可能出现的 Bearer token、authorization / password / token / key 取值。 */
export function sanitizeClaude360Message(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(authorization|password|api[-_]?key|token|key)\b\s*[:=]\s*[^\s,;"']+/gi, '$1=[redacted]')
}

export type Claude360ApiClientOptions = {
  baseUrl: string
  fetchImpl?: typeof fetch
  /** 单次请求超时（毫秒），默认 120s；超时返回中性可重试错误，不泄露 url/header/body。 */
  timeoutMs?: number
}

/**
 * Suno（/suno/*）返回的是 `{ code, message?, data }` 结构（code 为字符串 "success"
 * 或数字错误码），**不是** newapi 的 `{ success, data }` 信封。music service 需要
 * 原样拿到该 body 自行判定，因此单列一个 raw POST 通道。
 */
export type Claude360SunoRawEnvelope = {
  code?: string | number
  message?: string
  msg?: string
  data?: unknown
}

/**
 * OpenAI-compatible images endpoint（/v1/images/*）返回的是原始
 * `{ data: [{ url | b64_json }] }` 结构（错误时可能是 `{ error: { message } }`
 * 或 newapi `{ message }`），**不是** newapi 的 `{ success, data }` 信封。
 * canvas service 需要原样拿到该 body 自行归一化，因此单列原始 POST 通道
 * （JSON 与 multipart 各一个），与 music 的 postSunoRaw 同思路。
 */
export type Claude360ImagesRawEnvelope = {
  data?: unknown
  error?: { message?: string } | string
  message?: string
  msg?: string
}

export class Claude360ApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: Claude360ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 120_000
  }

  /**
   * 统一带超时的 fetch：用 AbortController 在 timeoutMs 后中断请求。
   * 超时与网络错误都不透出原始错误（可能含 url/header）；超时给可重试中性提示，
   * 与其它网络错误区分，便于 UI 提示用户重试而非误判为格式/鉴权错误。
   */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal })
    } catch {
      if (controller.signal.aborted) throw new Claude360ApiError('请求超时，请稍后重试')
      throw new Claude360ApiError('网络请求失败，请检查网络连接')
    } finally {
      clearTimeout(timer)
    }
  }

  get<T>(path: string, token?: string): Promise<T> {
    return this.request<T>('GET', path, undefined, token)
  }

  post<T>(path: string, body?: unknown, token?: string): Promise<T> {
    return this.request<T>('POST', path, body, token)
  }

  /**
   * Suno raw POST：返回上游 `{ code, message?, data }` 原始 body，不做 `{success}`
   * 信封解包。网络失败沿用中性提示（不泄露 url/header）；日志/错误脱敏由调用方
   * 通过 sanitizeClaude360Message 保障。
   */
  async postSunoRaw(
    path: string,
    body: unknown,
    token: string | undefined
  ): Promise<Claude360SunoRawEnvelope> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })

    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object') {
      return parsed as Claude360SunoRawEnvelope
    }
    if (!response.ok) {
      throw new Claude360ApiError(`请求失败 (HTTP ${response.status})`, response.status)
    }
    throw new Claude360ApiError('响应格式异常', response.status)
  }

  /**
   * Images JSON raw POST（/v1/images/generations）：返回上游原始 body。
   * 与 postSunoRaw 一致，不做 `{success}` 解包；错误由调用方按 body 归一化。
   */
  async postImagesRaw(
    path: string,
    body: unknown,
    token: string | undefined
  ): Promise<Claude360ImagesRawEnvelope> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    return this.imagesRequest(path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) })
  }

  /**
   * Images multipart raw POST（/v1/images/edits）：body 传标准 FormData，
   * **不设置 Content-Type**，交由 fetch/undici 自动带 multipart boundary。
   */
  async postImagesMultipart(
    path: string,
    form: FormData,
    token: string | undefined
  ): Promise<Claude360ImagesRawEnvelope> {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    return this.imagesRequest(path, { method: 'POST', headers, body: form })
  }

  private async imagesRequest(
    path: string,
    init: RequestInit
  ): Promise<Claude360ImagesRawEnvelope> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, init)

    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object') {
      return parsed as Claude360ImagesRawEnvelope
    }
    // 后端返回非 JSON（如 HTML 网关错误页）：不回传正文，给中性提示。
    if (!response.ok) {
      throw new Claude360ApiError(`请求失败 (HTTP ${response.status})`, response.status)
    }
    throw new Claude360ApiError('响应格式异常', response.status)
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    token: string | undefined
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })

    let envelope: unknown = null
    try {
      envelope = await response.json()
    } catch {
      envelope = null
    }

    if (isEnvelope(envelope)) {
      if (envelope.success) return envelope.data as T
      const message = typeof envelope.message === 'string' && envelope.message.trim()
        ? sanitizeClaude360Message(envelope.message)
        : `请求失败 (HTTP ${response.status})`
      throw new Claude360ApiError(message, response.status)
    }

    if (!response.ok) {
      throw new Claude360ApiError(`请求失败 (HTTP ${response.status})`, response.status)
    }
    throw new Claude360ApiError('响应格式异常', response.status)
  }
}

function isEnvelope(value: unknown): value is Claude360Envelope<unknown> & { message?: unknown } {
  return typeof value === 'object' && value !== null && 'success' in value
}
