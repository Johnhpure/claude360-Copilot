// AI 写词流式生成编排（renderer，阶段3）。
//
// 把 buildLyricsPrompt + claude360:chat 流式 IPC 封装成注入式 generateLyrics，
// 供写词模态调用；副作用（订阅/取消）在此收口，模态组件保持纯展示可测。
import type {
  Claude360ChatDeltaPayload,
  Claude360ChatEndPayload,
  Claude360ChatErrorPayload,
  Claude360ChatStreamStartPayload
} from '@shared/kun-gui-api'
import { buildLyricsPrompt, type LyricsPromptOpts } from '@shared/lyrics-prompt'

export type LyricsStreamApi = {
  claude360ChatStreamStart: (p: Claude360ChatStreamStartPayload) => Promise<{ streamId: string }>
  claude360ChatStreamStop: (streamId: string) => Promise<boolean>
  onClaude360ChatDelta: (cb: (p: Claude360ChatDeltaPayload) => void) => () => void
  onClaude360ChatEnd: (cb: (p: Claude360ChatEndPayload) => void) => () => void
  onClaude360ChatError: (cb: (p: Claude360ChatErrorPayload) => void) => () => void
}

export type LyricsStreamHandle = { cancel: () => void }

export type GenerateLyricsCallbacks = {
  onDelta: (delta: string) => void
  onEnd: () => void
  onError: (message: string) => void
}

function createLyricsStreamId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `lyrics_${Date.now().toString(36)}_${random}`
}

/**
 * 发起一次流式写词：组装 prompt → start → 按 streamId 过滤订阅 delta/end/error。
 * 返回 handle.cancel() 用于中止（模态关闭 / 重新生成时调用）。
 */
export function generateLyrics(
  api: LyricsStreamApi,
  params: { model: string } & LyricsPromptOpts,
  cb: GenerateLyricsCallbacks
): LyricsStreamHandle {
  const { model, ...opts } = params
  const { system, user } = buildLyricsPrompt(opts)
  const streamId = createLyricsStreamId()
  let stopped = false
  const offs: Array<() => void> = []
  const cleanup = (): void => {
    for (const f of offs) f()
    offs.length = 0
  }

  offs.push(
    api.onClaude360ChatDelta((p) => {
      if (p.streamId === streamId) cb.onDelta(p.delta)
    })
  )
  offs.push(
    api.onClaude360ChatEnd((p) => {
      if (p.streamId === streamId) {
        cleanup()
        cb.onEnd()
      }
    })
  )
  offs.push(
    api.onClaude360ChatError((p) => {
      if (p.streamId === streamId) {
        cleanup()
        cb.onError(p.message ?? '写词失败，请稍后重试')
      }
    })
  )

  api
    .claude360ChatStreamStart({ model, system, user, streamId })
    .then(() => {
      if (stopped) {
        void api.claude360ChatStreamStop(streamId)
        return
      }
    })
    .catch((e) => {
      cleanup()
      cb.onError(e instanceof Error ? e.message : '写词失败，请稍后重试')
    })

  return {
    cancel: (): void => {
      stopped = true
      cleanup()
      void api.claude360ChatStreamStop(streamId)
    }
  }
}
