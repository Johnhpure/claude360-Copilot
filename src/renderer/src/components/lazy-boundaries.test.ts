import { describe, expect, it } from 'vitest'
// 懒边界守护（07-14-renderer-lazy-loading）：沿用 chat-store-navigation-actions.test.ts
// 的 ?raw 接线断言惯例——node 里整体渲染重型宿主组件不现实，故：
// 1) 断言懒加载目标模块可用；2) ?raw 内联源码断言接线与 CSS 归属。
import WorkbenchSource from './Workbench.tsx?raw'
import SidebarSource from './chat/Sidebar.tsx?raw'
import DocumentPaneSource from './write/WriteWorkspaceDocumentPane.tsx?raw'
import MainSource from '../main.tsx?raw'
import I18nSource from '../i18n.ts?raw'
import WorkflowEditorViewSource from './workflow/WorkflowEditorView.tsx?raw'
import WorkflowRunPanelSource from './workflow/WorkflowRunPanel.tsx?raw'
import WriteRichEditorSource from '../write/tiptap/WriteRichEditor.tsx?raw'

describe('renderer 首屏懒边界接线（07-14 R2/R3/R4）', () => {
  it('Workbench 懒加载 SideConversationPanel（react-markdown 链不进首屏 chunk）', async () => {
    expect(WorkbenchSource).toContain("import('./chat/SideConversationPanel')")
    expect(WorkbenchSource).not.toMatch(/import \{ SideConversationPanel \} from/)
    const mod = await import('./chat/SideConversationPanel')
    expect(typeof mod.SideConversationPanel).toBe('function')
  })

  it('Sidebar 懒加载二维码消费点（ClawAddImDialog / ConnectPhoneSidebarPanel）', async () => {
    expect(SidebarSource).toContain("import('./SidebarClawDialog')")
    expect(SidebarSource).toContain("import('./ConnectPhoneView')")
    expect(SidebarSource).not.toMatch(/import \{ ClawAddImDialog \} from/)
    expect(SidebarSource).not.toMatch(/import \{ ConnectPhoneSidebarPanel \} from/)
    const dialog = await import('./chat/SidebarClawDialog')
    const phone = await import('./chat/ConnectPhoneView')
    expect(typeof dialog.ClawAddImDialog).toBe('function')
    expect(typeof phone.ConnectPhoneSidebarPanel).toBe('function')
  })

  it('WriteWorkspaceDocumentPane 懒加载 WritePdfViewer（pdfjs 用时才拉）', () => {
    expect(DocumentPaneSource).toContain("import('./WritePdfViewer')")
    expect(DocumentPaneSource).not.toMatch(/import \{ WritePdfViewer \} from/)
    // 不做模块可用性断言：pdfjs-dist 依赖 DOMMatrix 等浏览器 API，node 环境无法加载
    // （这也是仓库一直没有 WritePdfViewer 直接渲染测试的原因）。
  })

  it('main.tsx 不再静态引入非首屏场景 CSS（xyflow / workflow-canvas / write-rich-editor）', () => {
    expect(MainSource).not.toContain('@xyflow/react/dist/style.css')
    expect(MainSource).not.toContain('./styles/workflow-canvas.css')
    expect(MainSource).not.toContain('./styles/write-rich-editor.css')
    // 首屏/全局 CSS 保留在入口。
    expect(MainSource).toContain('./styles/base-shell.css')
    expect(MainSource).toContain('./styles/write-editor.css')
  })

  it('移出的场景 CSS 由懒 chunk 组件承接（且库样式先于皮肤，保持覆盖顺序）', () => {
    for (const source of [WorkflowEditorViewSource, WorkflowRunPanelSource]) {
      expect(source).toContain("import '@xyflow/react/dist/style.css'")
      expect(source).toContain("import '../../styles/workflow-canvas.css'")
      // 库全量样式必须先于自定义皮肤 import，否则 --ds-* re-theme 覆盖失效。
      expect(source.indexOf('@xyflow/react/dist/style.css')).toBeLessThan(
        source.indexOf('../../styles/workflow-canvas.css')
      )
    }
    expect(WriteRichEditorSource).toContain("import '../../styles/write-rich-editor.css'")
  })

  it('i18n 仅静态内嵌 zh：en 语言包必须走动态 import', () => {
    expect(I18nSource).toMatch(/import zhCommon from '\.\/locales\/zh\/common\.json'/)
    expect(I18nSource).not.toMatch(/import \w+ from '\.\/locales\/en\//)
    expect(I18nSource).toContain("import('./locales/en/common.json')")
    expect(I18nSource).toContain("import('./locales/en/settings.json')")
  })
})
