// 预挂缓存 + 订阅重放的 main→renderer 单向通道（07-14-windows-native-polish）。
//
// 问题：main 侧随窗口加载即推送的事件（冷启动 workspace:open-request 在
// did-finish-load 发出、window:material-applied 随每次页面加载发出、restore
// maximize 的 window:maximized-changed 在 ready-to-show 附近发出），而 renderer
// 的订阅要等 React mount + boot() 的多个 await 之后才注册（startup-sequence.md：
// 首个 invoke ≥~900ms，晚于 did-finish-load ~570ms）——先发后订，事件必丢。
//
// 方案：preload 求值先于页面加载（必然早于 did-finish-load），在工厂创建时就挂
// 一只常驻监听缓存最近载荷；消费者订阅时先重放缓存再收后续事件。
// - 'latest'：状态同步语义（maximized / material），重订阅也能拿到当前值；
// - 'once'：命令语义（workspace open），重放一次后清空，重订阅不重复执行。

export type ReplayedChannelIpc = {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
}

export type ReplayMode = 'latest' | 'once'

export function createReplayedChannelSubscriber<Payload>(
  ipc: ReplayedChannelIpc,
  channel: string,
  mode: ReplayMode
): (handler: (payload: Payload) => void) => () => void {
  let buffered: { payload: Payload } | null = null
  // 常驻缓存监听：与消费者订阅共存（注册序保证缓存先更新，消费者随后收到）。
  ipc.on(channel, (_event, payload) => {
    buffered = { payload: payload as Payload }
  })
  return (handler) => {
    const wrapped = (_event: unknown, payload: unknown): void => {
      handler(payload as Payload)
    }
    ipc.on(channel, wrapped)
    if (buffered) {
      const { payload } = buffered
      if (mode === 'once') buffered = null
      handler(payload)
    }
    return () => {
      ipc.removeListener(channel, wrapped)
    }
  }
}
