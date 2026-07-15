import { describe, expect, it } from 'vitest'
import { isDeprecatedWindowsArch } from './win-arch-deprecation'

describe('isDeprecatedWindowsArch', () => {
  it('is true only for win32 + ia32', () => {
    expect(isDeprecatedWindowsArch('win32', 'ia32')).toBe(true)
  })

  it('is false for every other platform/arch combination', () => {
    const combos: Array<[string, string]> = [
      ['win32', 'x64'],
      ['win32', 'arm64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      // ia32 在非 Windows 平台不构成弃用条件（判定必须同时看 platform）。
      ['darwin', 'ia32'],
      ['linux', 'ia32']
    ]
    for (const [platform, arch] of combos) {
      expect(isDeprecatedWindowsArch(platform, arch), `${platform}/${arch}`).toBe(false)
    }
  })
})
