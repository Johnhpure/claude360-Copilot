import type { NativeImage } from 'electron'

// turn 完成系统通知（从 index.ts 提取为依赖注入模块，07-14-windows-native-polish
// R5）：点击行为从「仅聚焦主窗口」升级为「聚焦 + 携 threadId 推 renderer 跳转
// 对应会话」。抽出来是为了让点击跳转链路可单测（index.ts 的 whenReady 副作用
// 无法在 vitest 里加载）。

export type TurnCompleteNotificationPayload = {
  threadId?: string
  title?: string
  body?: string
}

export type TurnCompleteNotificationResult =
  | { ok: true; shown: boolean; reason?: string }
  | { ok: false; message: string }

export type NotificationLike = {
  on(event: 'click', listener: () => void): unknown
  show(): void
}

export const NOTIFICATION_TITLE_MAX_LENGTH = 80
export const NOTIFICATION_BODY_MAX_LENGTH = 180

export function normalizeNotificationText(
  raw: string | undefined,
  fallback: string,
  maxLength: number
): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

export type TurnCompleteNotificationDeps = {
  loadSettings: () => Promise<{ notifications: { turnComplete: boolean } }>
  isSupported: () => boolean
  createNotification: (options: { title: string; body: string; icon?: NativeImage }) => NotificationLike
  getIcon: () => NativeImage | undefined
  productName: string
  revealMainWindow: () => void
  /** 点击时携带 threadId 的跳转（main → renderer 'thread:navigate-request'）。 */
  navigateToThread: (threadId: string) => void
  logError: (category: string, message: string, detail?: unknown) => void
}

export function createTurnCompleteNotificationHandler(
  deps: TurnCompleteNotificationDeps
): (payload: TurnCompleteNotificationPayload) => Promise<TurnCompleteNotificationResult> {
  return async (payload) => {
    const settings = await deps.loadSettings()
    if (!settings.notifications.turnComplete) {
      return { ok: true, shown: false, reason: 'disabled' }
    }
    if (!deps.isSupported()) {
      return { ok: true, shown: false, reason: 'unsupported' }
    }

    const title = normalizeNotificationText(payload.title, deps.productName, NOTIFICATION_TITLE_MAX_LENGTH)
    const body = normalizeNotificationText(payload.body, 'Conversation complete.', NOTIFICATION_BODY_MAX_LENGTH)

    try {
      const notification = deps.createNotification({ title, body, icon: deps.getIcon() })
      const threadId = payload.threadId?.trim() ?? ''
      notification.on('click', () => {
        deps.revealMainWindow()
        if (threadId) deps.navigateToThread(threadId)
      })
      notification.show()
      return { ok: true, shown: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      deps.logError('notification', 'Failed to show turn completion notification', {
        message,
        threadId: payload.threadId
      })
      return { ok: false, message }
    }
  }
}
