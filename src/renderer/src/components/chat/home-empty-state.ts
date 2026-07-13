import {
  isConversationWorkspacePath,
  isNoProjectWorkspace,
  workspaceRootIdentityKey
} from '../../lib/workspace-path'
import { shouldOmitFromCodeWorkspaceRoots } from '../../lib/worktree-project-path'
import { workspaceLabelFromPath } from '../../lib/workspace-label'

/** 「未打开项目」空态里的一条最近项目（07-13-code-home-polish R2）。 */
export type RecentProjectItem = {
  /** 项目目录绝对路径（点击切换用，selectWorkspaceRoot 入参）。 */
  root: string
  /** 项目展示名（basename，与侧栏/项目切换器同源派生）。 */
  label: string
  /** 父目录名次级文案；与项目名重复或取不到时为空串（UI 不渲染）。 */
  parentDir: string
}

// 父目录展示名:与 WorkspaceProjectPicker 的 disambiguation 同思路——取路径
// 倒数第二段;与项目名重名(如 /apps/demo/demo)或位于根下一级时返回空串。
function parentDirLabel(root: string, label: string): string {
  const parts = root.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  return !parent || parent.toLowerCase() === label.toLowerCase() ? '' : parent
}

/**
 * 从 chat-store `codeWorkspaceRoots`（近似 MRU 序）派生「未打开项目」空态的
 * 最近项目列表：过滤默认工作区（含 legacy）、对话时间戳目录与 app 托管
 * worktree 路径，按工作区身份键去重，保序取前 limit 个。
 */
export function buildRecentProjectItems(
  roots: readonly string[],
  limit = 5
): RecentProjectItem[] {
  const seen = new Set<string>()
  const out: RecentProjectItem[] = []
  for (const raw of roots) {
    const root = raw?.trim() ?? ''
    if (!root) continue
    if (isNoProjectWorkspace(root)) continue
    if (isConversationWorkspacePath(root)) continue
    if (shouldOmitFromCodeWorkspaceRoots(root)) continue
    const key = workspaceRootIdentityKey(root)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const label = workspaceLabelFromPath(root)
    out.push({ root, label, parentDir: parentDirLabel(root, label) })
    if (out.length >= limit) break
  }
  return out
}
