import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'

// t 返回 i18n key 本身,便于按 key 断言入口是否渲染。
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh' }
  })
}))

// Sidebar 通过 useChatStore selector 读取运行时状态;这里注入最小可用默认值。
const storeState: Record<string, unknown> = {
  workspaceRoot: '',
  conversationWorkspaceRoot: '',
  codeWorkspaceRoots: [],
  chooseWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  busy: false,
  watchTurnCompletion: {},
  unreadThreadIds: {},
  clawChannels: [],
  activeClawChannelId: '',
  selectClawChannel: vi.fn(),
  addClawChannel: vi.fn(),
  deleteClawChannel: vi.fn(),
  resetClawChannelSession: vi.fn()
}
vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState)
}))

// 隔离重型子组件,聚焦 Sidebar 主入口区的可见性断言。
vi.mock('./SidebarProjectsSection', () => ({
  SidebarProjectsSection: () => createElement('div', { 'data-testid': 'projects-section' })
}))
vi.mock('./SidebarConversationsSection', () => ({
  SidebarConversationsSection: () => createElement('div', { 'data-testid': 'conversations-section' })
}))
vi.mock('./SidebarClaw', () => ({
  ClawSidebarContent: () => createElement('div', { 'data-testid': 'claw-content' })
}))
vi.mock('./SidebarClawDialog', () => ({
  ClawAddImDialog: () => createElement('div', { 'data-testid': 'claw-dialog' })
}))
vi.mock('./ConnectPhoneView', () => ({
  ConnectPhoneSidebarPanel: () => createElement('div', { 'data-testid': 'connect-phone-panel' })
}))

import { Sidebar } from './Sidebar'

function renderSidebar(overrides?: Partial<Parameters<typeof Sidebar>[0]>): string {
  const threads: NormalizedThread[] = []
  return renderToStaticMarkup(
    createElement(Sidebar, {
      threads,
      activeThreadId: null,
      activeView: 'chat',
      connectPhoneSidebarOpen: false,
      pluginsActive: false,
      runtimeReady: true,
      threadSearch: '',
      showArchivedThreads: false,
      onThreadSearchChange: vi.fn(),
      onSelectThread: vi.fn(),
      onRenameThread: vi.fn(async () => undefined),
      onPinThread: vi.fn(async () => undefined),
      onArchiveThread: vi.fn(async () => undefined),
      onDeleteThread: vi.fn(async () => undefined),
      onRestoreThread: vi.fn(async () => undefined),
      onNewChat: vi.fn(),
      onNewChatInWorkspace: vi.fn(),
      onNewRequirement: vi.fn(),
      onOpenRequirementDraft: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenPlugins: vi.fn(),
      onOpenMy: vi.fn(),
      myActive: false,
      onOpenCanvas: vi.fn(),
      onOpenMusic: vi.fn(),
      onOpenCanvasWorkflows: vi.fn(),
      canvasWorkflowsActive: false,
      canvasActive: false,
      musicActive: false,
      conversationActive: false,
      onOpenConversation: vi.fn(),
      onToggleTheme: vi.fn(),
      onToggleConnectPhone: vi.fn(),
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onScheduleOpen: vi.fn(),
      onWorkflowOpen: vi.fn(),
      onNewConversation: vi.fn(),
      ...overrides
    })
  )
}

describe('Sidebar 第一阶段入口可见性(plan-04 Task5)', () => {
  it('展示「我的」入口', () => {
    const html = renderSidebar()
    expect(html).toContain('myPage')
  })

  it('展示新增的生图(Canvas)/音乐(Music)入口', () => {
    const html = renderSidebar()
    expect(html).toContain('canvas')
    expect(html).toContain('music')
  })

  it('展示第一阶段可见主入口 Chat/Write 相关新建入口', () => {
    const html = renderSidebar()
    // 新建会话入口(Chat)。
    expect(html).toContain('newAgent')
  })

  it('隐藏 plugins/schedule/workflow 入口(保留 handler,只隐藏可见入口)', () => {
    const html = renderSidebar()
    expect(html).not.toContain('>插件<')
    expect(html).not.toContain('plugins')
    expect(html).not.toContain('schedule')
    expect(html).not.toContain('workflow')
  })

  it('底部不展示连接手机(Claw)入口', () => {
    const html = renderSidebar()
    // 隐藏后 footer 不再出现 claw 入口文案。
    expect(html).not.toContain('>claw<')
  })

  it('不渲染 SidebarMascot(P2 已移除小鸟层)', () => {
    const html = renderSidebar()
    expect(html).not.toContain('ds-sidebar-mascot')
    expect(html).not.toContain('SidebarMascot')
  })
})

describe('Sidebar 信息架构分区(07-11 重构)', () => {
  it('Code 视图:区3 渲染新建会话/新建需求,区4 仅项目区块(对话区块已上移为一级视图)', () => {
    const html = renderSidebar()
    expect(html).toContain('currentActions')
    expect(html).toContain('newAgent')
    expect(html).toContain('sddNewRequirement')
    expect(html).toContain('projects-section')
    expect(html).not.toContain('conversations-section')
  })

  it('一级入口含第 5 项「对话」,Code 视图下选中态单值互斥', () => {
    const html = renderSidebar()
    expect(html).toContain('>conversation</span>')
    expect(html.match(/role="tab"/g)?.length).toBe(5)
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
  })

  it('对话视图:区3 渲染新建对话,区4 仅对话区块(项目区块不渲染)', () => {
    const html = renderSidebar({ conversationActive: true })
    expect(html).toContain('newConversation')
    expect(html).not.toContain('newAgent')
    expect(html).toContain('conversations-section')
    expect(html).not.toContain('projects-section')
  })

  it('生图页:区3 仅新建生图任务/创作工作流两项,区4 flex 占位固定 footer', () => {
    const html = renderSidebar({ canvasActive: true })
    expect(html).toContain('newCanvasTask')
    expect(html).toContain('canvasWorkflowPanelTitle')
    // 07-12 生图 IA 重构:「新建工作流」入口删除(与「创作工作流」语义重复,
    // 新建能力收进工作流管理视图内部)。
    expect(html).not.toContain('canvasWorkflowCreateBlank')
    expect(html).not.toContain('newAgent')
    expect(html).not.toContain('projects-section')
    expect(html).not.toContain('conversations-section')
    // 区4 弹性占位:保证「我的/设置」footer 不上移(07-12 统一三段布局)。
    expect(html).toContain('sidebar-flex-spacer')
  })

  it('生图页:二级入口互斥 accent 选中态跟随视图(min-h-[46px]=accent 变体)', () => {
    // 生成工作台视图:新建生图任务 accent,创作工作流 flat。
    const generateHtml = renderSidebar({ canvasActive: true, canvasWorkflowsActive: false })
    const taskBtn = generateHtml.split('<button').find((chunk) => chunk.includes('newCanvasTask'))
    const flowBtn = generateHtml
      .split('<button')
      .find((chunk) => chunk.includes('canvasWorkflowPanelTitle'))
    expect(taskBtn).toContain('min-h-[46px]')
    expect(flowBtn).toContain('min-h-[34px]')
    // 工作流管理视图:accent 互换,任意时刻恰一枚高亮。
    const workflowsHtml = renderSidebar({ canvasActive: true, canvasWorkflowsActive: true })
    const taskBtn2 = workflowsHtml.split('<button').find((chunk) => chunk.includes('newCanvasTask'))
    const flowBtn2 = workflowsHtml
      .split('<button')
      .find((chunk) => chunk.includes('canvasWorkflowPanelTitle'))
    expect(taskBtn2).toContain('min-h-[34px]')
    expect(flowBtn2).toContain('min-h-[46px]')
  })

  it('音乐页:区3 仅新建音乐任务,区4 flex 占位固定 footer', () => {
    const html = renderSidebar({ musicActive: true })
    expect(html).toContain('newMusicTask')
    expect(html).not.toContain('newAgent')
    expect(html).not.toContain('projects-section')
    expect(html).not.toContain('conversations-section')
    expect(html).toContain('sidebar-flex-spacer')
  })

  it('claw 视图:无区3 当前操作,内容为 Claw 面板(现状保持)', () => {
    const html = renderSidebar({ activeView: 'claw' })
    expect(html).not.toContain('currentActions')
    expect(html).not.toContain('newAgent')
    expect(html).toContain('claw-content')
  })
})
