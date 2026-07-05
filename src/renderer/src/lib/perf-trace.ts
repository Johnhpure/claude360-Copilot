/**
 * 分阶段性能打点：诊断「回车 → 首个流事件」链路各阶段耗时（07-05 首次对话慢排查）。
 *
 * 输出格式统一为 `[perf:<scope>] <stage> +<delta>ms (total <total>ms)`，
 * 便于控制台按前缀过滤。纯计时工具，无状态副作用；时钟经 deps 注入可单测。
 */
export type PerfTrace = {
  /** 打一个阶段点：输出距上一阶段的增量与距 trace 创建的总耗时。 */
  mark: (stage: string) => void
  /** 结束打点：输出总耗时；之后再 mark 为 no-op（防止迟到回调重复刷屏）。 */
  done: (stage?: string) => void
}

export type PerfTraceDeps = {
  now?: () => number
  log?: (message: string) => void
}

export function createPerfTrace(scope: string, deps: PerfTraceDeps = {}): PerfTrace {
  const now = deps.now ?? (() => performance.now())
  const log = deps.log ?? ((message: string) => console.info(message))
  const startedAt = now()
  let lastAt = startedAt
  let finished = false
  const emit = (stage: string): void => {
    const at = now()
    const delta = Math.round(at - lastAt)
    const total = Math.round(at - startedAt)
    lastAt = at
    log(`[perf:${scope}] ${stage} +${delta}ms (total ${total}ms)`)
  }
  return {
    mark: (stage) => {
      if (finished) return
      emit(stage)
    },
    done: (stage = 'done') => {
      if (finished) return
      emit(stage)
      finished = true
    }
  }
}
