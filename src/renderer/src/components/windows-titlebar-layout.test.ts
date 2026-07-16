import { describe, expect, it } from 'vitest'
import WindowsTitleBarSource from './WindowsTitleBar.tsx?raw'
import AppShellSource from '../AppShell.tsx?raw'

describe('Windows titlebar native controls layout', () => {
  it('uses native controls for the Windows renderer branch and the overlay fallback', () => {
    expect(WindowsTitleBarSource).toContain(
      "const usesNativeWindowControls = resolvedPlatform === 'win32' || overlayVisible"
    )
    expect(WindowsTitleBarSource).toContain('ds-windows-titlebar--native-controls')
  })

  it('keeps the titlebar band when the overlay is visible but the bridge is down', () => {
    // If the preload fails to load, platform detection degrades to 'unknown'
    // while the native overlay buttons keep floating over the top-right.
    // Both the component guard and the AppShell mount must fall back to the
    // windowControlsOverlay API so content still reserves the titlebar band.
    expect(WindowsTitleBarSource).toContain(
      'if (!supportsDesktopTitleBar(resolvedPlatform) && !overlayVisible) return null'
    )
    expect(WindowsTitleBarSource).toContain('export function isWindowControlsOverlayVisible')
    expect(AppShellSource).toContain(
      'supportsDesktopTitleBar(platform) || isWindowControlsOverlayVisible()'
    )
  })
})
