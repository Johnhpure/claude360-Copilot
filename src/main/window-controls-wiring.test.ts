import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('main window controls wiring', () => {
  it('wires the Windows native controls overlay into BrowserWindow creation', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8')

    expect(source).toContain("titleBarOverlay: resolveWindowControlsOverlay(process.platform)")
  })

  it('reserves the Window Controls Overlay area with a stable fallback width', async () => {
    const css = await readFile(
      new URL('../renderer/src/styles/base-shell.css', import.meta.url),
      'utf8'
    )

    expect(css).toContain('env(titlebar-area-width, calc(100% - 138px))')
  })
})
