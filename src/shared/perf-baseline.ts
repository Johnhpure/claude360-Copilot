/**
 * 性能与稳定性基线埋点契约（07-14-perf-baseline）。
 *
 * main / preload / renderer 共用的启动阶段名、renderer 上报 payload 与持久化
 * 记录结构。纯类型 + 常量，无任何 node/DOM 运行时依赖（需同时通过
 * tsconfig.web 与 tsconfig.node 编译，故 platform 用 string 而非 NodeJS.Platform）。
 */

/** 启动链路阶段名。时间值一律为相对 main T0（index.ts 模块求值时刻）的毫秒偏移。 */
export type StartupPhaseName =
  | 'main:module-eval'
  | 'main:app-ready'
  | 'main:settings-loaded'
  | 'main:ipc-registered'
  | 'main:window-created'
  | 'main:window-ready-to-show'
  | 'main:window-did-finish-load'
  | 'kun:spawn-start'
  | 'kun:spawn-done'
  | 'kun:ready'
  | 'kun:health-ok'
  | 'renderer:module-eval'
  | 'renderer:first-frame'
  | 'renderer:interactive'

/** 全量阶段清单（finalize 时用于计算 missing 列表，R20/AC2）。 */
export const STARTUP_PHASE_NAMES: readonly StartupPhaseName[] = [
  'main:module-eval',
  'main:app-ready',
  'main:settings-loaded',
  'main:ipc-registered',
  'main:window-created',
  'main:window-ready-to-show',
  'main:window-did-finish-load',
  'kun:spawn-start',
  'kun:spawn-done',
  'kun:ready',
  'kun:health-ok',
  'renderer:module-eval',
  'renderer:first-frame',
  'renderer:interactive'
]

export type RendererStartupMarkName = 'module-eval' | 'first-frame' | 'interactive'

/**
 * renderer → main 一次性上报的启动标记。
 * 时间统一为 epoch ms（performance.timeOrigin + performance.now() 换算），
 * main 侧再转成相对 T0 的偏移，与主进程时间轴同基准可比（AC3）。
 */
export interface RendererStartupMarks {
  epochMarks: Partial<Record<RendererStartupMarkName, number>>
  /** preload 模块求值首/末时刻（R4 preload 初始化耗时）。 */
  preload: { startedAtEpochMs: number; readyAtEpochMs: number }
  /** navigation timing 关键分段（R7），相对 renderer timeOrigin 的 ms。 */
  navTiming?: { domContentLoadedMs: number; loadEventEndMs: number }
  /** script 资源加载摘要（R7 bundle 加载阶段耗时）。 */
  scriptResources?: {
    count: number
    totalDurationMs: number
    maxDurationMs: number
    maxName: string
  }
}

/** 持久化到 userData/perf/startup-history.json 的单条启动基线记录（R19）。 */
export interface StartupBaselineRecord {
  /** finalize 时刻 ISO 时间戳。 */
  at: string
  appVersion: string
  updateChannel: string
  platform: string
  arch: string
  packaged: boolean
  /** T0 相对进程真实创建时刻的偏移 ms（R1 的进程启动修正值）。 */
  processStartOffsetMs: number
  /** 各阶段相对 T0 的毫秒偏移。 */
  phases: Partial<Record<StartupPhaseName, number>>
  /** preload 求值首/末（相对 T0）与耗时（R4）。 */
  preload?: { startOffsetMs: number; readyOffsetMs: number; durationMs: number }
  /** renderer navigation timing 关键分段（R7）。 */
  navTiming?: { domContentLoadedMs: number; loadEventEndMs: number }
  /** renderer script 资源加载摘要（R7）。 */
  scriptResources?: {
    count: number
    totalDurationMs: number
    maxDurationMs: number
    maxName: string
  }
  /** true = 兜底 finalize（超时/退出），部分阶段未到达。 */
  partial: boolean
  /** 未到达的阶段列表（kun 启动失败时可据此定位卡在哪一步，R20）。 */
  missing: StartupPhaseName[]
}

/** renderer → main 启动标记上报通道（ipcRenderer.send 单向）。 */
export const PERF_RENDERER_MARKS_CHANNEL = 'perf:renderer-marks'
