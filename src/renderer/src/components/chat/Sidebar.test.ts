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
vi.mock('./WorkspaceModeTabs', () => ({
  WorkspaceModeTabs: () => createElement('div', { 'data-testid': 'mode-tabs' })
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
      canvasActive: false,
      musicActive: false,
      onToggleTheme: vi.fn(),
      focusModeEnabled: false,
      onFocusModeChange: vi.fn(),
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
