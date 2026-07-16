import { release } from 'node:os'
import type { BrowserWindow } from 'electron'
import { logWarn } from './logger'

// Windows 平台能力检测 + Mica 材质应用（07-14-windows-native-polish R7）。
// 全部 win32 门控内部化：非 win32 下所有函数不触碰任何 Electron API（no-op），
// index.ts 调用点无需重复判断。

/** Mica 需要 Windows 11 22H2（build 22621）及以上。 */
export const WIN11_MICA_MIN_BUILD = 22621

/** `os.release()` 形如 '10.0.22621'，第三段是 build 号；解析失败返回 null。 */
export function parseWindowsBuildNumber(releaseString: string): number | null {
  const build = Number(releaseString.trim().split('.')[2])
  return Number.isInteger(build) && build >= 0 ? build : null
}

export function isWin11MicaCapable(
  platform: NodeJS.Platform = process.platform,
  releaseString: string = release()
): boolean {
  if (platform !== 'win32') return false
  const build = parseWindowsBuildNumber(releaseString)
  return build !== null && build >= WIN11_MICA_MIN_BUILD
}

export type WindowMaterialValue = 'none' | 'mica'

export type WindowMaterialTarget = Pick<BrowserWindow, 'setBackgroundMaterial' | 'isDestroyed'>

/**
 * Windows 使用原生标题栏按钮，确保 renderer 尚未挂载或崩溃时仍可最小化、
 * 最大化和关闭窗口；其他平台保持既有标题栏行为。
 */
export function resolveWindowControlsOverlay(
  platform: NodeJS.Platform = process.platform
): Electron.TitleBarOverlay | false {
  return platform === 'win32' ? { height: 40 } : false
}

/**
 * 按设置应用窗口材质，返回实际生效值。任何失败 / 门槛不满足都静默回退实色
 * （'none'）——实验性能力绝不影响窗口可用性。仅在需要变更时才调用
 * setBackgroundMaterial：非 win32、或「请求 none 且此前也未开」时零 API 调用。
 */
export function applyWindowMaterial(
  win: WindowMaterialTarget | null,
  requested: WindowMaterialValue,
  options: {
    previousApplied?: WindowMaterialValue
    platform?: NodeJS.Platform
    releaseString?: string
    log?: (message: string, detail?: unknown) => void
  } = {}
): WindowMaterialValue {
  const platform = options.platform ?? process.platform
  const log = options.log ?? ((message, detail) => logWarn('win-platform', message, detail))
  if (platform !== 'win32') return 'none'
  if (!win || win.isDestroyed()) return 'none'

  if (requested === 'mica' && isWin11MicaCapable(platform, options.releaseString ?? release())) {
    try {
      win.setBackgroundMaterial('mica')
      return 'mica'
    } catch (error) {
      log('Failed to apply mica window material; falling back to solid.', {
        message: error instanceof Error ? error.message : String(error)
      })
      return 'none'
    }
  }

  // 从 mica 切回 none（或门槛不再满足）时显式恢复实色；否则无需触碰 API。
  if ((options.previousApplied ?? 'none') === 'mica') {
    try {
      win.setBackgroundMaterial('none')
    } catch (error) {
      log('Failed to reset window material to solid.', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return 'none'
}
