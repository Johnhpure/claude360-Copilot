import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRecentProjectItems } from './home-empty-state'

describe('buildRecentProjectItems', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('filters default workspaces, conversation dirs, and managed worktrees', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'darwin', homeDir: '/Users/alice' } })
    const items = buildRecentProjectItems([
      '/Users/alice/Claude360 Copilot/default_workspace',
      '~/.kun/default_workspace',
      '/Users/alice/Documents/Claude360 Copilot/20260713-120000',
      '/Users/alice/Claude360 Copilot/worktrees/1a2b/demo-app',
      '/Users/alice/projects/demo-app'
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.root).toBe('/Users/alice/projects/demo-app')
  })

  it('drops empty entries and deduplicates by workspace identity key', () => {
    // 同一项目的大小写/尾斜杠变体必须归并为一条(identityKey 归一)。
    const items = buildRecentProjectItems([
      '',
      '   ',
      '/root/projects/demo-app',
      '/root/projects/demo-app/',
      '/root/Projects/Demo-App',
      '/root/projects/other-app'
    ])

    expect(items.map((item) => item.root)).toEqual([
      '/root/projects/demo-app',
      '/root/projects/other-app'
    ])
  })

  it('keeps MRU order and truncates to the limit (default 5)', () => {
    const roots = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `/root/projects/${name}`)
    const items = buildRecentProjectItems(roots)

    expect(items).toHaveLength(5)
    expect(items.map((item) => item.label)).toEqual(['a', 'b', 'c', 'd', 'e'])

    expect(buildRecentProjectItems(roots, 2)).toHaveLength(2)
  })

  it('derives label and parentDir from the path', () => {
    const [item] = buildRecentProjectItems(['/root/projects/demo-app'])
    expect(item?.label).toBe('demo-app')
    expect(item?.parentDir).toBe('projects')
  })

  it('hides parentDir when it repeats the label or the project sits at top level', () => {
    const [repeated] = buildRecentProjectItems(['/apps/demo/demo'])
    expect(repeated?.label).toBe('demo')
    expect(repeated?.parentDir).toBe('')

    const [topLevel] = buildRecentProjectItems(['/demo'])
    expect(topLevel?.label).toBe('demo')
    expect(topLevel?.parentDir).toBe('')
  })

  it('handles Windows backslash paths', () => {
    const [item] = buildRecentProjectItems(['C:\\Users\\alice\\projects\\demo-app'])
    expect(item?.label).toBe('demo-app')
    expect(item?.parentDir).toBe('projects')
  })

  it('returns an empty list for an empty input', () => {
    expect(buildRecentProjectItems([])).toEqual([])
  })
})
