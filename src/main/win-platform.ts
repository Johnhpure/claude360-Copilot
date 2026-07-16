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
 *
 * color/symbolColor 与 renderer 标题栏（base-shell.css `.ds-windows-titlebar`
 * 浅/深色渐变的中间值）对齐，避免深色主题下原生按钮区呈现突兀白块；主题
 * 切换时由 {@link applyWindowControlsOverlayTheme} 对已存在窗口重新应用。
 */
export const WINDOW_CONTROLS_OVERLAY_HEIGHT = 40

export type WindowControlsOverlayColors = { color: string; symbolColor: string }

/** 浅色主题：标题栏渐变 rgba(255,255,255,.8)→rgba(246,248,251,.72) 叠加 #eef2f9 的中值。 */
export const WINDOW_CONTROLS_OVERLAY_LIGHT: WindowControlsOverlayColors = {
  color: '#f8f9fc',
  symbolColor: '#3d4351'
}

/** 深色主题：标题栏渐变 rgba(17,17,19,.92)→rgba(10,10,12,.82) 叠加 #10131a 的中值。 */
export const WINDOW_CONTROLS_OVERLAY_DARK: WindowControlsOverlayColors = {
  color: '#0e0f12',
  symbolColor: '#e8eaf0'
}

export function windowControlsOverlayColors(prefersDark: boolean): WindowControlsOverlayColors {
  return prefersDark ? WINDOW_CONTROLS_OVERLAY_DARK : WINDOW_CONTROLS_OVERLAY_LIGHT
}

export function resolveWindowControlsOverlay(
  platform: NodeJS.Platform = process.platform,
  prefersDark = false
): Electron.TitleBarOverlay | false {
  if (platform !== 'win32') return false
  return {
    height: WINDOW_CONTROLS_OVERLAY_HEIGHT,
    ...windowControlsOverlayColors(prefersDark)
  }
}

export type WindowControlsOverlayTarget = Pick<BrowserWindow, 'setTitleBarOverlay' | 'isDestroyed'>

/**
 * 主题变化时对已存在窗口重应用 overlay 颜色。任何失败仅记录并静默返回——
 * overlay 颜色属于观感增强，绝不影响窗口可用性；非 win32 零 API 调用。
 */
export function applyWindowControlsOverlayTheme(
  win: WindowControlsOverlayTarget | null,
  prefersDark: boolean,
  options: {
    platform?: NodeJS.Platform
    log?: (message: string, detail?: unknown) => void
  } = {}
): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return
  if (!win || win.isDestroyed()) return
  const log = options.log ?? ((message, detail) => logWarn('win-platform', message, detail))
  try {
    win.setTitleBarOverlay({
      height: WINDOW_CONTROLS_OVERLAY_HEIGHT,
      ...windowControlsOverlayColors(prefersDark)
    })
  } catch (error) {
    log('Failed to apply themed window controls overlay.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
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
