/**
 * PPT Master 标注自动触发：接线部分。
 *
 * 判定逻辑全在 `annotation-trigger.ts`（纯函数、有单测）；这里只负责
 * 「发现项目 → 挂目录监听 → 读日志 → 该发就发」，以及忙时排队。
 *
 * 背景见 annotation-trigger.ts 顶部注释：编辑器点「应用修改」只写磁盘，
 * 不通知 agent，用户不手打一句就等于石沉大海。
 */

import { useEffect, useRef } from 'react'
import { useChatStore } from '../../store/chat-store'
import {
  activeEditorProject,
  decideTrigger,
  triggerMessage,
  type AnnotationTrigger,
  type ToolBlockLike
} from './annotation-trigger'

const LIVE_PREVIEW_DIR = 'live_preview'
const ANNOTATION_LOG = 'annotations.jsonl'
const EDIT_LOG = 'edits.jsonl'

/** 只有这两个日志代表用户点了「应用修改」，其余（尤其 server.log）是噪声。 */
function isAnnotationLog(entry: string): boolean {
  return entry === ANNOTATION_LOG || entry === EDIT_LOG
}

async function readTextFile(path: string, workspaceRoot: string): Promise<string> {
  try {
    const result = await window.kunGui.readWorkspaceFile({ path, workspaceRoot })
    return result.ok ? result.content : ''
  } catch {
    // 文件还不存在是常态：用户提交第一条标注前 annotations.jsonl 不会被创建。
    return ''
  }
}

async function hasExportedPptx(projectPath: string, workspaceRoot: string): Promise<boolean> {
  try {
    const result = await window.kunGui.listWorkspaceDirectory({
      path: `${projectPath}/exports`,
      workspaceRoot
    })
    return (
      result.ok && result.entries.some((entry: { name: string }) => entry.name.toLowerCase().endsWith('.pptx'))
    )
  } catch {
    return false
  }
}

/**
 * 监听 SVG 编辑器的标注提交，替用户把应用指令发进当前会话。
 *
 * 在 AppShell 里调用一次即可；会话切换 / 卸载时自动解绑。
 */
export function useAnnotationWatcher(): void {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const blocks = useChatStore((s) => s.blocks)
  const busy = useChatStore((s) => s.busy)
  const activeThreadId = useChatStore((s) => s.activeThreadId)

  // 已触发过的最大 ts，避免同一批标注反复发。
  const lastHandledTsRef = useRef(0)
  // busy 期间攒下的待发触发（用户选择「排队，等空闲再发」）。
  const pendingRef = useRef<AnnotationTrigger | null>(null)
  const watchIdRef = useRef<string | null>(null)
  const watchedProjectRef = useRef<string | null>(null)

  const projectPath = activeEditorProject((blocks ?? []) as ToolBlockLike[])

  // 换会话就重置去重游标：另一个会话的标注进度与本会话无关。
  useEffect(() => {
    lastHandledTsRef.current = 0
    pendingRef.current = null
  }, [activeThreadId])

  // 挂/解目录监听。监听目录而不是 annotations.jsonl 本身，因为后者
  // 在用户提交第一条标注前并不存在，文件监听挂不上去。
  useEffect(() => {
    if (!projectPath || !workspaceRoot) return
    if (watchedProjectRef.current === projectPath && watchIdRef.current) return

    let cancelled = false
    const previousWatchId = watchIdRef.current
    watchedProjectRef.current = projectPath
    watchIdRef.current = null

    void (async () => {
      if (previousWatchId) await window.kunGui.unwatchWorkspaceFile(previousWatchId).catch(() => false)
      const result = await window.kunGui
        .watchWorkspaceDir({ path: `${projectPath}/${LIVE_PREVIEW_DIR}`, workspaceRoot })
        .catch(() => ({ ok: false as const, message: 'watch failed' }))
      if (cancelled) {
        if (result.ok) void window.kunGui.unwatchWorkspaceFile(result.watchId).catch(() => false)
        return
      }
      if (result.ok) watchIdRef.current = result.watchId
    })()

    return () => {
      cancelled = true
    }
  }, [projectPath, workspaceRoot])

  // 组件卸载时收掉监听。
  useEffect(
    () => () => {
      const watchId = watchIdRef.current
      watchIdRef.current = null
      if (watchId) void window.kunGui.unwatchWorkspaceFile(watchId).catch(() => false)
    },
    []
  )

  // 目录有变化 → 判定 → 发送（或排队）。
  useEffect(() => {
    if (!projectPath || !workspaceRoot) return

    const dispatch = (trigger: AnnotationTrigger): void => {
      lastHandledTsRef.current = trigger.ts
      pendingRef.current = null
      void useChatStore.getState().sendMessage(triggerMessage(trigger.kind))
    }

    const unsubscribe = window.kunGui.onWorkspaceDirChanged((payload) => {
      if (!payload.ok || payload.watchId !== watchIdRef.current) return
      // `server.log` 也住在 live_preview/ 里，而编辑器页面每 2 秒轮询一次
      // /api/slides、每次都写一行日志。不过滤的话这个 handler 会被日志刷成
      // 每 2 秒一轮文件读取 + 目录列举。entries 为空时（个别平台不报文件名）
      // 保守地照常处理，宁可多跑一次也不漏掉真正的提交。
      if (payload.entries.length > 0 && !payload.entries.some(isAnnotationLog)) return
      void (async () => {
        const base = `${projectPath}/${LIVE_PREVIEW_DIR}`
        const [annotationsJsonl, editsJsonl, exported] = await Promise.all([
          readTextFile(`${base}/${ANNOTATION_LOG}`, workspaceRoot),
          readTextFile(`${base}/${EDIT_LOG}`, workspaceRoot),
          hasExportedPptx(projectPath, workspaceRoot)
        ])
        const trigger = decideTrigger({
          annotationsJsonl,
          editsJsonl,
          lastHandledTs: lastHandledTsRef.current,
          hasExportedPptx: exported
        })
        if (!trigger) return
        // 回合进行中插消息会打断 agent 手头的阶段，攒到空闲再发。
        if (useChatStore.getState().busy) {
          pendingRef.current = trigger
          return
        }
        dispatch(trigger)
      })()
    })

    return unsubscribe
  }, [projectPath, workspaceRoot])

  // 回合结束 → 把排队的触发发出去。
  useEffect(() => {
    if (busy) return
    const trigger = pendingRef.current
    if (!trigger) return
    pendingRef.current = null
    lastHandledTsRef.current = trigger.ts
    void useChatStore.getState().sendMessage(triggerMessage(trigger.kind))
  }, [busy])
}
