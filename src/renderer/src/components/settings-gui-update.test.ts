import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WindowsIa32DeprecationBanner } from './settings-gui-update'

function t(key: string, values?: Record<string, unknown>): string {
  if (!values) return key
  return `${key}:${Object.entries(values)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',')}`
}

describe('WindowsIa32DeprecationBanner', () => {
  it('renders the deprecation banner with title, capability notice and x64 action on win32 + ia32 (AC2)', () => {
    const html = renderToStaticMarkup(
      createElement(WindowsIa32DeprecationBanner, { platform: 'win32', arch: 'ia32', t })
    )

    expect(html).toContain('guiUpdateIa32DeprecatedTitle')
    expect(html).toContain('guiUpdateIa32DeprecatedDesc')
    expect(html).toContain('guiUpdateIa32DeprecatedAction')
    // warn tone 走 ds-warning token 惯例（与更新卡一致）。
    expect(html).toContain('bg-ds-warning-soft')
  })

  it('renders nothing on win32 x64, darwin and linux (AC2)', () => {
    const combos: Array<[string, string]> = [
      ['win32', 'x64'],
      ['win32', 'arm64'],
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'x64'],
      ['linux', 'ia32']
    ]
    for (const [platform, arch] of combos) {
      const html = renderToStaticMarkup(
        createElement(WindowsIa32DeprecationBanner, { platform, arch, t })
      )
      expect(html, `${platform}/${arch}`).toBe('')
    }
  })
})
