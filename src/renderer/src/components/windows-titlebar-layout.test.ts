import { describe, expect, it } from 'vitest'
import WindowsTitleBarSource from './WindowsTitleBar.tsx?raw'

describe('Windows titlebar native controls layout', () => {
  it('uses native controls only for the Windows renderer branch', () => {
    expect(WindowsTitleBarSource).toContain(
      "const usesNativeWindowControls = resolvedPlatform === 'win32'"
    )
    expect(WindowsTitleBarSource).toContain('ds-windows-titlebar--native-controls')
  })
})
