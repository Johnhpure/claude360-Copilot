import { app } from 'electron'
import { logWarn } from './logger'

// JumpList 最近工作区（07-14-windows-native-polish R4）。win32 门控内部化：
// 非 win32 下 updateRecentWorkspacesJumpList 是纯 no-op（不触碰 electron API）。
// 数据源是 renderer localStorage 的最近工作区列表，经单向 IPC
// （workspace:report-recent）上报到 main 后在这里落成 Tasks 类目。

export const OPEN_WORKSPACE_ARG_PREFIX = '--open-workspace='

/** 任务栏 JumpList 默认展示上限约 10 项，多报无益。 */
export const MAX_JUMP_LIST_WORKSPACES = 10

/**
 * 构造 JumpListItem.args（整条命令行字符串，非数组）。路径含空格必须整体加
 * 引号——Windows 按引号把它拆回单个 argv 条目。结尾的 \\ / / 先剥掉，避免
 * `\"` 被命令行解析当成转义引号。
 */
export function openWorkspaceArg(workspaceRoot: string): string {
  const trimmed = workspaceRoot.trim().replace(/[\\/]+$/, '')
  return `${OPEN_WORKSPACE_ARG_PREFIX}"${trimmed}"`
}

/**
 * 从 argv 解析 --open-workspace=<path>。second-instance 与冷启动两条路径共用。
 * 取最后一个匹配（多个时后者胜）；防御性剥一层包裹引号（个别启动路径不拆引号）。
 */
export function parseOpenWorkspaceArgv(argv: readonly string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]
    if (typeof arg !== 'string' || !arg.startsWith(OPEN_WORKSPACE_ARG_PREFIX)) continue
    let value = arg.slice(OPEN_WORKSPACE_ARG_PREFIX.length).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
    }
    value = value.trim()
    if (value) return value
  }
  return null
}

/** 跨平台取路径末段作展示名（main 可能在测试里处理 win 风格路径）。 */
export function workspaceLeafName(workspaceRoot: string): string {
  const leaf = workspaceRoot.split(/[\\/]/).filter(Boolean).pop()
  return leaf ?? workspaceRoot
}

export type JumpListSetter = (categories: Electron.JumpListCategory[] | null) => string

export function buildRecentWorkspacesJumpListCategories(
  workspaceRoots: readonly string[],
  execPath: string
): Electron.JumpListCategory[] | null {
  const seen = new Set<string>()
  const items: Electron.JumpListItem[] = []
  for (const raw of workspaceRoots) {
    if (typeof raw !== 'string') continue
    const workspaceRoot = raw.trim().replace(/[\\/]+$/, '')
    if (!workspaceRoot || seen.has(workspaceRoot)) continue
    seen.add(workspaceRoot)
    items.push({
      type: 'task',
      title: workspaceLeafName(workspaceRoot),
      // JumpListItem.description 上限 260 字符（research/electron34-api.md §4）。
      description: workspaceRoot.slice(0, 260),
      program: execPath,
      args: openWorkspaceArg(workspaceRoot),
      iconPath: execPath,
      iconIndex: 0
    })
    if (items.length >= MAX_JUMP_LIST_WORKSPACES) break
  }
  if (items.length === 0) return null
  return [{ type: 'tasks', items }]
}

/**
 * 用最近工作区列表刷新 JumpList。失败（企业策略禁用等）只记警告不抛出。
 * 空列表 → setJumpList(null) 恢复系统默认。
 */
export function updateRecentWorkspacesJumpList(
  workspaceRoots: readonly string[],
  options: {
    platform?: NodeJS.Platform
    execPath?: string
    setJumpList?: JumpListSetter
    log?: (message: string, detail?: unknown) => void
  } = {}
): void {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return
  const execPath = options.execPath ?? process.execPath
  const setJumpList: JumpListSetter =
    options.setJumpList ?? ((categories) => app.setJumpList(categories))
  const log = options.log ?? ((message, detail) => logWarn('win-jumplist', message, detail))
  try {
    const result = setJumpList(buildRecentWorkspacesJumpListCategories(workspaceRoots, execPath))
    if (result !== 'ok') {
      log('setJumpList did not apply.', { result })
    }
  } catch (error) {
    log('Failed to set JumpList.', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
