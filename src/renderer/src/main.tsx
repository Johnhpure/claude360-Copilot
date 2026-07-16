// 必须是第一个 import:把旧品牌前缀的 localStorage 键拷贝到新前缀,
// 后面的 store 模块在 import 阶段就会读这些键。
import './lib/legacy-local-storage-migration'
import React from 'react'
import ReactDOM from 'react-dom/client'
// 首屏 CSS 优化（07-14-renderer-lazy-loading R2）：非首屏场景样式已移入对应
// 懒组件文件内 import（Vite 自动随懒 chunk 拆分，xterm.css 先例）——
// @xyflow 全量样式 + workflow-canvas.css → WorkflowEditorView/WorkflowRunPanel；
// write-rich-editor.css（tiptap 皮肤）→ write/tiptap/WriteRichEditor。
// 保留项均为首屏/全局：index(tailwind)、base-shell、ui-primitives、
// surfaces-write（含 ds-sidebar-shell/ds-stage-surface 等全局壳层类）、
// markdown-code（聊天 markdown 首屏链）、write-editor（混含 ds-drag/
// ds-user-message 等全局拖拽与聊天气泡类，不能整体移出）。
import './index.css'
import './styles/base-shell.css'
import './styles/ui-primitives.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import App from './App'
import './i18n'
import { applyCursorSpotlight } from './lib/apply-theme'
import { installCursorSpotlightTracking } from './lib/cursor-spotlight'
import { installGlobalErrorReporter } from './lib/global-error-reporter'
import { installStartupPerfFallbackReport, markStartupModuleEval } from './lib/startup-perf'

installGlobalErrorReporter()

// 启动基线（07-14-perf-baseline）：入口模块求值标记 + 上报兜底定时器。
markStartupModuleEval()
installStartupPerfFallbackReport()

document.documentElement.dataset.platform = window.kunGui?.platform ?? 'unknown'
applyCursorSpotlight(true)
installCursorSpotlightTracking()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
