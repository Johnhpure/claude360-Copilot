import { describe, expect, it, vi } from 'vitest'
import type { GuiUpdateState, GuiUpdateProgress } from '../shared/gui-update'
import { applyUpdateTaskbarProgress, type TaskbarProgressWindow } from './win-taskbar-progress'

function fakeWindow(): TaskbarProgressWindow & { setProgressBar: ReturnType<typeof vi.fn> } {
  return {
    setProgressBar: vi.fn(),
    isDestroyed: () => false
  } as unknown as TaskbarProgressWindow & { setProgressBar: ReturnType<typeof vi.fn> }
}

function progress(percent: number): GuiUpdateProgress {
  return { total: 100, delta: 1, transferred: percent, percent, bytesPerSecond: 1024 }
}

describe('applyUpdateTaskbarProgress', () => {
  it('maps downloading percent to a 0-1 normal progress value', () => {
    const win = fakeWindow()
    const state: GuiUpdateState = { status: 'downloading', progress: progress(42) }
    applyUpdateTaskbarProgress(win, state, 'win32')
    expect(win.setProgressBar).toHaveBeenCalledWith(0.42, { mode: 'normal' })
  })

  it('clamps out-of-range percents into 0-1', () => {
    const win = fakeWindow()
    applyUpdateTaskbarProgress(win, { status: 'downloading', progress: progress(120) }, 'win32')
    expect(win.setProgressBar).toHaveBeenLastCalledWith(1, { mode: 'normal' })
    applyUpdateTaskbarProgress(win, { status: 'downloading', progress: progress(-5) }, 'win32')
    expect(win.setProgressBar).toHaveBeenLastCalledWith(0, { mode: 'normal' })
  })

  it('falls back to indeterminate when percent is not a finite number', () => {
    const win = fakeWindow()
    const state = {
      status: 'downloading',
      progress: { ...progress(0), percent: Number.NaN }
    } as GuiUpdateState
    applyUpdateTaskbarProgress(win, state, 'win32')
    expect(win.setProgressBar).toHaveBeenCalledWith(2, { mode: 'indeterminate' })
  })

  it('clears the progress bar when the download completes', () => {
    const win = fakeWindow()
    const state = {
      status: 'downloaded',
      info: { ok: true }
    } as unknown as GuiUpdateState
    applyUpdateTaskbarProgress(win, state, 'win32')
    expect(win.setProgressBar).toHaveBeenCalledWith(-1, { mode: 'none' })
  })

  it('clears the progress bar on error and idle states', () => {
    const win = fakeWindow()
    applyUpdateTaskbarProgress(win, { status: 'error', message: 'boom' }, 'win32')
    applyUpdateTaskbarProgress(win, { status: 'idle' }, 'win32')
    expect(win.setProgressBar).toHaveBeenCalledTimes(2)
    expect(win.setProgressBar).toHaveBeenNthCalledWith(1, -1, { mode: 'none' })
    expect(win.setProgressBar).toHaveBeenNthCalledWith(2, -1, { mode: 'none' })
  })

  it('is a no-op on non-win32 platforms', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const win = fakeWindow()
      applyUpdateTaskbarProgress(win, { status: 'downloading', progress: progress(50) }, platform)
      applyUpdateTaskbarProgress(win, { status: 'idle' }, platform)
      expect(win.setProgressBar).not.toHaveBeenCalled()
    }
  })

  it('tolerates a missing or destroyed window', () => {
    expect(() =>
      applyUpdateTaskbarProgress(null, { status: 'idle' }, 'win32')
    ).not.toThrow()
    const destroyed = {
      setProgressBar: vi.fn(),
      isDestroyed: () => true
    } as unknown as TaskbarProgressWindow & { setProgressBar: ReturnType<typeof vi.fn> }
    applyUpdateTaskbarProgress(destroyed, { status: 'idle' }, 'win32')
    expect(destroyed.setProgressBar).not.toHaveBeenCalled()
  })
})
