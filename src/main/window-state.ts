import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserWindow, Rectangle } from 'electron'

// 窗口状态记忆（07-14-windows-native-polish R1）：bounds + maximized 持久化到
// userData/window-state.json，恢复时对当前显示器做可见性校验（显示器拔除 /
// 分辨率变化时回落默认，防止窗口丢失）。三平台通用，无 win32 门控。

export const DEFAULT_WINDOW_WIDTH = 1280
export const DEFAULT_WINDOW_HEIGHT = 840
export const WINDOW_STATE_FILE_NAME = 'window-state.json'
export const WINDOW_STATE_SAVE_DEBOUNCE_MS = 500

// 窗口原生底色（防深色主题冷启动首帧白闪，R2）。取值来源：renderer
// base-shell.css 的根背景 token `--c360-bg`（浅色 #eef2f9 / 深色 #10131a）。
export const WINDOW_BACKGROUND_LIGHT = '#eef2f9'
export const WINDOW_BACKGROUND_DARK = '#10131a'

export type ThemePreference = 'system' | 'light' | 'dark'

export function resolveWindowBackgroundColor(theme: ThemePreference, prefersDark: boolean): string {
  if (theme === 'dark') return WINDOW_BACKGROUND_DARK
  if (theme === 'light') return WINDOW_BACKGROUND_LIGHT
  return prefersDark ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT
}

export type NativeThemeSourceTarget = { themeSource: 'system' | 'dark' | 'light' }

/** settings.theme 三态与 nativeTheme.themeSource 一一对应（research/electron34-api.md §5）。 */
export function syncNativeThemeSource(theme: ThemePreference, target: NativeThemeSourceTarget): void {
  target.themeSource = theme
}

export type WindowStateV1 = {
  bounds: Rectangle | null
  maximized: boolean
}

export type DisplayLike = { workArea: Rectangle }

export type RestoredWindowBounds = {
  x?: number
  y?: number
  width: number
  height: number
}

export type RestoredWindowState = RestoredWindowBounds & { maximized: boolean }

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 任意旧/损坏数据 → 合法形状（绝不抛出）。 */
export function parseWindowState(raw: unknown): WindowStateV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { bounds: null, maximized: false }
  }
  const record = raw as { bounds?: unknown; maximized?: unknown }
  const maximized = record.maximized === true
  const bounds = record.bounds as Partial<Rectangle> | null | undefined
  if (
    !bounds ||
    typeof bounds !== 'object' ||
    !isFiniteInt(bounds.x) ||
    !isFiniteInt(bounds.y) ||
    !isFiniteInt(bounds.width) ||
    !isFiniteInt(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return { bounds: null, maximized }
  }
  return {
    bounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    },
    maximized
  }
}

/**
 * 把持久化 bounds 夹回当前可见工作区：
 * - 与任一显示器工作区有交集 → 尺寸夹到该工作区内、位置夹回工作区（标题栏必可抓取）；
 * - 完全不可见（显示器移除 / 分辨率变化 / 负坐标漂移）或无 bounds → 返回默认
 *   尺寸且不带 x/y（Electron 默认居中）。
 */
export function clampToVisibleArea(
  bounds: Rectangle | null,
  displays: readonly DisplayLike[],
  defaults: { width: number; height: number } = {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT
  }
): RestoredWindowBounds {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || displays.length === 0) {
    return { ...defaults }
  }
  let best: Rectangle | null = null
  let bestArea = 0
  for (const display of displays) {
    const workArea = display.workArea
    const overlapWidth =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
    const overlapHeight =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y)
    const area = Math.max(0, overlapWidth) * Math.max(0, overlapHeight)
    if (area > bestArea) {
      bestArea = area
      best = workArea
    }
  }
  if (!best) return { ...defaults }
  const width = Math.min(bounds.width, best.width)
  const height = Math.min(bounds.height, best.height)
  const x = Math.min(Math.max(bounds.x, best.x), best.x + best.width - width)
  const y = Math.min(Math.max(bounds.y, best.y), best.y + best.height - height)
  return { x, y, width, height }
}

export type TrackedWindow = Pick<
  BrowserWindow,
  'on' | 'isDestroyed' | 'isMaximized' | 'getNormalBounds'
>

export type WindowStateManager = {
  /** 供 BrowserWindow 构造使用的恢复状态（已做可见性校验）。 */
  getRestoredState(): RestoredWindowState
  /** 挂钩 resize/move/maximize/unmaximize（防抖落盘）与 close（立即落盘）。 */
  attach(win: TrackedWindow): void
  /** 测试 / 收尾用：立刻落盘并等待写完成。 */
  flush(): Promise<void>
}

type WindowStateIo = {
  readFileSync?: (path: string) => string
  writeFile?: (path: string, data: string) => Promise<void>
  mkdir?: (dir: string) => Promise<void>
}

export function createWindowStateManager(options: {
  file: string
  getDisplays: () => readonly DisplayLike[]
  debounceMs?: number
  io?: WindowStateIo
  log?: (message: string, detail?: unknown) => void
}): WindowStateManager {
  const debounceMs = options.debounceMs ?? WINDOW_STATE_SAVE_DEBOUNCE_MS
  const readImpl = options.io?.readFileSync ?? ((path: string) => readFileSync(path, 'utf8'))
  const writeImpl =
    options.io?.writeFile ??
    (async (path: string, data: string) => {
      await writeFile(path, data, 'utf8')
    })
  const mkdirImpl =
    options.io?.mkdir ??
    (async (dir: string) => {
      await mkdir(dir, { recursive: true })
    })
  const log = options.log ?? (() => {})

  // 读取刻意用同步 readFileSync：文件是一条 <300B 的 JSON，启动关键路径开销
  // 可忽略；改异步读则要么在 settings load 与 createWindow 之间引入 await
  // （违反 startup-sequence.md 的 whenReady 同 tick IPC 注册不变量），要么
  // 与窗口创建竞态。损坏 / 缺失一律回退默认 1280x840（同 perf-baseline 的
  // 损坏回退模式）。
  let state: WindowStateV1 = { bounds: null, maximized: false }
  try {
    state = parseWindowState(JSON.parse(readImpl(options.file)) as unknown)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code !== 'ENOENT') {
      log('Failed to read window state; falling back to defaults.', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let savePromise: Promise<void> | null = null

  const persist = async (): Promise<void> => {
    try {
      await mkdirImpl(dirname(options.file))
      await writeImpl(options.file, JSON.stringify(state))
    } catch (error) {
      log('Failed to save window state.', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const cancelScheduledSave = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  const scheduleSave = (): void => {
    cancelScheduledSave()
    saveTimer = setTimeout(() => {
      saveTimer = null
      savePromise = persist()
    }, debounceMs)
    saveTimer.unref?.()
  }

  const capture = (win: TrackedWindow): boolean => {
    if (win.isDestroyed()) return false
    state = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    return true
  }

  return {
    getRestoredState: () => ({
      ...clampToVisibleArea(state.bounds, options.getDisplays()),
      maximized: state.maximized
    }),
    attach: (win) => {
      const onChange = (): void => {
        if (capture(win)) scheduleSave()
      }
      win.on('resize', onChange)
      win.on('move', onChange)
      win.on('maximize', onChange)
      win.on('unmaximize', onChange)
      win.on('close', () => {
        // 关窗时立即抓最终状态并落盘，不等防抖窗口。
        capture(win)
        cancelScheduledSave()
        savePromise = persist()
      })
    },
    flush: async () => {
      if (saveTimer) {
        cancelScheduledSave()
        savePromise = persist()
      }
      await savePromise
    }
  }
}
