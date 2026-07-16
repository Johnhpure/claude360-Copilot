import { describe, expect, it, vi } from 'vitest'

vi.mock('./logger', () => ({
  logWarn: vi.fn()
}))

import {
  applyWindowMaterial,
  isWin11MicaCapable,
  parseWindowsBuildNumber,
  resolveWindowControlsOverlay,
  type WindowMaterialTarget
} from './win-platform'

function fakeWindow(options: { throws?: boolean } = {}): WindowMaterialTarget & {
  setBackgroundMaterial: ReturnType<typeof vi.fn>
} {
  const setBackgroundMaterial = vi.fn(() => {
    if (options.throws) throw new Error('unsupported')
  })
  return {
    setBackgroundMaterial,
    isDestroyed: () => false
  } as unknown as WindowMaterialTarget & { setBackgroundMaterial: ReturnType<typeof vi.fn> }
}

describe('parseWindowsBuildNumber', () => {
  it('extracts the build segment from os.release()', () => {
    expect(parseWindowsBuildNumber('10.0.22621')).toBe(22621)
    expect(parseWindowsBuildNumber('10.0.19045')).toBe(19045)
    expect(parseWindowsBuildNumber(' 10.0.26100 ')).toBe(26100)
  })

  it('returns null for malformed release strings', () => {
    expect(parseWindowsBuildNumber('')).toBeNull()
    expect(parseWindowsBuildNumber('10.0')).toBeNull()
    expect(parseWindowsBuildNumber('10.0.abc')).toBeNull()
  })
})

describe('isWin11MicaCapable', () => {
  it('requires win32 and build >= 22621', () => {
    expect(isWin11MicaCapable('win32', '10.0.22621')).toBe(true)
    expect(isWin11MicaCapable('win32', '10.0.26100')).toBe(true)
    expect(isWin11MicaCapable('win32', '10.0.22000')).toBe(false)
    expect(isWin11MicaCapable('win32', '10.0.19045')).toBe(false)
    expect(isWin11MicaCapable('darwin', '10.0.26100')).toBe(false)
    expect(isWin11MicaCapable('linux', '10.0.26100')).toBe(false)
  })
})

describe('resolveWindowControlsOverlay', () => {
  it('uses native caption controls on Windows only', () => {
    expect(resolveWindowControlsOverlay('win32')).toEqual({ height: 40 })
    expect(resolveWindowControlsOverlay('linux')).toBe(false)
    expect(resolveWindowControlsOverlay('darwin')).toBe(false)
  })
})

describe('applyWindowMaterial', () => {
  it('never touches the window on non-win32 platforms', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const win = fakeWindow()
      expect(applyWindowMaterial(win, 'mica', { platform, releaseString: '10.0.26100' })).toBe('none')
      expect(win.setBackgroundMaterial).not.toHaveBeenCalled()
    }
  })

  it('applies mica on a capable win32 build', () => {
    const win = fakeWindow()
    const applied = applyWindowMaterial(win, 'mica', {
      platform: 'win32',
      releaseString: '10.0.22621'
    })
    expect(applied).toBe('mica')
    expect(win.setBackgroundMaterial).toHaveBeenCalledWith('mica')
  })

  it('skips mica below the Win11 22H2 build threshold without any API call', () => {
    const win = fakeWindow()
    const applied = applyWindowMaterial(win, 'mica', {
      platform: 'win32',
      releaseString: '10.0.19045'
    })
    expect(applied).toBe('none')
    expect(win.setBackgroundMaterial).not.toHaveBeenCalled()
  })

  it('silently falls back to solid when setBackgroundMaterial throws', () => {
    const log = vi.fn()
    const win = fakeWindow({ throws: true })
    const applied = applyWindowMaterial(win, 'mica', {
      platform: 'win32',
      releaseString: '10.0.22621',
      log
    })
    expect(applied).toBe('none')
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('resets to solid when switching away from a previously applied mica', () => {
    const win = fakeWindow()
    const applied = applyWindowMaterial(win, 'none', {
      previousApplied: 'mica',
      platform: 'win32',
      releaseString: '10.0.22621'
    })
    expect(applied).toBe('none')
    expect(win.setBackgroundMaterial).toHaveBeenCalledWith('none')
  })

  it('makes no API call when none is requested and none was applied', () => {
    const win = fakeWindow()
    expect(
      applyWindowMaterial(win, 'none', { platform: 'win32', releaseString: '10.0.22621' })
    ).toBe('none')
    expect(win.setBackgroundMaterial).not.toHaveBeenCalled()
  })

  it('handles a missing window', () => {
    expect(applyWindowMaterial(null, 'mica', { platform: 'win32', releaseString: '10.0.22621' })).toBe('none')
  })
})
