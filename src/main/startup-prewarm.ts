/**
 * kun 运行时预热触发器（07-14-startup-optimization R4）。
 *
 * 取代固定 setTimeout(1500) 预热：窗口 ready-to-show（首帧优先）后经
 * setImmediate 发起预热，让首帧渲染先占用当前事件循环；另设 unref 兜底
 * 定时器覆盖 ready-to-show 不触发的场景（隐藏启动 / renderer 加载异常）。
 * 两路共享 fired 标志幂等，只发起一次；与 renderer +900ms 探活的并发由
 * ensureRuntime 的 in-flight + fingerprint 去重保证不双 spawn（research/07）。
 */
export type PrewarmTrigger = {
  /** 立即发起预热（幂等，重复调用无效果）。 */
  fire: () => void
  hasFired: () => boolean
}

export function createPrewarmTrigger(options: {
  prewarm: () => void
  /** 注入 ready-to-show 一次性监听（生产侧为 mainWindow.once('ready-to-show', ...)）。 */
  registerReadyToShow: (listener: () => void) => void
  fallbackMs: number
}): PrewarmTrigger {
  let fired = false
  const fire = (): void => {
    if (fired) return
    fired = true
    options.prewarm()
  }
  options.registerReadyToShow(() => {
    // ready-to-show 的同步回调里只排队不做事，避免与首帧展示争抢当前 tick。
    setImmediate(fire)
  })
  const fallbackTimer = setTimeout(fire, options.fallbackMs)
  fallbackTimer.unref()
  return { fire, hasFired: () => fired }
}
