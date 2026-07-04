export const APP_PRODUCT_NAME = 'Claude360 Copilot'
export const APP_HOME_DIR_NAME = APP_PRODUCT_NAME

export const DEFAULT_CODE_WORKSPACE_ROOT = `~/${APP_HOME_DIR_NAME}/default_workspace`
export const DEFAULT_WRITE_WORKSPACE_ROOT = `~/${APP_HOME_DIR_NAME}/write_workspace`
export const DEFAULT_RUNTIME_DATA_DIR = `~/${APP_HOME_DIR_NAME}/data`
export const DEFAULT_CLAW_CHANNELS_ROOT = `~/${APP_HOME_DIR_NAME}/claw`
export const DEFAULT_MANAGED_WORKTREE_ROOT = `~/${APP_HOME_DIR_NAME}/worktrees`

const LEGACY_DOT_KUN_DIR = '.kun'
const LEGACY_DEEPSEEK_HOME_DIR = '.deepseekgui'
const LEGACY_KUN_DISPLAY_DIR = 'Kun'

function legacyHomePath(...segments: string[]): string {
  return ['~', ...segments].join('/')
}

export const LEGACY_DEFAULT_CODE_WORKSPACE_ROOTS = [
  legacyHomePath(LEGACY_DOT_KUN_DIR, 'default_workspace'),
  legacyHomePath(LEGACY_DEEPSEEK_HOME_DIR, 'default_workspace')
] as const

export const LEGACY_DEFAULT_WRITE_WORKSPACE_ROOTS = [
  legacyHomePath(LEGACY_DOT_KUN_DIR, 'write_workspace'),
  legacyHomePath(LEGACY_DEEPSEEK_HOME_DIR, 'write_workspace')
] as const

export const LEGACY_DEFAULT_RUNTIME_DATA_DIRS = [
  legacyHomePath(LEGACY_DOT_KUN_DIR, 'data'),
  legacyHomePath(LEGACY_DEEPSEEK_HOME_DIR, 'kun'),
  legacyHomePath(LEGACY_DEEPSEEK_HOME_DIR, 'coreagent')
] as const

export const LEGACY_DEFAULT_CLAW_CHANNELS_ROOTS = [
  legacyHomePath(LEGACY_DOT_KUN_DIR, 'claw'),
  legacyHomePath(LEGACY_DEEPSEEK_HOME_DIR, 'claw')
] as const

export const LEGACY_DEFAULT_CONVERSATION_WORKSPACE_ROOTS = [
  legacyHomePath('Documents', LEGACY_KUN_DISPLAY_DIR),
  legacyHomePath('.local', 'share', LEGACY_KUN_DISPLAY_DIR, 'conversations')
] as const

export function defaultConversationWorkspaceRootForPlatform(platform: string): string {
  return platform === 'linux'
    ? `~/.local/share/${APP_HOME_DIR_NAME}/conversations`
    : `~/Documents/${APP_HOME_DIR_NAME}`
}
