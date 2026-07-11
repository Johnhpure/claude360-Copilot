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
// FeatureSwitcher 为轻量纯展示组件，直接真渲染（阶段2 统一四工作台切换入口）。
vi.mock('./WriteFileTree', () => ({
  WriteFileTree: () => createElement('div', { 'data-testid': 'write-file-tree' })
}))

import { WriteSidebar } from './WriteSidebar'

function renderWriteSidebar(): string {
  return renderToStaticMarkup(
    createElement(WriteSidebar, {
      activeView: 'write',
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onOpenCanvas: vi.fn(),
      onOpenMusic: vi.fn(),
      onOpenConversation: vi.fn(),
      onOpenMy: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleTheme: vi.fn()
    })
  )
}

describe('WriteSidebar 功能入口', () => {
  it('写作页仍渲染生图(canvas)/音乐(music)/对话(conversation)入口，与 Code/写作并列', () => {
    const html = renderWriteSidebar()
    expect(html).toContain('data-testid="feature-switcher"')
    // 五个 role="tab" 按钮：Code/写作 + 生图/音乐/对话（防 aria-label 里的同名词误绿）
    expect(html.match(/role="tab"/g)?.length).toBe(5)
    expect(html).toContain('>canvas</span>')
    expect(html).toContain('>music</span>')
    expect(html).toContain('>conversation</span>')
  })

  it('写作路由下仅写作 tab 选中，生图/音乐/对话恒非选中', () => {
    const html = renderWriteSidebar()
    // activeView='write' → 只有写作 tab aria-selected="true"。
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
    expect(html.match(/aria-selected="false"/g)?.length).toBe(4)
  })

  it('区3 当前操作：新建写作/添加写作空间移入 SidebarContextActions（带小标题）', () => {
    const html = renderWriteSidebar()
    expect(html).toContain('currentActions')
    expect(html).toContain('writeCreateFile')
    expect(html).toContain('writeAddWorkspace')
  })

  it('底部统一显示我的和设置，不再显示连接手机入口', () => {
    const html = renderWriteSidebar()
    expect(html).toContain('myPage')
    expect(html).toContain('settings')
    expect(html).not.toContain('claw')
    expect(html).not.toContain('connect-phone-panel')
  })

  it('底部渲染主题切换 accessory（07-11 与 chat 侧栏对齐）', () => {
    const html = renderWriteSidebar()
    expect(html).toContain('toggleTheme')
  })
})
