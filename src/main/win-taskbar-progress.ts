import type { BrowserWindow } from 'electron'
import type { GuiUpdateState } from '../shared/gui-update'

// 任务栏更新下载进度（07-14-windows-native-polish R3）：gui-updater 的
// download-progress percent → win.setProgressBar。win32 门控内部化：其他平台
// 完全 no-op（不触碰窗口对象）。接线点在 gui-updater.emitGuiUpdateState ——
// 所有更新状态（含 downloading/downloaded/error）都流经那里。

export type TaskbarProgressWindow = Pick<BrowserWindow, 'setProgressBar' | 'isDestroyed'>

/**
 * 按更新状态驱动任务栏进度：
 * - downloading → percent/100（0-1，mode normal）；percent 异常时退 indeterminate（>1）；
 * - 其余一切状态（downloaded / error / idle / checking / …）→ 清除（-1, mode none）。
 */
export function applyUpdateTaskbarProgress(
  win: TaskbarProgressWindow | null,
  state: GuiUpdateState,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return
  // 防御：调用方（gui-updater 测试等）可能传入无 setProgressBar 的窗口替身。
  if (!win || typeof win.setProgressBar !== 'function' || win.isDestroyed()) return
  if (state.status === 'downloading') {
    const percent = state.progress?.percent
    if (typeof percent === 'number' && Number.isFinite(percent)) {
      win.setProgressBar(Math.min(Math.max(percent / 100, 0), 1), { mode: 'normal' })
    } else {
      // d.ts：progress > 1 → indeterminate（research/electron34-api.md §3）。
      win.setProgressBar(2, { mode: 'indeterminate' })
    }
    return
  }
  win.setProgressBar(-1, { mode: 'none' })
}
