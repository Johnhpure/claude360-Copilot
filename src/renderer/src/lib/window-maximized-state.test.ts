import { describe, expect, it, vi } from 'vitest'
import {
  bindWindowMaximizedState,
  estimateMaximizedHeuristically,
  type MaximizedHeuristicWindow
} from './window-maximized-state'

function fakeWindow(options: { outerWidth?: number; outerHeight?: number } = {}): MaximizedHeuristicWindow & {
  resizeListeners: Array<() => void>
  setOuter: (width: number, height: number) => void
} {
  let outerWidth = options.outerWidth ?? 1280
  let outerHeight = options.outerHeight ?? 840
  const resizeListeners: Array<() => void> = []
  return {
    get outerWidth() {
      return outerWidth
    },
    get outerHeight() {
      return outerHeight
    },
    screen: { availWidth: 1920, availHeight: 1040 },
    addEventListener: (_type, listener) => {
      resizeListeners.push(listener)
    },
    removeEventListener: (_type, listener) => {
      const index = resizeListeners.indexOf(listener)
      if (index >= 0) resizeListeners.splice(index, 1)
    },
    resizeListeners,
    setOuter: (width: number, height: number) => {
      outerWidth = width
      outerHeight = height
    }
  }
}

describe('estimateMaximizedHeuristically', () => {
  it('detects a window filling the available screen area', () => {
    expect(estimateMaximizedHeuristically(fakeWindow({ outerWidth: 1920, outerHeight: 1040 }))).toBe(true)
    expect(estimateMaximizedHeuristically(fakeWindow({ outerWidth: 1280, outerHeight: 840 }))).toBe(false)
  })
})

describe('bindWindowMaximizedState', () => {
  it('drives the state from main-process events when the subscription exists', () => {
    const setMaximized = vi.fn()
    const handlers: Array<(payload: { maximized: boolean }) => void> = []
    const unsubscribe = vi.fn()
    const win = fakeWindow()

    const cleanup = bindWindowMaximizedState({
      windowLike: win,
      setMaximized,
      subscribe: (handler) => {
        handlers.push(handler)
        return unsubscribe
      }
    })

    // 初始值来自启发式（false），随后事件驱动更新。
    expect(setMaximized).toHaveBeenNthCalledWith(1, false)
    handlers[0]?.({ maximized: true })
    expect(setMaximized).toHaveBeenNthCalledWith(2, true)
    handlers[0]?.({ maximized: false })
    expect(setMaximized).toHaveBeenNthCalledWith(3, false)

    // 事件模式下不挂 resize 监听（启发式仅用于初始值）。
    expect(win.resizeListeners).toHaveLength(0)
    cleanup()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('falls back to the resize heuristic when the subscription is unavailable', () => {
    const setMaximized = vi.fn()
    const win = fakeWindow()

    const cleanup = bindWindowMaximizedState({ windowLike: win, setMaximized })

    expect(setMaximized).toHaveBeenNthCalledWith(1, false)
    expect(win.resizeListeners).toHaveLength(1)

    win.setOuter(1920, 1040)
    win.resizeListeners[0]?.()
    expect(setMaximized).toHaveBeenNthCalledWith(2, true)

    cleanup()
    expect(win.resizeListeners).toHaveLength(0)
  })
})
