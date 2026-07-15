import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    setJumpList: vi.fn()
  }
}))

vi.mock('./logger', () => ({
  logWarn: vi.fn()
}))

import {
  MAX_JUMP_LIST_WORKSPACES,
  buildRecentWorkspacesJumpListCategories,
  openWorkspaceArg,
  parseOpenWorkspaceArgv,
  updateRecentWorkspacesJumpList,
  workspaceLeafName
} from './win-jumplist'

describe('openWorkspaceArg', () => {
  it('quotes the path so spaces survive command-line splitting', () => {
    expect(openWorkspaceArg('C:\\My Projects\\demo')).toBe('--open-workspace="C:\\My Projects\\demo"')
  })

  it('strips trailing separators so a backslash cannot escape the closing quote', () => {
    expect(openWorkspaceArg('C:\\work\\dir\\')).toBe('--open-workspace="C:\\work\\dir"')
    expect(openWorkspaceArg('/home/user/dir/')).toBe('--open-workspace="/home/user/dir"')
  })
})

describe('parseOpenWorkspaceArgv', () => {
  it('finds the workspace argument among other argv entries', () => {
    expect(
      parseOpenWorkspaceArgv(['app.exe', '--hidden', '--open-workspace=C:\\My Projects\\demo'])
    ).toBe('C:\\My Projects\\demo')
  })

  it('returns null when absent or empty', () => {
    expect(parseOpenWorkspaceArgv(['app.exe', '--hidden'])).toBeNull()
    expect(parseOpenWorkspaceArgv([])).toBeNull()
    expect(parseOpenWorkspaceArgv(['--open-workspace='])).toBeNull()
    expect(parseOpenWorkspaceArgv(['--open-workspace=""'])).toBeNull()
  })

  it('strips one layer of wrapping quotes defensively', () => {
    expect(parseOpenWorkspaceArgv(['--open-workspace="C:\\My Projects\\demo"'])).toBe(
      'C:\\My Projects\\demo'
    )
  })

  it('uses the last occurrence when repeated', () => {
    expect(
      parseOpenWorkspaceArgv(['--open-workspace=/a', '--open-workspace=/b'])
    ).toBe('/b')
  })

  it('round-trips the value produced by openWorkspaceArg', () => {
    const arg = openWorkspaceArg('C:\\My Projects\\demo')
    expect(parseOpenWorkspaceArgv(['app.exe', arg])).toBe('C:\\My Projects\\demo')
  })
})

describe('workspaceLeafName', () => {
  it('extracts the leaf for both path styles', () => {
    expect(workspaceLeafName('C:\\work\\my-app')).toBe('my-app')
    expect(workspaceLeafName('/home/user/my-app')).toBe('my-app')
    expect(workspaceLeafName('my-app')).toBe('my-app')
  })
})

describe('buildRecentWorkspacesJumpListCategories', () => {
  it('builds a tasks category with program/args/icon per workspace', () => {
    const categories = buildRecentWorkspacesJumpListCategories(
      ['C:\\work\\alpha', 'C:\\My Projects\\beta'],
      'C:\\app\\Claude360.exe'
    )
    expect(categories).toEqual([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            title: 'alpha',
            description: 'C:\\work\\alpha',
            program: 'C:\\app\\Claude360.exe',
            args: '--open-workspace="C:\\work\\alpha"',
            iconPath: 'C:\\app\\Claude360.exe',
            iconIndex: 0
          },
          {
            type: 'task',
            title: 'beta',
            description: 'C:\\My Projects\\beta',
            program: 'C:\\app\\Claude360.exe',
            args: '--open-workspace="C:\\My Projects\\beta"',
            iconPath: 'C:\\app\\Claude360.exe',
            iconIndex: 0
          }
        ]
      }
    ])
  })

  it('dedupes, drops empties, and caps the item count', () => {
    const roots = Array.from({ length: 20 }, (_, i) => `/ws/${i}`)
    const categories = buildRecentWorkspacesJumpListCategories(
      ['', '  ', '/ws/0', ...roots],
      '/exe'
    )
    expect(categories?.[0]?.items).toHaveLength(MAX_JUMP_LIST_WORKSPACES)
    expect(categories?.[0]?.items?.[0]?.title).toBe('0')
  })

  it('returns null for an empty list (reset to system default)', () => {
    expect(buildRecentWorkspacesJumpListCategories([], '/exe')).toBeNull()
    expect(buildRecentWorkspacesJumpListCategories(['', '  '], '/exe')).toBeNull()
  })
})

describe('updateRecentWorkspacesJumpList', () => {
  it('is a no-op on non-win32 platforms', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const setJumpList = vi.fn(() => 'ok')
      updateRecentWorkspacesJumpList(['/ws/a'], { platform, setJumpList })
      expect(setJumpList).not.toHaveBeenCalled()
    }
  })

  it('passes the built categories to setJumpList on win32', () => {
    const setJumpList = vi.fn((_categories: Electron.JumpListCategory[] | null) => 'ok')
    updateRecentWorkspacesJumpList(['C:\\work\\alpha'], {
      platform: 'win32',
      execPath: 'C:\\app\\Claude360.exe',
      setJumpList
    })
    expect(setJumpList).toHaveBeenCalledTimes(1)
    const [categories] = setJumpList.mock.calls[0] ?? []
    expect(categories?.[0]?.type).toBe('tasks')
    expect(categories?.[0]?.items?.[0]?.args).toBe('--open-workspace="C:\\work\\alpha"')
  })

  it('clears the jump list with null when the list is empty', () => {
    const setJumpList = vi.fn(() => 'ok')
    updateRecentWorkspacesJumpList([], { platform: 'win32', setJumpList })
    expect(setJumpList).toHaveBeenCalledWith(null)
  })

  it('logs but does not throw on setter errors or non-ok results', () => {
    const log = vi.fn()
    updateRecentWorkspacesJumpList(['/ws/a'], {
      platform: 'win32',
      setJumpList: () => 'customCategoryAccessDeniedError',
      log
    })
    expect(log).toHaveBeenCalledTimes(1)
    updateRecentWorkspacesJumpList(['/ws/a'], {
      platform: 'win32',
      setJumpList: () => {
        throw new Error('policy blocked')
      },
      log
    })
    expect(log).toHaveBeenCalledTimes(2)
  })
})
