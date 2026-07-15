// 标题栏最大化状态绑定（07-14-windows-native-polish R6）：
// 优先订阅 main 侧 maximize/unmaximize 事件（window:maximized-changed，事件驱动、
// 权威）；订阅 API 不可用（旧 preload / 测试环境）时回退到原启发式 + resize 监听。
// 两种模式下初始值都先用启发式估一次——main 事件只在状态变化时推送。

export type MaximizedHeuristicWindow = {
  outerWidth: number
  outerHeight: number
  screen: { availWidth: number; availHeight: number }
  addEventListener: (type: 'resize', listener: () => void) => void
  removeEventListener: (type: 'resize', listener: () => void) => void
}

/**
 * 启发式：Electron 里 win.maximize() 后 outerWidth/outerHeight 会填满
 * screen.availWidth/availHeight。仅作初始值与降级路径。
 */
export function estimateMaximizedHeuristically(win: MaximizedHeuristicWindow): boolean {
  return win.outerWidth >= win.screen.availWidth && win.outerHeight >= win.screen.availHeight
}

export function bindWindowMaximizedState(options: {
  windowLike: MaximizedHeuristicWindow
  setMaximized: (maximized: boolean) => void
  /** window.kunGui.onWindowMaximizedChanged（可能不存在）。 */
  subscribe?: (handler: (payload: { maximized: boolean }) => void) => () => void
}): () => void {
  const { windowLike, setMaximized, subscribe } = options
  setMaximized(estimateMaximizedHeuristically(windowLike))
  if (typeof subscribe === 'function') {
    return subscribe(({ maximized }) => setMaximized(maximized))
  }
  const onResize = (): void => setMaximized(estimateMaximizedHeuristically(windowLike))
  windowLike.addEventListener('resize', onResize)
  return () => windowLike.removeEventListener('resize', onResize)
}
