import { describe, expect, it, vi } from 'vitest'
import {
  createTurnCompleteNotificationHandler,
  normalizeNotificationText,
  type NotificationLike,
  type TurnCompleteNotificationDeps
} from './turn-complete-notification'

function makeDeps(overrides: Partial<TurnCompleteNotificationDeps> = {}): {
  deps: TurnCompleteNotificationDeps
  clickHandlers: Array<() => void>
  shown: ReturnType<typeof vi.fn>
  revealMainWindow: ReturnType<typeof vi.fn>
  navigateToThread: ReturnType<typeof vi.fn>
} {
  const clickHandlers: Array<() => void> = []
  const shown = vi.fn()
  const revealMainWindow = vi.fn()
  const navigateToThread = vi.fn()
  const notification: NotificationLike = {
    on: (_event, listener) => {
      clickHandlers.push(listener)
      return notification
    },
    show: shown
  }
  const deps: TurnCompleteNotificationDeps = {
    loadSettings: async () => ({ notifications: { turnComplete: true } }),
    isSupported: () => true,
    createNotification: () => notification,
    getIcon: () => undefined,
    productName: 'Claude360 Copilot',
    revealMainWindow,
    navigateToThread,
    logError: vi.fn(),
    ...overrides
  }
  return { deps, clickHandlers, shown, revealMainWindow, navigateToThread }
}

describe('normalizeNotificationText', () => {
  it('falls back and truncates with an ellipsis', () => {
    expect(normalizeNotificationText(undefined, 'fallback', 20)).toBe('fallback')
    expect(normalizeNotificationText('   ', 'fallback', 20)).toBe('fallback')
    expect(normalizeNotificationText('a'.repeat(30), 'x', 20)).toBe(`${'a'.repeat(19)}…`)
  })
})

describe('createTurnCompleteNotificationHandler', () => {
  it('skips silently when the setting is disabled', async () => {
    const { deps, shown } = makeDeps({
      loadSettings: async () => ({ notifications: { turnComplete: false } })
    })
    const handler = createTurnCompleteNotificationHandler(deps)
    await expect(handler({ threadId: 't1' })).resolves.toEqual({
      ok: true,
      shown: false,
      reason: 'disabled'
    })
    expect(shown).not.toHaveBeenCalled()
  })

  it('reports unsupported environments', async () => {
    const { deps } = makeDeps({ isSupported: () => false })
    const handler = createTurnCompleteNotificationHandler(deps)
    await expect(handler({})).resolves.toEqual({ ok: true, shown: false, reason: 'unsupported' })
  })

  it('reveals the window and navigates to the thread on click', async () => {
    const { deps, clickHandlers, revealMainWindow, navigateToThread } = makeDeps()
    const handler = createTurnCompleteNotificationHandler(deps)
    await expect(handler({ threadId: 'thread-42', title: 'Done', body: 'b' })).resolves.toEqual({
      ok: true,
      shown: true
    })

    expect(clickHandlers).toHaveLength(1)
    clickHandlers[0]?.()
    expect(revealMainWindow).toHaveBeenCalledTimes(1)
    expect(navigateToThread).toHaveBeenCalledWith('thread-42')
  })

  it('only reveals the window when the payload has no threadId', async () => {
    const { deps, clickHandlers, revealMainWindow, navigateToThread } = makeDeps()
    const handler = createTurnCompleteNotificationHandler(deps)
    await handler({ title: 'Done' })
    clickHandlers[0]?.()
    expect(revealMainWindow).toHaveBeenCalledTimes(1)
    expect(navigateToThread).not.toHaveBeenCalled()
  })

  it('returns the failure message when the notification cannot be created', async () => {
    const logError = vi.fn()
    const { deps } = makeDeps({
      createNotification: () => {
        throw new Error('no notifications here')
      },
      logError
    })
    const handler = createTurnCompleteNotificationHandler(deps)
    await expect(handler({ threadId: 't' })).resolves.toEqual({
      ok: false,
      message: 'no notifications here'
    })
    expect(logError).toHaveBeenCalledTimes(1)
  })
})
