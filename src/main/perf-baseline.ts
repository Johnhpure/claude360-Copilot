/**
 * 启动性能基线采集器（07-14-perf-baseline）。
 *
 * 纯逻辑模块：时钟 / 日志 / 落盘全部依赖注入（仓库测试惯例），挂点只做 O(1)
 * 时间戳记录；磁盘 I/O 仅发生在 finalize 时一次（logInfo 一行 + 历史文件
 * 原子追加），不阻塞任何启动路径（R15-R17）。
 *
 * finalize 触发：
 * - renderer:interactive 与 kun:health-ok 均到达 → 立即（complete）
 * - 60s 定时器 / before-quit 兜底 → partial: true + missing 列表（AC2/R20）
 * 三者幂等，只有第一次生效。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  STARTUP_PHASE_NAMES,
  type RendererStartupMarks,
  type StartupBaselineRecord,
  type StartupPhaseName
} from '../shared/perf-baseline'

export interface StartupEnvironmentInfo {
  appVersion: string
  updateChannel: string
  platform: string
  arch: string
  packaged: boolean
}

export type StartupFinalizeReason = 'complete' | 'timeout' | 'quit'

export interface StartupMetricsDeps {
  /** main T0：index.ts 模块求值时刻的 epoch ms（与 traceStartup 同基准）。 */
  t0EpochMs: number
  /** T0 相对进程真实创建时刻的偏移 ms（Math.round(process.uptime()*1000)，R1）。 */
  processStartOffsetMs: number
  /**
   * finalize 时读取环境字段（R18）。updateChannel 要等设置加载后才可用，
   * 因此用回调延迟读取而不是创建时快照。
   */
  getEnvironment: () => StartupEnvironmentInfo
  /** dev（!app.isPackaged）下输出逐阶段过程日志与汇总阶段表（R16）。 */
  isDev: boolean
  /** epoch ms 时钟，默认 Date.now（测试注入）。 */
  now?: () => number
  /** 汇总落盘 sink（index.ts 接 logInfo('perf-baseline', …)）。 */
  log?: (message: string) => void
  /** 历史文件追加（index.ts 接 appendStartupHistory）；失败不抛出。 */
  persist?: (record: StartupBaselineRecord) => Promise<void>
  /** dev 过程输出 sink，默认 console.info（测试注入避免刷屏）。 */
  devLog?: (message: string) => void
}

export interface StartupMetrics {
  /**
   * 记录一个阶段（O(1)）。幂等：重复 mark 忽略后到者。
   * epochMs 缺省取 now()；renderer 换算来的标记显式传 epoch。
   */
  mark(phase: StartupPhaseName, epochMs?: number): void
  /** 并入 renderer 上报的标记（epoch → 相对 T0 换算），随后尝试 finalize。 */
  attachRendererMarks(payload: RendererStartupMarks): void
  /** renderer:interactive 与 kun:health-ok 齐 → finalize（complete）。 */
  maybeFinalize(): void
  /** 兜底 finalize（60s 定时器 / before-quit），partial: true。幂等。 */
  finalizeNow(reason: 'timeout' | 'quit'): void
  isFinalized(): boolean
  /** 当前阶段快照（测试/调试用）。 */
  snapshotPhases(): Partial<Record<StartupPhaseName, number>>
}

const RENDERER_MARK_TO_PHASE: Record<
  keyof RendererStartupMarks['epochMarks'],
  StartupPhaseName
> = {
  'module-eval': 'renderer:module-eval',
  'first-frame': 'renderer:first-frame',
  interactive: 'renderer:interactive'
}

export function createStartupMetrics(deps: StartupMetricsDeps): StartupMetrics {
  const now = deps.now ?? ((): number => Date.now())
  const log = deps.log ?? ((): void => {})
  const devLog = deps.devLog ?? ((message: string): void => console.info(message))
  const phases: Partial<Record<StartupPhaseName, number>> = {}
  let preload: StartupBaselineRecord['preload']
  let navTiming: StartupBaselineRecord['navTiming']
  let scriptResources: StartupBaselineRecord['scriptResources']
  let finalized = false

  const toOffsetMs = (epochMs: number): number => Math.max(0, Math.round(epochMs - deps.t0EpochMs))

  // 记录但不触发 finalize（attachRendererMarks 批量并入后统一触发一次）。
  const record = (phase: StartupPhaseName, epochMs?: number): void => {
    if (phases[phase] !== undefined) return
    const offset = toOffsetMs(epochMs ?? now())
    phases[phase] = offset
    if (deps.isDev && !finalized) devLog(`[perf-baseline] ${phase} +${offset}ms`)
  }

  const safeEnvironment = (): StartupEnvironmentInfo => {
    try {
      return deps.getEnvironment()
    } catch {
      return { appVersion: '', updateChannel: '', platform: '', arch: '', packaged: false }
    }
  }

  const finalize = (reason: StartupFinalizeReason): void => {
    if (finalized) return
    finalized = true
    const env = safeEnvironment()
    const missing = STARTUP_PHASE_NAMES.filter((phase) => phases[phase] === undefined)
    const startupRecord: StartupBaselineRecord = {
      at: new Date(now()).toISOString(),
      appVersion: env.appVersion,
      updateChannel: env.updateChannel,
      platform: env.platform,
      arch: env.arch,
      packaged: env.packaged,
      processStartOffsetMs: deps.processStartOffsetMs,
      phases: { ...phases },
      ...(preload ? { preload } : {}),
      ...(navTiming ? { navTiming } : {}),
      ...(scriptResources ? { scriptResources } : {}),
      partial: reason !== 'complete',
      missing
    }
    // 生产环境唯一的启动指标日志：一条汇总（logger 侧带脱敏与按天文件）。
    log(`startup summary (${reason}) ${JSON.stringify(startupRecord)}`)
    if (deps.persist) {
      void deps.persist(startupRecord).catch((error: unknown) => {
        console.warn(
          '[perf-baseline] failed to persist startup history:',
          error instanceof Error ? error.message : String(error)
        )
      })
    }
    if (deps.isDev) {
      const header =
        `[perf-baseline] startup summary (${reason}) ` +
        `${env.platform}/${env.arch} v${env.appVersion} channel=${env.updateChannel || 'unknown'} ` +
        `processStartOffset=${deps.processStartOffsetMs}ms`
      devLog(header)
      const rows = (Object.entries(phases) as Array<[StartupPhaseName, number]>).sort(
        (a, b) => a[1] - b[1]
      )
      for (const [phase, offset] of rows) {
        devLog(`[perf-baseline]   ${String(offset).padStart(7)}ms  ${phase}`)
      }
      if (missing.length > 0) {
        devLog(`[perf-baseline]   missing: ${missing.join(', ')}`)
      }
    }
  }

  const maybeFinalize = (): void => {
    if (finalized) return
    if (phases['renderer:interactive'] !== undefined && phases['kun:health-ok'] !== undefined) {
      finalize('complete')
    }
  }

  return {
    mark(phase, epochMs) {
      record(phase, epochMs)
      maybeFinalize()
    },
    attachRendererMarks(payload) {
      for (const [markName, phase] of Object.entries(RENDERER_MARK_TO_PHASE) as Array<
        [keyof RendererStartupMarks['epochMarks'], StartupPhaseName]
      >) {
        const epochMs = payload.epochMarks[markName]
        if (typeof epochMs === 'number' && Number.isFinite(epochMs) && epochMs > 0) {
          record(phase, epochMs)
        }
      }
      if (
        !preload &&
        Number.isFinite(payload.preload.startedAtEpochMs) &&
        Number.isFinite(payload.preload.readyAtEpochMs) &&
        payload.preload.startedAtEpochMs > 0
      ) {
        const startOffsetMs = toOffsetMs(payload.preload.startedAtEpochMs)
        const readyOffsetMs = toOffsetMs(payload.preload.readyAtEpochMs)
        preload = {
          startOffsetMs,
          readyOffsetMs,
          durationMs: Math.max(0, readyOffsetMs - startOffsetMs)
        }
      }
      if (!navTiming && payload.navTiming) navTiming = { ...payload.navTiming }
      if (!scriptResources && payload.scriptResources) {
        scriptResources = { ...payload.scriptResources }
      }
      maybeFinalize()
    },
    maybeFinalize,
    finalizeNow(reason) {
      finalize(reason)
    },
    isFinalized() {
      return finalized
    },
    snapshotPhases() {
      return { ...phases }
    }
  }
}

// ---------------------------------------------------------------------------
// JSON 历史文件通用工具（启动基线 / kun 崩溃记录共用）
// ---------------------------------------------------------------------------

/** 读取 JSON 数组历史；文件不存在 / JSON 损坏 / 非数组一律回退空数组。 */
async function readJsonObjectArray<T extends object>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is T => typeof entry === 'object' && entry !== null)
  } catch {
    return []
  }
}

/**
 * 追加一条记录到 JSON 历史文件：保留最近 maxRecords 条，tmp+rename 原子替换，
 * 崩溃/断电不会留下半写状态。调用方保证低频（R17）。
 */
async function appendJsonHistory<T extends object>(
  filePath: string,
  record: T,
  maxRecords: number
): Promise<void> {
  const existing = await readJsonObjectArray<T>(filePath)
  const next = [...existing, record].slice(-maxRecords)
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tmpPath, filePath)
}

/** 历史文件保留条数（R19：最近 N 次启动记录，供优化前后对比）。 */
export const STARTUP_HISTORY_MAX_RECORDS = 20

/** 读取启动历史；文件不存在 / JSON 损坏 / 非数组一律回退空数组。 */
export async function readStartupHistory(filePath: string): Promise<StartupBaselineRecord[]> {
  return readJsonObjectArray<StartupBaselineRecord>(filePath)
}

/**
 * 追加一条启动记录到历史文件（tmp+rename 原子替换，保留最近 maxRecords 条）。
 * 只在 finalize 时调用一次（低频 I/O，R17）。
 */
export async function appendStartupHistory(
  filePath: string,
  record: StartupBaselineRecord,
  options: { maxRecords?: number } = {}
): Promise<void> {
  await appendJsonHistory(filePath, record, options.maxRecords ?? STARTUP_HISTORY_MAX_RECORDS)
}

// ---------------------------------------------------------------------------
// kun 崩溃记录持久化（R11/AC5）
// ---------------------------------------------------------------------------

/** kun 子进程异常退出记录（userData/perf/kun-crash-history.json 单条）。 */
export interface KunCrashRecord {
  /** 崩溃时刻 ISO 时间戳。 */
  at: string
  code: number | null
  signal: string | null
  /** spawn → exit 的存活时长 ms（kun-process 侧随 exit 事件带出）。 */
  uptimeMs: number
  /** 崩溃时刻滑动窗口内已用的重启次数（RestartBudget.peek，只读不记账）。 */
  restartCount: number
  /** true = 重启预算已耗尽，监督器将熔断、不再自动重启。 */
  budgetExhausted: boolean
  /** 本次应用生命周期里 kun 到达的最晚启动阶段（null = spawn 尚未开始）。 */
  phaseReached: StartupPhaseName | null
}

/** 崩溃历史保留条数（R11）。 */
export const KUN_CRASH_HISTORY_MAX_RECORDS = 50

/** 读取崩溃历史；损坏/缺失回退空数组。 */
export async function readKunCrashHistory(filePath: string): Promise<KunCrashRecord[]> {
  return readJsonObjectArray<KunCrashRecord>(filePath)
}

/** 追加一条崩溃记录（tmp+rename 原子替换，保留最近 maxRecords 条）。 */
export async function appendKunCrashHistory(
  filePath: string,
  record: KunCrashRecord,
  options: { maxRecords?: number } = {}
): Promise<void> {
  await appendJsonHistory(filePath, record, options.maxRecords ?? KUN_CRASH_HISTORY_MAX_RECORDS)
}

const KUN_PHASE_ORDER: readonly StartupPhaseName[] = [
  'kun:spawn-start',
  'kun:spawn-done',
  'kun:ready',
  'kun:health-ok'
]

/**
 * 已 mark 的最晚 kun 阶段（崩溃记录 phaseReached；kun 启动失败时可据此定位
 * 卡在 spawn / READY / health 哪一步，R20/AC2）。
 */
export function latestKunPhaseReached(
  phases: Partial<Record<StartupPhaseName, number>>
): StartupPhaseName | null {
  let latest: StartupPhaseName | null = null
  for (const phase of KUN_PHASE_ORDER) {
    if (phases[phase] !== undefined) latest = phase
  }
  return latest
}
