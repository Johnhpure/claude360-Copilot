import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode, Ref } from 'react'

/**
 * WorkbenchShell —— 工作台壳层 Pattern（父任务 design §5；阶段2 从
 * Workbench.tsx 巨石中抽出，DOM 结构与类名逐字保留，零视觉回归）。
 *
 * 职责：侧栏列（可拖宽）+ 垂直分隔条 + 主区框架。
 * 受控纯展示组件：拖宽状态/折叠状态由调用方持有（Workbench 既有 hook），
 * 方便后续阶段其他页面复用同一壳。
 *
 * 用法（Workbench 接壳后的形态）：
 * ```tsx
 * <WorkbenchShell
 *   shellRef={shellRef}
 *   sidebar={collapsed ? null : <Sidebar … />}   // null = 折叠（不渲染侧栏列+分隔条）
 *   sidebarWidth={leftSidebarWidth}
 *   onSidebarResizeStart={beginLeftResize}
 *   mainClassName={route === 'plugins' ? 'px-0' : ''}
 *   afterMain={<WorkflowRunPanel />}             // main 之后的兄弟浮层
 * >
 *   {routeContent}
 * </WorkbenchShell>
 * ```
 */
type WorkbenchShellProps = {
  shellRef?: Ref<HTMLDivElement>
  /** 侧栏内容；传 null 表示折叠态（侧栏列与分隔条一并不渲染） */
  sidebar: ReactNode
  /** 侧栏像素宽（拖宽状态由调用方持有） */
  sidebarWidth: number
  /** 分隔条 pointerdown（开始拖宽） */
  onSidebarResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void
  /** 追加到 <main> 的类（如 plugins 路由的 px-0） */
  mainClassName?: string
  /** 主区内容（路由分发结果） */
  children: ReactNode
  /** <main> 之后的兄弟节点（全局浮层/面板） */
  afterMain?: ReactNode
}

export function WorkbenchShell({
  shellRef,
  sidebar,
  sidebarWidth,
  onSidebarResizeStart,
  mainClassName = '',
  children,
  afterMain
}: WorkbenchShellProps): ReactElement {
  return (
    <div
      ref={shellRef}
      className="ds-workbench-shell ds-drag flex h-full min-h-0 w-full min-w-0 bg-ds-main"
    >
      {sidebar != null ? (
        <>
          <div className="min-h-0 shrink-0" style={{ width: sidebarWidth }}>
            {sidebar}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
            onPointerDown={onSidebarResizeStart}
          />
        </>
      ) : null}

      <main
        className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${mainClassName}`}
      >
        {children}
      </main>
      {afterMain}
    </div>
  )
}
