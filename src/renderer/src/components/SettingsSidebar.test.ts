import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSidebar } from './SettingsSidebar'

// t 返回 i18n key,便于按 key 断言导航项是否渲染。
function renderNav(): string {
  return renderToStaticMarkup(
    createElement(SettingsSidebar, {
      category: 'general',
      goBack: vi.fn(),
      setCategory: vi.fn(),
      t: (key: string) => key
    })
  )
}

describe('SettingsSidebar 第一阶段导航可见性(plan-04 Task7)', () => {
  it('保留核心导航项:通用/供应商/写作/智能体', () => {
    const html = renderNav()
    expect(html).toContain('general')
    expect(html).toContain('providers')
    expect(html).toContain('write')
    expect(html).toContain('agents')
  })

  it('隐藏第一阶段不交付的手机连接(Claw)导航项', () => {
    const html = renderNav()
    // 隐藏后不再渲染 claw 导航按钮文案。
    expect(html).not.toContain('>claw<')
  })
})
