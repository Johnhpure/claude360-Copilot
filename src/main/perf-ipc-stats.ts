/**
 * IPC 调用统计（07-14-perf-baseline R12/AC4）。
 *
 * createIpcStats：Map 按通道聚合 count/totalMs/maxMs/errors，record 为 O(1)
 * 累加；排序只在 snapshot(topN) 输出时发生，热路径零排序零 I/O。
 *
 * wrapIpcMainWithStats：Proxy 包装 ipcMain —— 仅拦截 handle 给 handler 加
 * 计时（返回值透传、异常记录后原样 rethrow），on/removeHandler 等其余成员
 * 直接转发到原对象，invoke 语义零变化。registerAppIpcHandlers 在模块内局部
 * 包装（该文件直接 import electron 的 ipcMain），注入式的 registerRuntimeSseIpc
 * / registerClaude360ChatStreamIpc / registerTerminalPtyIpc 由 index.ts 传入
 * 包装对象；两处共享 getSharedIpcStats() 单例，覆盖全部 handle 通道。
 *
 * 输出节奏由 index.ts 控制（dev 每 60s console top10 / before-quit 一条
 * logInfo 快照），本模块自身不做任何日志或磁盘 I/O。
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

export interface IpcChannelStats {
  channel: string
  count: number
  totalMs: number
  maxMs: number
  errors: number
}

export interface IpcStats {
  /** O(1)：累加一次调用耗时；failed=true 时 errors 计数 +1。 */
  record(channel: string, durationMs: number, failed: boolean): void
  /** 按 totalMs 降序输出前 topN 条（缺省全部）。排序仅发生在输出时。 */
  snapshot(topN?: number): IpcChannelStats[]
  reset(): void
}

type ChannelTotals = { count: number; totalMs: number; maxMs: number; errors: number }

export function createIpcStats(): IpcStats {
  const byChannel = new Map<string, ChannelTotals>()
  return {
    record(channel, durationMs, failed) {
      let entry = byChannel.get(channel)
      if (!entry) {
        entry = { count: 0, totalMs: 0, maxMs: 0, errors: 0 }
        byChannel.set(channel, entry)
      }
      entry.count += 1
      entry.totalMs += durationMs
      if (durationMs > entry.maxMs) entry.maxMs = durationMs
      if (failed) entry.errors += 1
    },
    snapshot(topN) {
      const rows: IpcChannelStats[] = []
      for (const [channel, entry] of byChannel) {
        rows.push({
          channel,
          count: entry.count,
          totalMs: Math.round(entry.totalMs),
          maxMs: Math.round(entry.maxMs),
          errors: entry.errors
        })
      }
      rows.sort((a, b) => b.totalMs - a.totalMs)
      return typeof topN === 'number' ? rows.slice(0, Math.max(0, topN)) : rows
    },
    reset() {
      byChannel.clear()
    }
  }
}

type IpcInvokeListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * 包装 ipcMain：handle 注册的 handler 换成计时版。异常记录（errors +1）后原样
 * rethrow —— Electron invoke 的错误回传语义不变；返回值原样透传。其余属性 /
 * 方法经 Proxy 转发到原对象（函数绑定原对象 this）。
 */
export function wrapIpcMainWithStats(
  ipcMain: IpcMain,
  stats: IpcStats,
  deps: { now?: () => number } = {}
): IpcMain {
  const now = deps.now ?? ((): number => Date.now())
  const wrappedHandle = (channel: string, listener: IpcInvokeListener): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const startedAt = now()
      try {
        const result = await listener(event, ...args)
        stats.record(channel, now() - startedAt, false)
        return result
      } catch (error) {
        stats.record(channel, now() - startedAt, true)
        throw error
      }
    })
  }
  return new Proxy(ipcMain, {
    get(target, prop) {
      if (prop === 'handle') return wrappedHandle
      const value = Reflect.get(target, prop) as unknown
      if (typeof value === 'function') {
        return (value as (...fnArgs: unknown[]) => unknown).bind(target)
      }
      return value
    }
  })
}

/** 进程级共享统计单例：局部包装（register-app-ipc-handlers）与注入式包装（index.ts）共用。 */
let sharedIpcStats: IpcStats | null = null

export function getSharedIpcStats(): IpcStats {
  if (!sharedIpcStats) sharedIpcStats = createIpcStats()
  return sharedIpcStats
}
