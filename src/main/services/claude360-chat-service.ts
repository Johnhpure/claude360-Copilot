import type { Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import { DEFAULT_CLAUDE360_BASE_URL } from '../../shared/app-settings-claude360'
import type { Claude360TokenPurpose } from '../../shared/claude360'
import { Claude360ApiError, sanitizeClaude360Message } from './claude360-api-client'

/**
 * Claude360 通用文本流式 chat 服务（阶段3：AI 写词助手）。
 *
 * - 复用 text 分组 Key（ensureGroupKey(group,'text')）+ settings.baseUrl，直接命中已存在的
 *   `/v1/chat/completions`（标准 OpenAI 流式），**不新增后端接口**。
 * - 只暴露 streamChat：逐 token 回调 onDelta，流结束 resolve，出错 reject（脱敏消息）。
 *   SSE 生命周期（AbortController / 推送渲染进程）由 IPC 层负责，本服务不触碰 DOM/IPC。
 * - API Key 只在 main 使用，绝不出现在返回值 / 回调里。
 */

export type Claude360ChatServiceDeps = {
  /** 读 Claude360 settings（取 selectedTextGroup / baseUrl）。 */
  readClaude360(): Claude360SettingsV1 | Promise<Claude360SettingsV1>
  /** 确保某分组对应用途的 Key 并返回明文。 */
  ensureGroupKey: (group: string, purpose: Claude360TokenPurpose) => Promise<string>
  /** 注入 fetch，便于测试；默认全局 fetch。 */
  fetchImpl?: typeof fetch
}

export type Claude360ChatStreamParams = {
  model: string
  system: string
  user: string
  signal: AbortSignal
  onDelta: (delta: string) => void
}

export class Claude360ChatService {
  private readonly deps: Claude360ChatServiceDeps

  constructor(deps: Claude360ChatServiceDeps) {
    this.deps = deps
  }

  /** 取 text 分组的 Key；未登录/未选分组由 ensureGroupKey 内部抛出可展示错误。 */
  private async resolve(): Promise<{ apiKey: string; baseUrl: string }> {
    const settings = await this.deps.readClaude360()
    const group = (settings.selectedTextGroup ?? '').trim() || 'auto'
    const apiKey = await this.deps.ensureGroupKey(group, 'text')
    const baseUrl = (settings.baseUrl ?? DEFAULT_CLAUDE360_BASE_URL).replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  /**
   * 流式对话：命中 /v1/chat/completions（stream:true），逐行解析 `data:` 增量，
   * 通过 onDelta 逐 token 回调。调用方通过 signal 取消。
   */
  async streamChat(params: Claude360ChatStreamParams): Promise<void> {
    const { model, system, user, signal, onDelta } = params
    const { apiKey, baseUrl } = await this.resolve()
    const fetchImpl = this.deps.fetchImpl ?? fetch

    let res: Response
    try {
      res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      })
    } catch (error) {
      throw new Claude360ApiError(sanitizeClaude360Message(errorText(error)))
    }

    if (!res.ok || !res.body) {
      throw new Claude360ApiError(`写词请求失败（HTTP ${res.status}）`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // 保留最后一行（可能不完整）
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = json.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) onDelta(delta)
        } catch {
          // keepalive / 非 JSON 行忽略
        }
      }
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
