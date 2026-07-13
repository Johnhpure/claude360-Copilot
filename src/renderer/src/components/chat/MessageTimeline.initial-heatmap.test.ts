import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { MessageTimelineEmptyHero } from './message-timeline-empty'

function renderHero(options: {
  route?: 'chat' | 'claw'
  ready?: boolean
  hasWorkspace?: boolean
  runtimeError?: string | null
  codeHome?: boolean
  workspaceRoot?: string
} = {}): string {
  return renderToStaticMarkup(
    createElement(MessageTimelineEmptyHero, {
      route: options.route ?? 'chat',
      ready: options.ready ?? true,
      hasWorkspace: options.hasWorkspace ?? true,
      runtimeError: options.runtimeError ?? null,
      activeClawChannel: null,
      codeHome: options.codeHome ?? (options.route ?? 'chat') === 'chat',
      workspaceRoot: options.workspaceRoot ?? '/root/projects/demo-app',
      onPickWorkspace: () => undefined,
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

  it('falls back to the generic intro when no workspace root is available', () => {
    const html = renderHero({ workspaceRoot: '' })

    expect(html).toContain('Developer workbench')
    expect(html).toContain('Start your next development task')
    expect(html).not.toContain('Current project')
    // 卡片区照常可用
    expect(html).toContain('code-starter-deck')
  })

  it('keeps the standalone collapsed heatmap for non-code hosts (write/sdd panels)', () => {
    // write/sdd 助手面板复用 MessageTimeline 时 store route !== 'chat'，
    // 不渲染开发者工作台，维持原独立热力图空态形态。
    const html = renderHero({ codeHome: false })

    expect(html).toContain('Expand calendar')
    expect(html).not.toContain('code-home-workbench')
    expect(html).not.toContain('code-starter-deck')
    expect(html).not.toContain('ds-brand-hero-compact')
    // 独立形态保留自带 BrandHero hero 区
    expect(html).toContain('ds-brand-hero')
  })

  it('keeps offline, missing-workspace, and Claw empty states gated away from the workbench', () => {
    const offlineHtml = renderHero({ ready: false })
    expect(offlineHtml).toContain('Claude360 Copilot is waking the local agent')
    // 61de212 起离线唤醒页以动态文字品牌 BrandHero 替代 Kun 图形（sleep 态已移除）。
    expect(offlineHtml).toContain('ds-brand-hero')
    expect(offlineHtml).not.toContain('code-starter-deck')
    const workspaceHtml = renderHero({ hasWorkspace: false })
    expect(workspaceHtml).toContain('Choose working directory')
    expect(workspaceHtml).toContain('ds-kun-state-sit')
    expect(workspaceHtml).not.toContain('code-starter-deck')
    const clawHtml = renderHero({ route: 'claw' })
    expect(clawHtml).toContain('Start a conversation with this assistant')
    expect(clawHtml).toContain('ds-kun-state-greet')
    expect(clawHtml).not.toContain('Agent usage')
    expect(clawHtml).not.toContain('code-starter-deck')
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

  it('renders the generic Chinese intro without a workspace root', () => {
    const html = renderHero({ workspaceRoot: '' })

    expect(html).toContain('开发者工作台')
    expect(html).toContain('开始你的开发任务')
  })
})
