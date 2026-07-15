import { describe, expect, it, vi } from 'vitest'
import { createReplayedChannelSubscriber, type ReplayedChannelIpc } from './replayed-ipc-channel'

function fakeIpc(): ReplayedChannelIpc & {
  emit: (channel: string, payload: unknown) => void
  listenerCount: (channel: string) => number
} {
  const listeners = new Map<string, Array<(event: unknown, payload: unknown) => void>>()
  return {
    on: (channel, listener) => {
      const list = listeners.get(channel) ?? []
      list.push(listener)
      listeners.set(channel, list)
    },
    removeListener: (channel, listener) => {
      const list = listeners.get(channel) ?? []
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    },
    emit: (channel, payload) => {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener({}, payload)
    },
    listenerCount: (channel) => (listeners.get(channel) ?? []).length
  }
}

describe('createReplayedChannelSubscriber', () => {
  it('replays a payload that arrived before the consumer subscribed (cold-start race)', () => {
    const ipc = fakeIpc()
    const subscribe = createReplayedChannelSubscriber<{ maximized: boolean }>(
      ipc,
      'window:maximized-changed',
      'latest'
    )
    // main 在 did-finish-load / ready-to-show 即推送——此时 renderer 还没订阅。
    ipc.emit('window:maximized-changed', { maximized: true })

    const handler = vi.fn()
    subscribe(handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ maximized: true })
  })

  it('keeps buffering the latest payload and only replays the newest one', () => {
    const ipc = fakeIpc()
    const subscribe = createReplayedChannelSubscriber<{ material: string }>(
      ipc,
      'window:material-applied',
      'latest'
    )
    ipc.emit('window:material-applied', { material: 'mica' })
    ipc.emit('window:material-applied', { material: 'none' })

    const handler = vi.fn()
    subscribe(handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ material: 'none' })
  })

  it('delivers live events after subscribe exactly once per event', () => {
    const ipc = fakeIpc()
    const subscribe = createReplayedChannelSubscriber<{ n: number }>(ipc, 'chan', 'latest')
    const handler = vi.fn()
    subscribe(handler)
    expect(handler).not.toHaveBeenCalled()

    ipc.emit('chan', { n: 1 })
    ipc.emit('chan', { n: 2 })
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({ n: 2 })
  })

  it("mode 'latest' replays the current state to a re-subscriber", () => {
    const ipc = fakeIpc()
    const subscribe = createReplayedChannelSubscriber<{ maximized: boolean }>(ipc, 'chan', 'latest')
    const first = vi.fn()
    const unsubscribe = subscribe(first)
    ipc.emit('chan', { maximized: true })
    unsubscribe()

    const second = vi.fn()
    subscribe(second)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith({ maximized: true })
  })

  it("mode 'once' replays a pending command a single time only", () => {
    const ipc = fakeIpc()
    const subscribe = createReplayedChannelSubscriber<{ workspaceRoot: string }>(
      ipc,
      'workspace:open-request',
      'once'
    )
    ipc.emit('workspace:open-request', { workspaceRoot: '/ws/a' })

    const first = vi.fn()
    const unsubscribe = subscribe(first)
    expect(first).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith({ workspaceRoot: '/ws/a' })
    unsubscribe()

    // 命令语义：重订阅不得重复执行同一条打开请求。
    const second = vi.fn()
    subscribe(second)
    expect(second).not.toHaveBeenCalled()
  })

  it('unsubscribe removes only the consumer listener; the buffer listener stays', () => {
    const ipc = fakeIpc()
    const subscribe = createReplayedChannelSubscriber<{ n: number }>(ipc, 'chan', 'latest')
    expect(ipc.listenerCount('chan')).toBe(1)

    const handler = vi.fn()
    const unsubscribe = subscribe(handler)
    expect(ipc.listenerCount('chan')).toBe(2)
    unsubscribe()
    expect(ipc.listenerCount('chan')).toBe(1)

    // 解绑后事件仍进缓存，供下次订阅重放。
    ipc.emit('chan', { n: 7 })
    const late = vi.fn()
    subscribe(late)
    expect(late).toHaveBeenCalledWith({ n: 7 })
  })
})
