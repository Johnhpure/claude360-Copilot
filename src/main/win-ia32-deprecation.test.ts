import { describe, expect, it, vi } from 'vitest'
import {
  WIN_IA32_DEPRECATION_LOG_CATEGORY,
  WIN_IA32_DEPRECATION_WARNING,
  warnWindowsIa32Deprecation
} from './win-ia32-deprecation'

describe('warnWindowsIa32Deprecation', () => {
  it('logs exactly one complete warning on win32 + ia32 (AC1)', () => {
    const warn = vi.fn()
    expect(warnWindowsIa32Deprecation({ platform: 'win32', arch: 'ia32', warn })).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)

    const [category, message, detail] = warn.mock.calls[0]
    expect(category).toBe(WIN_IA32_DEPRECATION_LOG_CATEGORY)
    expect(message).toBe(WIN_IA32_DEPRECATION_WARNING)
    // 文案完整性：三项能力限制 + 弃用计划 + x64 下载指引（prd R1）。
    expect(message).toContain('Agent SDK')
    expect(message).toContain('语音转文字')
    expect(message).toContain('computer-use')
    expect(message).toContain('停止发布 32 位安装包')
    expect(message).toContain('x64')
    expect(message).toContain('https://github.com/Johnhpure/claude360-Copilot/releases')
    expect(detail).toMatchObject({
      platform: 'win32',
      arch: 'ia32',
      downloadUrl: 'https://github.com/Johnhpure/claude360-Copilot/releases'
    })
  })

  it('stays silent on win32 x64, darwin and linux (AC1)', () => {
    const combos: Array<[string, string]> = [
      ['win32', 'x64'],
      ['win32', 'arm64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'ia32']
    ]
    for (const [platform, arch] of combos) {
      const warn = vi.fn()
      expect(warnWindowsIa32Deprecation({ platform, arch, warn }), `${platform}/${arch}`).toBe(false)
      expect(warn).not.toHaveBeenCalled()
    }
  })
})
