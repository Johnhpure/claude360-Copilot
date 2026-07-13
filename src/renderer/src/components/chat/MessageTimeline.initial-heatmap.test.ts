import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

function renderHero(options: {
  route?: 'chat' | 'claw'
  ready?: boolean
  runtimeError?: string | null
  codeHome?: boolean
  conversationHome?: boolean
  workspaceRoot?: string
  recentWorkspaceRoots?: readonly string[]
} = {}): string {
  const conversationHome = options.conversationHome ?? false
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      route: options.route ?? 'chat',
      ready: options.ready ?? true,
      runtimeError: options.runtimeError ?? null,
      activeClawChannel: null,
      // 装配层互斥:codeHome 与 conversationHome 不同时为 true(MessageTimeline)。
      codeHome: options.codeHome ?? ((options.route ?? 'chat') === 'chat' && !conversationHome),
      conversationHome,
      workspaceRoot: options.workspaceRoot ?? '/root/projects/demo-app',
      recentWorkspaceRoots: options.recentWorkspaceRoots ?? [],
      onPickWorkspace: () => undefined,
      onSelectWorkspaceRoot: () => undefined,
      onRetry: () => undefined,
      onOpenSettings: () => undefined,
      onSelectSuggestion: () => undefined
    })
  )
}

describe('MessageTimeline initial empty hero routing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the developer starter workbench for eligible initial chat states', () => {
    // 07-13-code-home-workbench：Code 就绪空态 = 收紧版 BrandHero + 项目
    // 引导行 + 8 张快捷任务卡 + 内嵌折叠用量日历（取代原独立热力图空态）。
    const html = renderHero()

    expect(html).toContain('code-home-workbench')
    expect(html).toContain('ds-brand-hero-compact')
    // 引导行：kicker + 项目名（workspaceLabelFromPath 取 basename）
    expect(html).toContain('Current project')
    expect(html).toContain('demo-app')
    // 8 张快捷任务卡
    expect(html).toContain('code-starter-deck')
    expect(html).toContain('Build a new feature')
    expect(html).toContain('Debug an error')
    // 用量日历保留且默认折叠（只露展开按钮，无展开面板标题）
    expect(html).toContain('Expand calendar')
    expect(html).not.toContain('Daily agent usage calendar')
    expect(html).not.toContain('Start a new conversation')
  })

  it('shows the no-project welcome when the workspace root is empty', () => {
    // 07-13-code-home-polish R2：未打开项目 → 单一品牌 + 行动标题 +
    // 打开项目按钮，不再渲染开发卡与「当前项目」引导行。
    const html = renderHero({ workspaceRoot: '' })

    expect(html).toContain('no-project-welcome')
    expect(html).toContain('ds-brand-hero-compact')
    expect(html).toContain('Open a project to start building')
    expect(html).toContain('Open project folder')
    expect(html).not.toContain('Current project')
    expect(html).not.toContain('code-starter-deck')
    // 外壳复用 ds-code-home-workbench 样式类,这里精确断言 testid 不出现
    expect(html).not.toContain('data-testid="code-home-workbench"')
    // 无最近项目时不渲染该区
    expect(html).not.toContain('Recent projects')
  })

  it('treats the default workspace path as no project opened', () => {
    // 主进程把空 workspaceRoot 兜底成 default_workspace——渲染层必须把它
    // 还原成「未打开项目」，而不是伪装成名为产品名的项目。
    const expandedHtml = renderHero({ workspaceRoot: '/root/Claude360 Copilot/default_workspace' })
    expect(expandedHtml).toContain('no-project-welcome')
    expect(expandedHtml).not.toContain('Current project')
    expect(expandedHtml).not.toContain('code-starter-deck')

    const legacyHtml = renderHero({ workspaceRoot: '/home/u/.kun/default_workspace' })
    expect(legacyHtml).toContain('no-project-welcome')
  })

  it('lists up to five recent projects and filters non-project roots', () => {
    const html = renderHero({
      workspaceRoot: '',
      recentWorkspaceRoots: [
        '/root/Claude360 Copilot/default_workspace',
        '/root/projects/alpha',
        '/root/projects/beta',
        '/root/projects/gamma',
        '/root/projects/delta',
        '/root/projects/epsilon',
        '/root/projects/zeta'
      ]
    })

    expect(html).toContain('Recent projects')
    expect(html).toContain('alpha')
    expect(html).toContain('epsilon')
    // 超过 5 条截断；default_workspace 被过滤不计入
    expect(html).not.toContain('zeta')
    expect(html).not.toContain('default_workspace')
  })

  it('renders the generic conversation home for the conversation view', () => {
    // 07-13-code-home-polish R3：「对话」视图空态 = 通用 AI 首页，
    // 无任何 Code 专属文案/卡片。
    const html = renderHero({ conversationHome: true })

    expect(html).toContain('conversation-home')
    expect(html).toContain('ds-brand-hero-compact')
    expect(html).toContain('Chat assistant')
    expect(html).toContain('What would you like to talk about?')
    expect(html).toContain('conversation-starter-deck')
    expect(html).toContain('Summarize content')
    expect(html).toContain('Extract key points')
    // 用量日历与 Code 首页一致保留（默认折叠）
    expect(html).toContain('Expand calendar')
    expect(html).not.toContain('Build a new feature')
    expect(html).not.toContain('Current project')
    expect(html).not.toContain('code-starter-deck')
    expect(html).not.toContain('data-testid="code-home-workbench"')
  })

  it('keeps the standalone collapsed heatmap for non-code hosts (write/sdd panels)', () => {
    // write/sdd 助手面板复用 MessageTimeline 时不启用工作台形态，
    // 维持原独立热力图空态。
    const html = renderHero({ codeHome: false })

    expect(html).toContain('Expand calendar')
    expect(html).not.toContain('code-home-workbench')
    expect(html).not.toContain('code-starter-deck')
    expect(html).not.toContain('conversation-home')
    expect(html).not.toContain('ds-brand-hero-compact')
    // 独立形态保留自带 BrandHero hero 区
    expect(html).toContain('ds-brand-hero')
  })

  it('keeps offline, Claw, and conversation empty states gated away from each other', () => {
    const offlineHtml = renderHero({ ready: false })
    expect(offlineHtml).toContain('Claude360 Copilot is waking the local agent')
    // 61de212 起离线唤醒页以动态文字品牌 BrandHero 替代 Kun 图形（sleep 态已移除）。
    expect(offlineHtml).toContain('ds-brand-hero')
    expect(offlineHtml).not.toContain('code-starter-deck')
    expect(offlineHtml).not.toContain('no-project-welcome')

    // 未就绪优先于对话首页（分支 1 短路）
    const offlineConversationHtml = renderHero({ ready: false, conversationHome: true })
    expect(offlineConversationHtml).not.toContain('conversation-home')

    const clawHtml = renderHero({ route: 'claw', codeHome: false })
    expect(clawHtml).toContain('Start a conversation with this assistant')
    expect(clawHtml).toContain('ds-kun-state-greet')
    expect(clawHtml).not.toContain('Agent usage')
    expect(clawHtml).not.toContain('code-starter-deck')

    // claw 分支优先于对话首页（组件内顺序防御；装配层本就互斥）
    const clawConversationHtml = renderHero({ route: 'claw', codeHome: false, conversationHome: true })
    expect(clawConversationHtml).not.toContain('conversation-home')
  })

  it('shows the runtime error in the offline hero when one is available', () => {
    const html = renderHero({
      ready: false,
      runtimeError: i18n.t('common:runtimePortConflict')
    })

    expect(html).toContain('The runtime port is already in use.')
  })
})

describe('MessageTimeline initial empty hero routing (zh-CN)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('renders the workbench intro and starter cards in Chinese', () => {
    const html = renderHero()

    expect(html).toContain('当前项目')
    expect(html).toContain('demo-app')
    expect(html).toContain('选择一个快捷任务开始')
    expect(html).toContain('实现新需求')
    expect(html).toContain('排查报错')
  })

  it('renders the Chinese no-project welcome without a workspace root', () => {
    const html = renderHero({
      workspaceRoot: '',
      recentWorkspaceRoots: ['/root/projects/alpha']
    })

    expect(html).toContain('no-project-welcome')
    expect(html).toContain('打开一个项目，开始开发')
    expect(html).toContain('打开项目目录')
    expect(html).toContain('最近项目')
    expect(html).toContain('alpha')
    expect(html).not.toContain('当前项目')
  })

  it('renders the Chinese conversation home for the conversation view', () => {
    const html = renderHero({ conversationHome: true })

    expect(html).toContain('conversation-home')
    expect(html).toContain('对话助手')
    expect(html).toContain('今天想聊些什么？')
    expect(html).toContain('总结内容')
    expect(html).toContain('提炼要点')
    expect(html).not.toContain('实现新需求')
    expect(html).not.toContain('当前项目')
  })
})
