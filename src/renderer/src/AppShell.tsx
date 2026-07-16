import { lazy, Suspense, useEffect, useMemo } from 'react'
import { useChatStore } from './store/chat-store'
import { supportsDesktopTitleBar, WindowsTitleBar } from './components/WindowsTitleBar'
import { RuntimeStatusBanner } from './components/RuntimeStatusBanner'
import { GroupKeyPromptModal } from './components/GroupKeyPromptModal'
import { GuiUpdatePrompt } from './components/GuiUpdatePrompt'
import { Toaster } from './components/ui'
import { applyBlurPreference, readBlurPreference } from './lib/blur-preference'
import { useCrashContextReporter } from './lib/crash-context-reporter'
import {
  markStartupFirstFrameAfterPaint,
  markStartupInteractive
} from './lib/startup-perf'
import i18n from './i18n'

const Workbench = lazy(() =>
  import('./components/Workbench').then((module) => ({ default: module.Workbench }))
)
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((module) => ({ default: module.SettingsView }))
)
const InitialSetupDialog = lazy(() =>
  import('./components/InitialSetupDialog').then((module) => ({
    default: module.InitialSetupDialog
  }))
)

function RouteFallback(): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-0 items-center justify-center bg-ds-main text-ds-muted"
    >
      <div className="flex items-center gap-2 rounded-full border border-ds-border-muted bg-ds-card px-4 py-2 text-[13px] shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
        <span>{i18n.t('loading')}</span>
      </div>
    </div>
  )
}

export default function AppShell(): React.ReactElement {
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const currentTurnId = useChatStore((s) => s.currentTurnId)
  const busy = useChatStore((s) => s.busy)
  const boot = useChatStore((s) => s.boot)
  const initialSetupOpen = useChatStore((s) => s.initialSetupOpen)
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? 'unknown' : 'unknown'
  const hasDesktopTitleBar = supportsDesktopTitleBar(platform)
  const crashContext = useMemo(() => ({
    route,
    workspaceRoot,
    activeThreadId,
    currentTurnId,
    busy,
    task: null
  }), [activeThreadId, busy, currentTurnId, route, workspaceRoot])

  useCrashContextReporter(crashContext)

  // 启动基线 R5：AppShell 挂载后双 rAF ≈ 首帧真正绘制（返回值即 cleanup）。
  useEffect(() => markStartupFirstFrameAfterPaint(), [])

  useEffect(() => {
    // 浮层 blur 偏好（阶段2 降级开关）：启动时应用一次，设置 UI 入口在阶段5。
    applyBlurPreference(readBlurPreference())
    let frame = 0
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        // 启动基线 R6：boot() resolve = 可交互（boot 内部已捕获自身错误，
        // reject 属异常路径，静默跳过标记，由 main 侧 60s partial 汇总兜底）。
        void boot()
          .then(() => markStartupInteractive())
          .catch(() => {})
      })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [boot])

  return (
    <div className={hasDesktopTitleBar ? 'ds-windows-app-frame flex h-full min-h-0 flex-col bg-ds-main' : 'flex h-full min-h-0 flex-col bg-transparent'}>
      {hasDesktopTitleBar ? <WindowsTitleBar platform={platform} /> : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <RuntimeStatusBanner />
        <Suspense fallback={<RouteFallback />}>
          {route === 'settings' ? <SettingsView /> : <Workbench />}
        </Suspense>
      </div>
      {initialSetupOpen ? (
        <Suspense fallback={null}>
          <InitialSetupDialog />
        </Suspense>
      ) : null}
      <GroupKeyPromptModal />
      <GuiUpdatePrompt />
      {/* 全局 Toast 出口（阶段2）：唯一挂载点。 */}
      <Toaster />
    </div>
  )
}
