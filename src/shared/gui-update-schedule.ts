// 启动自动检查语义：每次进程启动后固定延迟 4 秒自动检查一次更新（落在
// 需求的 3-5 秒区间内，避开主窗口启动高峰、不阻塞首屏），此后本进程
// 生命周期内不再自动检查；设置页手动「检查更新」不受此限制。
// 取代旧的「跨启动 24h 节流 + 首查零延迟」语义（不再持久化 lastCheckedAt）。
export const GUI_UPDATE_STARTUP_CHECK_DELAY_MS = 4_000

/**
 * 计算下一次自动检查的延迟。
 *
 * @param startupCheckDone 本进程是否已执行过启动自动检查
 * @returns 首次返回固定 4000ms；已检查过返回 null（本进程不再自动调度）
 */
export function nextGuiUpdateCheckDelay(startupCheckDone: boolean): number | null {
  return startupCheckDone ? null : GUI_UPDATE_STARTUP_CHECK_DELAY_MS
}
