import { describe, expect, it, vi } from 'vitest'
import type { Rectangle } from 'electron'
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  WINDOW_BACKGROUND_DARK,
  WINDOW_BACKGROUND_LIGHT,
  clampToVisibleArea,
  createWindowStateManager,
  parseWindowState,
  resolveWindowBackgroundColor,
  syncNativeThemeSource,
  type DisplayLike,
  type TrackedWindow
} from './window-state'

const PRIMARY: DisplayLike = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const LEFT_MONITOR: DisplayLike = { workArea: { x: -1920, y: 0, width: 1920, height: 1040 } }

describe('parseWindowState', () => {
  it('returns defaults for corrupt shapes without throwing', () => {
    expect(parseWindowState(null)).toEqual({ bounds: null, maximized: false })
    expect(parseWindowState('junk')).toEqual({ bounds: null, maximized: false })
    expect(parseWindowState([1, 2])).toEqual({ bounds: null, maximized: false })
    expect(parseWindowState({ bounds: { x: 'a', y: 0, width: 100, height: 100 } })).toEqual({
      bounds: null,
      maximized: false
    })
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: -5, height: 100 } })).toEqual({
      bounds: null,
      maximized: false
    })
  })

  it('keeps a legal bounds payload and rounds fractions', () => {
    expect(
      parseWindowState({ bounds: { x: 10.6, y: -20.2, width: 800.4, height: 600 }, maximized: true })
    ).toEqual({ bounds: { x: 11, y: -20, width: 800, height: 600 }, maximized: true })
  })
})

describe('clampToVisibleArea', () => {
  it('returns centered defaults when bounds are missing', () => {
    expect(clampToVisibleArea(null, [PRIMARY])).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    })
  })

  it('returns centered defaults when no display remains (monitor unplugged)', () => {
    const bounds: Rectangle = { x: 100, y: 100, width: 1280, height: 840 }
    expect(clampToVisibleArea(bounds, [])).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    })
  })

  it('returns centered defaults when bounds are fully off-screen', () => {
    const bounds: Rectangle = { x: 5000, y: 5000, width: 1280, height: 840 }
    expect(clampToVisibleArea(bounds, [PRIMARY])).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT
    })
  })

  it('keeps bounds that sit fully inside a display', () => {
    const bounds: Rectangle = { x: 100, y: 60, width: 1280, height: 840 }
    expect(clampToVisibleArea(bounds, [PRIMARY])).toEqual(bounds)
  })

  it('keeps negative coordinates on a left-side monitor', () => {
    const bounds: Rectangle = { x: -1800, y: 40, width: 1280, height: 840 }
    expect(clampToVisibleArea(bounds, [PRIMARY, LEFT_MONITOR])).toEqual(bounds)
  })

  it('pulls a partially visible window back inside the closest work area', () => {
    const bounds: Rectangle = { x: 1800, y: 900, width: 1280, height: 840 }
    expect(clampToVisibleArea(bounds, [PRIMARY])).toEqual({
      x: 1920 - 1280,
      y: 1040 - 840,
      width: 1280,
      height: 840
    })
  })

  it('shrinks an oversized window to the work area (resolution change)', () => {
    const bounds: Rectangle = { x: -10, y: -10, width: 2600, height: 1600 }
    expect(clampToVisibleArea(bounds, [PRIMARY])).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040
    })
  })
})

describe('resolveWindowBackgroundColor', () => {
  it('maps the three theme states to css root token colors', () => {
    expect(resolveWindowBackgroundColor('dark', false)).toBe(WINDOW_BACKGROUND_DARK)
    expect(resolveWindowBackgroundColor('light', true)).toBe(WINDOW_BACKGROUND_LIGHT)
    expect(resolveWindowBackgroundColor('system', true)).toBe(WINDOW_BACKGROUND_DARK)
    expect(resolveWindowBackgroundColor('system', false)).toBe(WINDOW_BACKGROUND_LIGHT)
  })
})

describe('syncNativeThemeSource', () => {
  it('mirrors the settings theme onto nativeTheme.themeSource', () => {
    const target = { themeSource: 'system' as const } as { themeSource: 'system' | 'dark' | 'light' }
    syncNativeThemeSource('dark', target)
    expect(target.themeSource).toBe('dark')
    syncNativeThemeSource('system', target)
    expect(target.themeSource).toBe('system')
    syncNativeThemeSource('light', target)
    expect(target.themeSource).toBe('light')
  })
})

type FakeWindowOptions = {
  bounds?: Rectangle
  maximized?: boolean
}

function fakeWindow(options: FakeWindowOptions = {}): TrackedWindow & {
  emit: (event: string) => void
  setBounds: (bounds: Rectangle) => void
  setMaximized: (value: boolean) => void
} {
  let bounds: Rectangle = options.bounds ?? { x: 10, y: 20, width: 1000, height: 700 }
  let maximized = options.maximized ?? false
  const listeners = new Map<string, Array<() => void>>()
  return {
    on: ((event: string, listener: () => void) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
    }) as unknown as TrackedWindow['on'],
    isDestroyed: () => false,
    isMaximized: () => maximized,
    getNormalBounds: () => ({ ...bounds }),
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
    setBounds: (next: Rectangle) => {
      bounds = next
    },
    setMaximized: (value: boolean) => {
      maximized = value
    }
  }
}

function memoryIo(initial?: string): {
  io: { readFileSync: (path: string) => string; writeFile: (path: string, data: string) => Promise<void>; mkdir: () => Promise<void> }
  written: () => string | null
} {
  let stored: string | null = initial ?? null
  return {
    io: {
      readFileSync: () => {
        if (stored === null) {
          const error = new Error('ENOENT') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        }
        return stored
      },
      writeFile: async (_path: string, data: string) => {
        stored = data
      },
      mkdir: async () => {}
    },
    written: () => stored
  }
}

describe('createWindowStateManager', () => {
  it('restores persisted bounds and maximized flag', () => {
    const { io } = memoryIo(
      JSON.stringify({ bounds: { x: 40, y: 50, width: 1100, height: 780 }, maximized: true })
    )
    const manager = createWindowStateManager({
      file: '/tmp/window-state.json',
      getDisplays: () => [PRIMARY],
      io
    })
    expect(manager.getRestoredState()).toEqual({
      x: 40,
      y: 50,
      width: 1100,
      height: 780,
      maximized: true
    })
  })

  it('falls back to defaults on corrupt file content and logs once', () => {
    const log = vi.fn()
    const { io } = memoryIo('{ not json')
    const manager = createWindowStateManager({
      file: '/tmp/window-state.json',
      getDisplays: () => [PRIMARY],
      io,
      log
    })
    expect(manager.getRestoredState()).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      maximized: false
    })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('stays silent for a missing file (first launch)', () => {
    const log = vi.fn()
    const { io } = memoryIo()
    createWindowStateManager({
      file: '/tmp/window-state.json',
      getDisplays: () => [PRIMARY],
      io,
      log
    })
    expect(log).not.toHaveBeenCalled()
  })

  it('debounces window change events into a single save', async () => {
    vi.useFakeTimers()
    try {
      const { io, written } = memoryIo()
      const manager = createWindowStateManager({
        file: '/tmp/window-state.json',
        getDisplays: () => [PRIMARY],
        io
      })
      const win = fakeWindow()
      manager.attach(win)

      win.setBounds({ x: 1, y: 2, width: 1200, height: 800 })
      win.emit('resize')
      win.emit('move')
      win.setBounds({ x: 5, y: 6, width: 1280, height: 840 })
      win.emit('resize')
      expect(written()).toBeNull()

      await vi.advanceTimersByTimeAsync(600)
      expect(JSON.parse(written() ?? '')).toEqual({
        bounds: { x: 5, y: 6, width: 1280, height: 840 },
        maximized: false
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('captures maximize state through maximize/unmaximize events', async () => {
    vi.useFakeTimers()
    try {
      const { io, written } = memoryIo()
      const manager = createWindowStateManager({
        file: '/tmp/window-state.json',
        getDisplays: () => [PRIMARY],
        io
      })
      const win = fakeWindow()
      manager.attach(win)
      win.setMaximized(true)
      win.emit('maximize')
      await vi.advanceTimersByTimeAsync(600)
      expect(JSON.parse(written() ?? '')).toMatchObject({ maximized: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists immediately on close without waiting for the debounce', async () => {
    vi.useFakeTimers()
    try {
      const { io, written } = memoryIo()
      const manager = createWindowStateManager({
        file: '/tmp/window-state.json',
        getDisplays: () => [PRIMARY],
        io
      })
      const win = fakeWindow({ bounds: { x: 7, y: 8, width: 1024, height: 768 } })
      manager.attach(win)
      win.emit('close')
      await manager.flush()
      expect(JSON.parse(written() ?? '')).toEqual({
        bounds: { x: 7, y: 8, width: 1024, height: 768 },
        maximized: false
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
