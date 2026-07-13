import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONVERSATION_WORKSPACE_ROOT,
  defaultConversationWorkspaceRoot,
  isConversationWorkspacePath,
  isNoProjectWorkspace
} from './workspace-path'

describe('defaultConversationWorkspaceRoot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses ~/Documents/Claude360 Copilot on macOS', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin' } })
    expect(defaultConversationWorkspaceRoot()).toBe('~/Documents/Claude360 Copilot')
  })

  it('uses ~/.local/share/Claude360 Copilot/conversations on Linux', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'linux' } })
    expect(defaultConversationWorkspaceRoot()).toBe('~/.local/share/Claude360 Copilot/conversations')
  })

  it('falls back to ~/Documents/Claude360 Copilot when platform is unknown', () => {
    vi.stubGlobal('window', { kunGui: { platform: '' } })
    expect(defaultConversationWorkspaceRoot()).toBe('~/Documents/Claude360 Copilot')
  })

  it('DEFAULT_CONVERSATION_WORKSPACE_ROOT resolves at import time from the platform', () => {
    expect(typeof DEFAULT_CONVERSATION_WORKSPACE_ROOT).toBe('string')
    expect(DEFAULT_CONVERSATION_WORKSPACE_ROOT.length).toBeGreaterThan(0)
  })
})

describe('isConversationWorkspacePath', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('matches a path directly under the conversation root', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/Documents/Kun/20260626-153012', '~/Documents/Kun')).toBe(true)
  })

  it('matches the conversation root itself', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/Documents/Kun', '~/Documents/Kun')).toBe(true)
  })

  it('expands ~ in the candidate path', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('~/Documents/Kun/sub', '~/Documents/Kun')).toBe(true)
  })

  it('does not match a sibling that merely shares a prefix segment', () => {
    // /Users/alice/Documents/Kun-other 必须不被当成对话目录,否则会误伤真实项目。
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/Documents/Kun-other', '~/Documents/Kun')).toBe(false)
  })

  it('does not match a path outside the conversation root', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('/Users/alice/projects/app', '~/Documents/Kun')).toBe(false)
  })

  it('handles backslash separators (Windows)', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'win32', homeDir: 'C:\\Users\\alice' } })
    expect(isConversationWorkspacePath('C:\\Users\\alice\\Documents\\Kun\\20260626-153012', '~/Documents/Kun')).toBe(true)
    expect(isConversationWorkspacePath('C:\\Users\\alice\\Documents\\Kun-other', '~/Documents/Kun')).toBe(false)
  })

  it('returns false for empty input', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    expect(isConversationWorkspacePath('', '~/Documents/Kun')).toBe(false)
  })

  it('falls back to the platform default when no root is given', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'linux', homeDir: '/home/alice' } })
    expect(
      isConversationWorkspacePath('/home/alice/.local/share/Claude360 Copilot/conversations/20260626-153012')
    ).toBe(true)
  })
})

describe('isNoProjectWorkspace', () => {
  it('treats empty and whitespace-only paths as no project', () => {
    expect(isNoProjectWorkspace('')).toBe(true)
    expect(isNoProjectWorkspace('   ')).toBe(true)
  })

  it('treats the default workspace (tilde form) as no project', () => {
    expect(isNoProjectWorkspace('~/Claude360 Copilot/default_workspace')).toBe(true)
  })

  it('treats the expanded default workspace path as no project', () => {
    // 主进程 normalize 会把 ~ 展开成绝对路径,渲染层拿到的是这种形态。
    expect(isNoProjectWorkspace('/root/Claude360 Copilot/default_workspace')).toBe(true)
    expect(isNoProjectWorkspace('/Users/alice/Claude360 Copilot/default_workspace/')).toBe(true)
  })

  it('treats legacy default workspace paths as no project', () => {
    expect(isNoProjectWorkspace('~/.kun/default_workspace')).toBe(true)
    expect(isNoProjectWorkspace('~/.deepseekgui/default_workspace')).toBe(true)
    expect(isNoProjectWorkspace('/home/alice/.kun/default_workspace')).toBe(true)
  })

  it('handles backslash separators (Windows)', () => {
    expect(isNoProjectWorkspace('C:\\Users\\alice\\Claude360 Copilot\\default_workspace')).toBe(true)
  })

  it('keeps real project paths as opened projects', () => {
    expect(isNoProjectWorkspace('/root/projects/demo-app')).toBe(false)
    expect(isNoProjectWorkspace('~/projects/demo-app')).toBe(false)
    // 名字里恰好含 default_workspace 的兄弟目录不能误伤。
    expect(isNoProjectWorkspace('/root/projects/default_workspace_backup')).toBe(false)
  })
})
