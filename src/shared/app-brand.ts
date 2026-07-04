export const APP_PRODUCT_NAME = 'Claude360 Copilot'
export const APP_HOME_DIR_NAME = APP_PRODUCT_NAME

export const DEFAULT_CODE_WORKSPACE_ROOT = `~/${APP_HOME_DIR_NAME}/default_workspace`
export const DEFAULT_WRITE_WORKSPACE_ROOT = `~/${APP_HOME_DIR_NAME}/write_workspace`
export const DEFAULT_RUNTIME_DATA_DIR = `~/${APP_HOME_DIR_NAME}/data`
export const DEFAULT_CLAW_CHANNELS_ROOT = `~/${APP_HOME_DIR_NAME}/claw`
export const DEFAULT_MANAGED_WORKTREE_ROOT = `~/${APP_HOME_DIR_NAME}/worktrees`

export const LEGACY_DEFAULT_CODE_WORKSPACE_ROOTS = [
  '~/.kun/default_workspace',
  '~/.deepseekgui/default_workspace'
] as const

export const LEGACY_DEFAULT_WRITE_WORKSPACE_ROOTS = [
  '~/.kun/write_workspace',
  '~/.deepseekgui/write_workspace'
] as const

export const LEGACY_DEFAULT_RUNTIME_DATA_DIRS = [
  '~/.kun/data',
  '~/.deepseekgui/kun',
  '~/.deepseekgui/coreagent'
] as const

export const LEGACY_DEFAULT_CLAW_CHANNELS_ROOTS = [
  '~/.kun/claw',
  '~/.deepseekgui/claw'
] as const

export const LEGACY_DEFAULT_CONVERSATION_WORKSPACE_ROOTS = [
  '~/Documents/Kun',
  '~/.local/share/Kun/conversations'
] as const

export function defaultConversationWorkspaceRootForPlatform(platform: string): string {
  return platform === 'linux'
    ? `~/.local/share/${APP_HOME_DIR_NAME}/conversations`
    : `~/Documents/${APP_HOME_DIR_NAME}`
}
