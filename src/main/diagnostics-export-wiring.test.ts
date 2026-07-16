import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('diagnostics export wiring', () => {
  it('connects the main save dialog service and preload invoke channel', () => {
    const mainSource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const preloadSource = readFileSync(
      fileURLToPath(new URL('../preload/index.ts', import.meta.url)),
      'utf8'
    )

    expect(mainSource).toContain('exportDiagnostics: async () => {')
    expect(mainSource).toContain("await import('./diagnostics-export')")
    expect(mainSource).not.toMatch(/import \{[^}]*exportDiagnostics[^}]*\} from '\.\/diagnostics-export'/s)
    expect(mainSource).toContain('dialog.showSaveDialog')
    expect(preloadSource).toContain(
      "exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export')"
    )
  })
})
