/**
 * renderer 启动性能标记（07-14-perf-baseline）。
 *
 * 三个标记：module-eval（入口模块求值）/ first-frame（AppShell 挂载后双 rAF，
 * 首帧真正绘制）/ interactive（boot() resolve，首屏可操作）。全部换算为
 * epoch ms（performance.timeOrigin + performance.now()），连同 preload 首末
 * 时间戳与 navigation/resource timing 摘要，经 window.kunGui.reportPerfMarks
 * 一次性上报 main（fire-and-forget，失败静默，绝不影响启动）。
 *
 * 纯函数部分（摘要提取 / payload 组装）无 DOM 依赖，单测覆盖。
 */
import type { RendererStartupMarks } from '@shared/perf-baseline'

/** interactive 迟迟不来（boot 失败/卡死）时的兜底上报延时；小于 main 侧 60s
 * finalize 兜底，保证 partial 汇总里仍有 module-eval/first-frame 可用（AC2）。 */
const STARTUP_PERF_REPORT_FALLBACK_MS = 45_000

// ---------------------------------------------------------------------------
// 纯函数：timing 摘要与 payload 组装（可单测）
// ---------------------------------------------------------------------------

export interface NavTimingLike {
  domContentLoadedEventEnd: number
  loadEventEnd: number
}

export interface ResourceTimingLike {
  name: string
  initiatorType: string
  duration: number
}

/** navigation timing 关键分段（R7）；条目缺失或全 0（尚未触发 load）时返回 undefined。 */
export function extractNavTiming(
  entries: readonly NavTimingLike[]
): RendererStartupMarks['navTiming'] {
  const nav = entries[0]
  if (!nav) return undefined
  const domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd)
  const loadEventEndMs = Math.round(nav.loadEventEnd)
  if (domContentLoadedMs <= 0 && loadEventEndMs <= 0) return undefined
  return { domContentLoadedMs, loadEventEndMs }
}

/** 资源 URL 太长会污染日志：只保留最后一段路径。 */
export function shortenResourceName(name: string): string {
  const withoutQuery = name.split(/[?#]/, 1)[0] ?? name
  const lastSegment = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1)
  return (lastSegment || withoutQuery).slice(0, 128)
}

/** script 资源加载摘要（R7 bundle 加载阶段耗时）；无 script 资源时返回 undefined。 */
export function summarizeScriptResources(
  entries: readonly ResourceTimingLike[]
): RendererStartupMarks['scriptResources'] {
  const scripts = entries.filter(
    (entry) => entry.initiatorType === 'script' || /\.m?js($|[?#])/.test(entry.name)
  )
  if (scripts.length === 0) return undefined
  let totalDurationMs = 0
  let maxDurationMs = 0
  let maxName = ''
  for (const script of scripts) {
    const duration = Number.isFinite(script.duration) ? Math.max(0, script.duration) : 0
    totalDurationMs += duration
    if (duration >= maxDurationMs) {
      maxDurationMs = duration
      maxName = script.name
    }
  }
  return {
    count: scripts.length,
    totalDurationMs: Math.round(totalDurationMs),
    maxDurationMs: Math.round(maxDurationMs),
    maxName: shortenResourceName(maxName)
  }
}

/** 组装上报 payload：epoch 标记 + preload 首末 + timing 摘要（存在才带字段）。 */
export function buildRendererStartupMarks(input: {
  epochMarks: RendererStartupMarks['epochMarks']
  preload: RendererStartupMarks['preload']
  navEntries?: readonly NavTimingLike[]
  resourceEntries?: readonly ResourceTimingLike[]
}): RendererStartupMarks {
  const payload: RendererStartupMarks = {
    epochMarks: { ...input.epochMarks },
    preload: { ...input.preload }
  }
  const navTiming = extractNavTiming(input.navEntries ?? [])
  if (navTiming) payload.navTiming = navTiming
  const scriptResources = summarizeScriptResources(input.resourceEntries ?? [])
  if (scriptResources) payload.scriptResources = scriptResources
  return payload
}

// ---------------------------------------------------------------------------
// 模块状态：标记采集与一次性上报（浏览器环境）
// ---------------------------------------------------------------------------

const epochMarks: RendererStartupMarks['epochMarks'] = {}
let reported = false
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

function nowEpochMs(): number {
  return performance.timeOrigin + performance.now()
}

/** 入口模块求值标记（main.tsx 顶层调用一次）。幂等。 */
export function markStartupModuleEval(): void {
  if (epochMarks['module-eval'] === undefined) epochMarks['module-eval'] = nowEpochMs()
}

/** 首帧标记。幂等（StrictMode 双挂载 / 双 rAF 竞争安全）。 */
export function markStartupFirstFrame(): void {
  if (epochMarks['first-frame'] === undefined) epochMarks['first-frame'] = nowEpochMs()
}

/** 可交互标记（boot() resolve 后调用），随即触发一次性上报。幂等。 */
export function markStartupInteractive(): void {
  if (epochMarks.interactive === undefined) epochMarks.interactive = nowEpochMs()
  reportStartupPerfOnce()
}

/**
 * 双 rAF 后打首帧标记（挂载 → 下一帧提交 → 再下一帧回调 ≈ 首帧已绘制）。
 * 返回取消函数，可直接作 useEffect cleanup。
 */
export function markStartupFirstFrameAfterPaint(): () => void {
  let secondFrame = 0
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => {
      markStartupFirstFrame()
    })
  })
  return () => {
    window.cancelAnimationFrame(firstFrame)
    if (secondFrame) window.cancelAnimationFrame(secondFrame)
  }
}

/** interactive 长时间不出现时也上报一次已有标记（main.tsx 顶层安装）。 */
export function installStartupPerfFallbackReport(): void {
  if (reported || fallbackTimer !== null) return
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null
    reportStartupPerfOnce()
  }, STARTUP_PERF_REPORT_FALLBACK_MS)
}

/** 一次性上报（幂等）；preload 桥缺失或发送异常一律静默。 */
export function reportStartupPerfOnce(): void {
  if (reported) return
  reported = true
  if (fallbackTimer !== null) {
    clearTimeout(fallbackTimer)
    fallbackTimer = null
  }
  try {
    const bridge = window.kunGui
    if (!bridge || typeof bridge.reportPerfMarks !== 'function') return
    const payload = buildRendererStartupMarks({
      epochMarks,
      preload: bridge.perfPreloadTimestamps ?? { startedAtEpochMs: 0, readyAtEpochMs: 0 },
      navEntries: performance.getEntriesByType(
        'navigation'
      ) as unknown as readonly NavTimingLike[],
      resourceEntries: performance.getEntriesByType(
        'resource'
      ) as unknown as readonly ResourceTimingLike[]
    })
    bridge.reportPerfMarks(payload)
  } catch {
    // 埋点失败静默：绝不把启动性能采集变成启动故障。
  }
}
