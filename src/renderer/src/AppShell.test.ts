import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupI18nTestEnglish } from './test-support/i18n-en'
import AppShell from './AppShell'

// R1（07-14-renderer-lazy-loading）：本文件以英文文案断言 UI——en 资源已改动态加载，先恢复 en 测试环境。
beforeAll(() => setupI18nTestEnglish())

describe('AppShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the macOS app shell on the same full-height flex chain as desktop titlebar platforms', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'darwin' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('flex h-full min-h-0 flex-col bg-transparent')
    expect(html).toContain('flex min-h-0 flex-1 flex-col')
    expect(html).not.toContain('ds-windows-titlebar')
  })

  it('renders a visible route fallback instead of a blank shell while lazy views load', () => {
    vi.stubGlobal('window', {
      kunGui: { platform: 'win32' }
    })

    const html = renderToStaticMarkup(createElement(AppShell))

    expect(html).toContain('role="status"')
    expect(html).toContain('Loading')
    expect(html).toContain('bg-ds-card')
  })
})
