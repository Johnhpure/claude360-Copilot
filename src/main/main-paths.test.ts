import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLogDirectory, resolvePreloadPath } from './main-paths'

describe('main paths', () => {
  it('resolves the log directory under Electron userData', () => {
    // 改名后 Electron 由 app.setName('Claude360 Copilot') 派生出全新 userData 目录,
    // 视为新应用;此处用新目录名校验 log 目录拼接。
    expect(
      resolveLogDirectory({ getPath: () => 'C:\\Users\\test\\AppData\\Claude360 Copilot' })
    ).toBe(join('C:\\Users\\test\\AppData\\Claude360 Copilot', 'logs'))
  })

  it('prefers the CommonJS preload build when present', () => {
    const distDir = 'C:\\app\\out\\main'

    expect(resolvePreloadPath(distDir, (path) => path.endsWith('index.cjs'))).toBe(
      join(distDir, '../preload/index.cjs')
    )
  })

  it('falls back to the ESM preload build', () => {
    const distDir = 'C:\\app\\out\\main'

    expect(resolvePreloadPath(distDir, () => false)).toBe(
      join(distDir, '../preload/index.mjs')
    )
  })
})
