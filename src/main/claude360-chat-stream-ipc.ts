import type { IpcMain, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { claude360ChatStreamStartPayloadSchema, streamIdSchema } from './ipc/app-ipc-schemas'
import type { Claude360ChatService } from './services/claude360-chat-service'
import { Claude360ApiError } from './services/claude360-api-client'

/**
 * Claude360 通用文本流式 chat 的 IPC 层（AI 写词助手）。
 *
 * 照 runtime-sse-ipc 的范式（start invoke 返回 streamId + webContents.send 分块推送 +
 * 渲染侧按 streamId 过滤），但大幅简化：单次请求、无重连、无节流（歌词量小）。
 * 三个 channel：claude360:chat:delta / :end / :error。生命周期用 Map<streamId, AbortController>。
 */
function sendChat(wc: WebContents, channel: string, payload: unknown): boolean {
  if (wc.isDestroyed()) return false
  try {
    wc.send(channel, payload)
    return true
  } catch {
    return false
  }
}

export function registerClaude360ChatStreamIpc(options: {
  ipcMain: IpcMain
  chatService: Claude360ChatService
  logError: (category: string, message: string, detail?: unknown) => void
}): void {
  const { ipcMain, chatService, logError } = options
  const controllers = new Map<string, AbortController>()

  ipcMain.handle('claude360:chat:stream-start', async (event, args: unknown) => {
    const req = claude360ChatStreamStartPayloadSchema.parse(args)
    const requestedId = req.streamId?.trim() ?? ''
    const id = requestedId || randomUUID()

    // 同 id 复用：先中止旧流。
    const existing = controllers.get(id)
    if (existing) {
      existing.abort()
      controllers.delete(id)
    }
    const ac = new AbortController()
    controllers.set(id, ac)
    const wc = event.sender

    void (async () => {
      try {
        await chatService.streamChat({
          model: req.model,
          system: req.system,
          user: req.user,
          group: req.group,
          signal: ac.signal,
          onDelta: (delta) => sendChat(wc, 'claude360:chat:delta', { streamId: id, delta })
        })
        if (!ac.signal.aborted) sendChat(wc, 'claude360:chat:end', { streamId: id })
      } catch (error) {
        if (ac.signal.aborted) return
        const message =
          error instanceof Claude360ApiError ? error.message : '写词失败，请稍后重试'
        sendChat(wc, 'claude360:chat:error', { streamId: id, message })
        logError('claude360-chat', 'chat stream error', {
          message: error instanceof Error ? error.message : String(error),
          streamId: id
        })
      } finally {
        controllers.delete(id)
      }
    })()

    return { streamId: id }
  })

  ipcMain.handle('claude360:chat:stream-stop', async (_, streamId: unknown) => {
    const id = streamIdSchema.parse(streamId)
    const ac = controllers.get(id)
    if (ac) {
      ac.abort()
      controllers.delete(id)
    }
    return true
  })
}
