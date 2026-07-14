/**
 * 常驻内存低频采样（07-14-perf-baseline R14）。
 *
 * 定时把 main 进程 RSS + Electron 各子进程（app.getAppMetrics：renderer/GPU/
 * utility…）的 workingSet 聚合成一行，交给注入的 log sink（index.ts 接
 * logInfo('perf-memory', …) 落盘）。kun 子进程是独立 node 进程、不在
 * getAppMetrics 内，其内存经 kun 的 GET /v1/runtime/info 按需查询，不在此拉取。
 *
 * 节奏：首采延迟 initialDelayMs（避开启动窗口），随后按 intervalMs 周期采样
 * （dev 5min / prod 15min，由 index.ts 决定）；两个定时器均 unref，不阻止进程
 * 退出。getMetrics / log 抛错只 console.warn，绝不让采样影响运行。
 */

export interface MemoryProcessSample {
  type: string
  pid: number
  /** Electron ProcessMetric.memory.workingSetSize（单位 KB）。 */
  workingSetKb: number
}

export interface MemorySampleSnapshot {
  mainRssBytes: number
  processes: MemoryProcessSample[]
}

export interface MemorySamplerDeps {
  intervalMs: number
  /** 首采延迟，默认 60s。 */
  initialDelayMs?: number
  log: (message: string) => void
  getMetrics: () => MemorySampleSnapshot
}

export interface MemorySampler {
  stop(): void
}

export const DEFAULT_MEMORY_SAMPLER_INITIAL_DELAY_MS = 60_000

export function startMemorySampler(deps: MemorySamplerDeps): MemorySampler {
  const initialDelayMs = deps.initialDelayMs ?? DEFAULT_MEMORY_SAMPLER_INITIAL_DELAY_MS
  let intervalTimer: NodeJS.Timeout | null = null
  let stopped = false

  const sample = (): void => {
    if (stopped) return
    try {
      deps.log(`memory sample ${JSON.stringify(deps.getMetrics())}`)
    } catch (error) {
      console.warn(
        '[perf-memory] sample failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  const initialTimer = setTimeout(() => {
    sample()
    if (stopped) return
    intervalTimer = setInterval(sample, deps.intervalMs)
    intervalTimer.unref()
  }, initialDelayMs)
  initialTimer.unref()

  return {
    stop() {
      stopped = true
      clearTimeout(initialTimer)
      if (intervalTimer) {
        clearInterval(intervalTimer)
        intervalTimer = null
      }
    }
  }
}
