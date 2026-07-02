// WriteSidebar 的功能入口可见性测试（node 环境，renderToStaticMarkup）。
// 背景 bug：写作页侧栏是独立组件，此前未渲染生图/音乐入口，导致切到写作后
// 四个功能入口只剩 Code/写作。此处锁定：四入口在写作页同样全部可见。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// t 返回 i18n key 本身，便于按 key 断言入口是否渲染。
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh' }
  })
}))

const chatState: Record<string, unknown> = {
  clawChannels: [],
  addClawChannel: vi.fn(),
  deleteClawChannel: vi.fn(),
  ensureWriteThreadForWorkspace: vi.fn(async () => 'thread-1'),
  runtimeConnection: 'ready'
}
vi.mock('../../store/chat-store', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) => selector(chatState)
}))

// write-workspace-store：保留纯路径函数，仅替换 zustand hook 为最小状态。
vi.mock('../../write/write-workspace-store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../write/write-workspace-store')>()
  const writeState: Record<string, unknown> = {
    defaultWorkspaceRoot: '',
    workspaceRoots: [],
    settingsError: '',
    workspaceRoot: '',
    rootDirectory: '',
    entriesByDir: {},
    expandedDirs: {},
    loadingDirs: {},
    treeError: '',
    activeFilePath: '',
    loadWriteSettings: vi.fn(),
    selectWriteWorkspace: vi.fn(),
    addWriteWorkspace: vi.fn(),
    removeWriteWorkspace: vi.fn(),
    toggleDirectory: vi.fn(),
    openFile: vi.fn(),
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    renameEntry: vi.fn(),
    deleteEntry: vi.fn(),
    refreshWorkspace: vi.fn(),
    setFileError: vi.fn()
  }
  return {
    ...original,
    useWriteWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector(writeState)
  }
})

// 隔离重型子组件，聚焦入口区可见性断言（与 chat/Sidebar.test.ts 同款策略）。
vi.mock('../chat/ConnectPhoneView', () => ({
  ConnectPhoneSidebarPanel: () => createElement('div', { 'data-testid': 'connect-phone-panel' })
}))
vi.mock('./WriteFileTree', () => ({
  WriteFileTree: () => createElement('div', { 'data-testid': 'write-file-tree' })
}))
vi.mock('../chat/WorkspaceModeTabs', () => ({
  WorkspaceModeTabs: () => createElement('div', { 'data-testid': 'mode-tabs' }),
  sidebarSegTabsContainerClass: 'seg-container',
  sidebarSegTabClass: () => 'seg-tab',
  sidebarSegTabIconClass: () => 'seg-icon'
}))

import { WriteSidebar } from './WriteSidebar'

function renderWriteSidebar(): string {
  return renderToStaticMarkup(
    createElement(WriteSidebar, {
      activeView: 'write',
      connectPhoneSidebarOpen: false,
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onOpenCanvas: vi.fn(),
      onOpenMusic: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleConnectPhone: vi.fn()
    })
  )
}

describe('WriteSidebar 功能入口', () => {
  it('写作页仍渲染生图(canvas)/音乐(music)入口，与 Code/写作并列', () => {
    const html = renderWriteSidebar()
    expect(html).toContain('data-testid="mode-tabs"')
    // 两个 role="tab" 按钮（防 aria-label 里的同名词误绿）
    expect(html.match(/role="tab"/g)?.length).toBe(2)
    expect(html).toContain('>canvas</span>')
    expect(html).toContain('>music</span>')
  })

  it('生图/音乐入口使用与 chat 侧栏同款分段按钮样式（非选中态）', () => {
    const html = renderWriteSidebar()
    expect(html).toContain('seg-container')
    expect(html).toContain('seg-tab')
    // 写作路由下生图/音乐恒非选中。
    expect(html).not.toContain('aria-selected="true"')
  })
})
