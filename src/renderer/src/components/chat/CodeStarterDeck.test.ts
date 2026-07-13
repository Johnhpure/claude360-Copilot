import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { CodeStarterDeck } from './CodeStarterDeck'

/**
 * Code 首页启动工作台 8 卡组件测试（07-13-code-home-workbench Step 4.2）。
 * 惯例：renderToStaticMarkup 字符串断言（无 DOM 环境，点击行为不在此断言，
 * onSelect 模板内容经 i18n.t 直接核对——与卡片 onClick 注入的是同一份文案）。
 */

function renderDeck(): string {
  return renderToStaticMarkup(createElement(CodeStarterDeck, { onSelect: () => undefined }))
}

describe('CodeStarterDeck (en)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders all 8 starter cards with their titles', () => {
    const html = renderDeck()
    expect(html).toContain('Build a new feature')
    expect(html).toContain('Improve a feature')
    expect(html).toContain('Fix a bug')
    expect(html).toContain('Analyze project structure')
    expect(html).toContain('Explain code logic')
    expect(html).toContain('Add tests')
    expect(html).toContain('Refactor a module')
    expect(html).toContain('Debug an error')
    expect(html.match(/<button/g)?.length).toBe(8)
  })

  it('keeps the responsive grid and the empty-hero card hooks', () => {
    const html = renderDeck()
    expect(html).toContain('code-starter-deck')
    expect(html).toContain('sm:grid-cols-2')
    expect(html).toContain('xl:grid-cols-4')
    // 保留 ds-empty-hero-card* 钩子，≤640px 容器查询继续生效
    expect(html).toContain('ds-empty-hero-card')
    expect(html).toContain('ds-empty-hero-card-icon')
    expect(html).toContain('ds-empty-hero-card-title')
    expect(html).toContain('ds-empty-hero-card-sub')
  })

  it('resolves structured multi-line prompt templates for composer injection', () => {
    expect(i18n.t('common:starterFeaturePrompt')).toContain('Acceptance criteria:')
    expect(i18n.t('common:starterBugfixPrompt')).toContain('Steps to reproduce:')
    expect(i18n.t('common:starterDebugPrompt')).toContain('```')
  })
})

describe('CodeStarterDeck (zh-CN)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('renders all 8 starter cards in Chinese', () => {
    const html = renderDeck()
    expect(html).toContain('实现新需求')
    expect(html).toContain('优化已有功能')
    expect(html).toContain('修复 Bug')
    expect(html).toContain('分析项目结构')
    expect(html).toContain('解释代码逻辑')
    expect(html).toContain('补充测试')
    expect(html).toContain('重构模块')
    expect(html).toContain('排查报错')
    expect(html.match(/<button/g)?.length).toBe(8)
  })

  it('resolves guided Chinese templates (R3 续填结构)', () => {
    expect(i18n.t('common:starterFeaturePrompt')).toContain('验收要求：')
    expect(i18n.t('common:starterRefactorPrompt')).toContain('保持行为不变')
    expect(i18n.t('common:starterDebugPrompt')).toContain('（粘贴报错）')
  })
})
