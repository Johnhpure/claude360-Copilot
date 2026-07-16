import { describe, expect, it } from 'vitest'
import PreloadSource from './index.ts?raw'
import CrashChannelSource from '../shared/crash-channel.ts?raw'
import ReplayedIpcChannelSource from '../shared/replayed-ipc-channel.ts?raw'

/**
 * The preload runs sandboxed: its require() can only load 'electron'. Any
 * shared module imported BY VALUE must therefore be free of runtime package
 * imports — a transitive `require('zod')` (via '../shared/crash-types') made
 * the packaged preload fail to load in v0.2.12/13, killed window.kunGui, and
 * surfaced across the whole UI as "connection failed".
 */
const ALLOWED_SHARED_VALUE_IMPORTS = new Set(['crash-channel', 'replayed-ipc-channel'])

function sharedValueImports(source: string): string[] {
  const results: string[] = []
  const pattern = /import\s+(type\s+)?\{[^}]*\}\s+from\s+'\.\.\/shared\/([a-z0-9-]+)'/g
  for (const match of source.matchAll(pattern)) {
    const isTypeOnly = Boolean(match[1])
    const moduleName = match[2] ?? ''
    if (!isTypeOnly && moduleName) results.push(moduleName)
  }
  return results
}

function packageValueImports(source: string): string[] {
  const results: string[] = []
  const pattern = /import\s+(type\s+)?(?:\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+'([^'.][^']*)'/g
  for (const match of source.matchAll(pattern)) {
    const isTypeOnly = Boolean(match[1])
    const specifier = match[2] ?? ''
    if (!isTypeOnly && specifier) results.push(specifier)
  }
  return results
}

describe('preload sandbox import safety', () => {
  it('only value-imports zod-free shared modules', () => {
    for (const moduleName of sharedValueImports(PreloadSource)) {
      expect(ALLOWED_SHARED_VALUE_IMPORTS).toContain(moduleName)
    }
  })

  it('never value-imports the zod-backed crash-types module', () => {
    expect(PreloadSource).not.toMatch(
      /import\s+\{[^}]*\}\s+from\s+'\.\.\/shared\/crash-types'/
    )
  })

  it("only imports the 'electron' package by value", () => {
    expect(packageValueImports(PreloadSource)).toEqual(['electron'])
  })

  it('keeps the allowed shared modules free of package imports', () => {
    for (const source of [CrashChannelSource, ReplayedIpcChannelSource]) {
      expect(source).not.toMatch(/^\s*import\s/m)
      expect(source).not.toContain("from 'zod'")
    }
  })
})
