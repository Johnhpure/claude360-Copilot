import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import i18n from '../../i18n'
import { CodeStarterDeck, ConversationStarterDeck } from './CodeStarterDeck'

/**
 * 首页快捷任务卡组件测试（07-13-code-home-workbench Step 4.2 建立，
 * 07-13-code-home-polish Step 1 扩展：2 列网格、去 truncate、对话版 Deck）。
 * 惯例：renderToStaticMarkup 字符串断言（无 DOM 环境，点击行为不在此断言，
 * onSelect 模板内容经 i18n.t 直接核对——与卡片 onClick 注入的是同一份文案）。
 */

function renderDeck(): string {
  return renderToStaticMarkup(createElement(CodeStarterDeck, { onSelect: () => undefined }))
}

function renderConversationDeck(): string {
  return renderToStaticMarkup(
    createElement(ConversationStarterDeck, { onSelect: () => undefined })
  )
}

// R1（07-14-renderer-lazy-loading）：本文件以英文文案断言 UI——en 资源已改动态加载，先恢复 en 测试环境。
beforeAll(() => setupI18nTestEnglish())

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

  it('keeps the two-column grid, unclamped text, and the empty-hero card hooks', () => {
    const html = renderDeck()
    expect(html).toContain('code-starter-deck')
    expect(html).toContain('sm:grid-cols-2')
    // 2 列封顶（07-13-code-home-polish R1）：4 列在 63rem 内容列封顶下
    // 文本可用宽仅 ~131px，en 副文案必然省略号截断。
    expect(html).not.toContain('xl:grid-cols-4')
    // 标题/副文案自然换行，不得再出现单行省略截断（防回归）。
    expect(html).not.toContain('truncate')
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

describe('ConversationStarterDeck (en)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders all 8 generic starter cards with their titles', () => {
    const html = renderConversationDeck()
    expect(html).toContain('conversation-starter-deck')
    expect(html).toContain('Summarize content')
    expect(html).toContain('Polish writing')
    expect(html).toContain('Translate content')
    expect(html).toContain('Brainstorm ideas')
    expect(html).toContain('Make a plan')
    expect(html).toContain('Explain a concept')
    expect(html).toContain('Write an email')
    expect(html).toContain('Extract key points')
    expect(html.match(/<button/g)?.length).toBe(8)
  })

  it('shares the two-column unclamped layout with the code deck', () => {
    const html = renderConversationDeck()
    expect(html).toContain('sm:grid-cols-2')
    expect(html).not.toContain('xl:grid-cols-4')
    expect(html).not.toContain('truncate')
    expect(html).toContain('ds-empty-hero-card')
  })

  it('resolves structured multi-line prompt templates for composer injection', () => {
    expect(i18n.t('common:conversationStarterEmailPrompt')).toContain('Key points:')
    expect(i18n.t('common:conversationStarterPlanPrompt')).toContain('Time frame:')
    expect(i18n.t('common:conversationStarterSummarizePrompt')).toContain('(paste the content here)')
    // design §4.2：翻译卡必须留目标语言空位，而非写死某个语种。
    expect(i18n.t('common:conversationStarterTranslatePrompt')).toContain('Target language:')
  })
})

describe('ConversationStarterDeck (zh-CN)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('renders all 8 generic starter cards in Chinese', () => {
    const html = renderConversationDeck()
    expect(html).toContain('conversation-starter-deck')
    expect(html).toContain('总结内容')
    expect(html).toContain('润色改写')
    expect(html).toContain('翻译内容')
    expect(html).toContain('头脑风暴')
    expect(html).toContain('制定计划')
    expect(html).toContain('解释概念')
    expect(html).toContain('写邮件')
    expect(html).toContain('提炼要点')
    expect(html.match(/<button/g)?.length).toBe(8)
  })

  it('resolves guided Chinese templates (续填结构)', () => {
    expect(i18n.t('common:conversationStarterSummarizePrompt')).toContain('（粘贴内容）')
    expect(i18n.t('common:conversationStarterEmailPrompt')).toContain('收件人：')
    expect(i18n.t('common:conversationStarterBrainstormPrompt')).toContain('主题：')
    // design §4.2：与 en 对称，目标语言留空位。
    expect(i18n.t('common:conversationStarterTranslatePrompt')).toContain('目标语言：')
  })
})
