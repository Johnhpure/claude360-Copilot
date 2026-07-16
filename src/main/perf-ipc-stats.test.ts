import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import { createIpcStats, getSharedIpcStats, wrapIpcMainWithStats } from './perf-ipc-stats'

type CapturedHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeMockIpcMain(): {
  mock: IpcMain
  handlers: Map<string, CapturedHandler>
  on: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, CapturedHandler>()
  const on = vi.fn()
  const removeHandler = vi.fn()
  const mock = {
    handle: (channel: string, handler: CapturedHandler) => {
      handlers.set(channel, handler)
    },
    on,
    removeHandler,
    // 非函数成员：验证 Proxy 对属性的透传。
    marker: 'original-ipc-main'
  } as unknown as IpcMain
  return { mock, handlers, on, removeHandler }
}

describe('createIpcStats', () => {
  it('aggregates count/totalMs/maxMs/errors per channel', () => {
    const stats = createIpcStats()
    stats.record('settings:get', 5, false)
    stats.record('settings:get', 11, false)
    stats.record('settings:get', 2, true)
    stats.record('app:version', 1, false)

    const rows = stats.snapshot()
    expect(rows).toEqual([
      { channel: 'settings:get', count: 3, totalMs: 18, maxMs: 11, errors: 1 },
      { channel: 'app:version', count: 1, totalMs: 1, maxMs: 1, errors: 0 }
    ])
  })

  it('snapshot sorts by totalMs desc and honors topN', () => {
    const stats = createIpcStats()
    stats.record('a', 10, false)
    stats.record('b', 30, false)
    stats.record('c', 20, false)

    expect(stats.snapshot().map((row) => row.channel)).toEqual(['b', 'c', 'a'])
    expect(stats.snapshot(2).map((row) => row.channel)).toEqual(['b', 'c'])
    expect(stats.snapshot(0)).toEqual([])
  })

  it('reset clears every aggregate', () => {
    const stats = createIpcStats()
    stats.record('a', 10, false, 1_000)
    stats.reset()
    expect(stats.snapshot()).toEqual([])
    expect(stats.recent()).toEqual([])
  })

  it('keeps only the 20 most recent safe operation summaries', () => {
    const stats = createIpcStats()
    for (let index = 0; index < 22; index += 1) {
      stats.record(`channel-${index}`, index, index === 21, 1_000 + index)
    }

    const recent = stats.recent()
    expect(recent).toHaveLength(20)
    expect(recent[0]).toEqual({
      channel: 'channel-2',
      at: new Date(1_002).toISOString(),
      durationMs: 2,
      failed: false
    })
    expect(recent.at(-1)).toEqual({
      channel: 'channel-21',
      at: new Date(1_021).toISOString(),
      durationMs: 21,
      failed: true
    })
  })
})

describe('wrapIpcMainWithStats', () => {
  it('times handlers and passes the return value through unchanged', async () => {
    const { mock, handlers } = makeMockIpcMain()
    const stats = createIpcStats()
    let clock = 100
    const wrapped = wrapIpcMainWithStats(mock, stats, { now: () => clock })

    const payload = { nested: { ok: true } }
    wrapped.handle('settings:get', async (_event, arg: unknown) => {
      clock += 7
      return { arg, payload }
    })

    const handler = handlers.get('settings:get')
    expect(handler).toBeDefined()
    const result = (await handler?.({}, 'input')) as { arg: unknown; payload: unknown }
    // 返回值透传：同一引用，不做任何包装/克隆。
    expect(result.payload).toBe(payload)
    expect(result.arg).toBe('input')
    expect(stats.snapshot()).toEqual([
      { channel: 'settings:get', count: 1, totalMs: 7, maxMs: 7, errors: 0 }
    ])
  })

  it('records failures and rethrows the original error (semantics preserved)', async () => {
    const { mock, handlers } = makeMockIpcMain()
    const stats = createIpcStats()
    let clock = 0
    const wrapped = wrapIpcMainWithStats(mock, stats, { now: () => clock })

    const boom = new Error('Invalid payload for settings:set: Bad request.')
    wrapped.handle('settings:set', () => {
      clock += 3
      throw boom
    })

    const handler = handlers.get('settings:set')
    // 异常必须原样透传（同一 Error 实例），renderer 侧错误消息不变。
    await expect(handler?.({}, {})).rejects.toBe(boom)
    expect(stats.snapshot()).toEqual([
      { channel: 'settings:set', count: 1, totalMs: 3, maxMs: 3, errors: 1 }
    ])
  })

  it('forwards handler arguments (event + payload) untouched', async () => {
    const { mock, handlers } = makeMockIpcMain()
    const wrapped = wrapIpcMainWithStats(mock, createIpcStats(), { now: () => 0 })

    const seen: unknown[] = []
    wrapped.handle('echo', (event, ...args: unknown[]) => {
      seen.push(event, ...args)
      return args.length
    })

    const event = { sender: 'wc' }
    const first = { a: 1 }
    const result = await handlers.get('echo')?.(event, first, 'second')
    expect(result).toBe(2)
    expect(seen[0]).toBe(event)
    expect(seen[1]).toBe(first)
    expect(seen[2]).toBe('second')
  })

  it('forwards non-handle members (methods bound to the original, plain props as-is)', () => {
    const { mock, on, removeHandler } = makeMockIpcMain()
    const wrapped = wrapIpcMainWithStats(mock, createIpcStats())

    const listener = (): void => {}
    wrapped.on('perf:renderer-marks', listener)
    expect(on).toHaveBeenCalledWith('perf:renderer-marks', listener)

    wrapped.removeHandler('settings:get')
    expect(removeHandler).toHaveBeenCalledWith('settings:get')

    expect((wrapped as unknown as { marker: string }).marker).toBe('original-ipc-main')
  })

  it('supports sync handlers returning plain values', async () => {
    const { mock, handlers } = makeMockIpcMain()
    const wrapped = wrapIpcMainWithStats(mock, createIpcStats(), { now: () => 0 })
    wrapped.handle('app:version', () => '1.2.3')
    await expect(handlers.get('app:version')?.({})).resolves.toBe('1.2.3')
  })
})

describe('getSharedIpcStats', () => {
  it('returns the same singleton on every call', () => {
    const first = getSharedIpcStats()
    expect(getSharedIpcStats()).toBe(first)
  })
})
