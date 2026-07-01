import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Claude360TokenListItem, Claude360TokenPurpose } from '@shared/claude360'
import {
  GroupKeysTable,
  GroupListItem,
  flattenGroups,
  type GroupSummary
} from './settings-section-groups-keys'

// 本页文案的最小 mock：t 直接回退到 key 名，参数用 {{count}} 占位替换，
// 以便断言「×N」倍率与「N 个 Key」这类带参文案。
const labels: Record<string, string> = {
  groupsKeysRecommended: 'Recommended',
  groupsKeysRatioLabel: 'Ratio',
  groupsKeysKeyCount: '{{count}} keys',
  groupsKeysModelsTitle: 'Available models',
  groupsKeysKeysTitle: 'API keys',
  groupsKeysKeysEmptyTitle: 'No API keys in this group',
  groupsKeysKeysEmptyHint: 'Click Create key to add the first one.',
  groupsKeysCreate: 'Create key',
  groupsKeysCreating: 'Creating…',
  groupsKeysColName: 'Name',
  groupsKeysColKey: 'Key',
  groupsKeysColQuota: 'Quota',
  groupsKeysColActions: 'Actions',
  groupsKeysQuotaUnlimited: 'Unlimited',
  groupsKeysReveal: 'Reveal key',
  groupsKeysHide: 'Hide key',
  groupsKeysCopy: 'Copy key',
  groupsKeysDelete: 'Delete key'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{{${name}}}`
  )
}

function group(overrides: Partial<GroupSummary> = {}): GroupSummary {
  return {
    name: 'vip-group',
    recommended: false,
    ratio: 0.8,
    desc: 'fast lane',
    ...overrides
  }
}

function token(overrides: Partial<Claude360TokenListItem> = {}): Claude360TokenListItem {
  return {
    id: 1,
    name: 'prod-key',
    maskedKey: 'sk-****abcd',
    status: 1,
    group: 'vip-group',
    remainQuota: 12345,
    unlimitedQuota: false,
    ...overrides
  }
}

// ── flattenGroups：'all' 合并去重，其余按 purpose 过滤 ──
describe('flattenGroups', () => {
  const byPurpose: Record<Claude360TokenPurpose, GroupSummary[]> = {
    text: [group({ name: 'auto' }), group({ name: 'shared' })],
    image: [group({ name: 'image-hd' }), group({ name: 'shared' })],
    music: [group({ name: 'suno' })]
  }

  it('returns only the requested purpose when filtered', () => {
    expect(flattenGroups(byPurpose, 'image').map((g) => g.name)).toEqual(['image-hd', 'shared'])
    expect(flattenGroups(byPurpose, 'music').map((g) => g.name)).toEqual(['suno'])
  })

  it('merges all purposes and de-duplicates by name for "all"', () => {
    // 'shared' appears in both text and image but must show up once.
    expect(flattenGroups(byPurpose, 'all').map((g) => g.name)).toEqual([
      'auto',
      'shared',
      'image-hd',
      'suno'
    ])
  })

  it('returns an empty list when groups are not loaded yet', () => {
    expect(flattenGroups(null, 'all')).toEqual([])
  })
})

// ── GroupListItem：倍率 ×N 与推荐徽章 ──
describe('GroupListItem', () => {
  function renderItem(props: Partial<Parameters<typeof GroupListItem>[0]> = {}): string {
    return renderToStaticMarkup(
      createElement(GroupListItem, {
        group: group(),
        keyCount: 2,
        selected: false,
        onSelect: () => undefined,
        t,
        ...props
      })
    )
  }

  it('renders the ratio as ×N', () => {
    expect(renderItem({ group: group({ ratio: 0.8 }) })).toContain('×0.8')
  })

  it('falls back to ×1.0 when ratio is null', () => {
    expect(renderItem({ group: group({ ratio: null }) })).toContain('×1.0')
  })

  it('shows the recommended badge only when recommended', () => {
    expect(renderItem({ group: group({ recommended: true }) })).toContain('Recommended')
    expect(renderItem({ group: group({ recommended: false }) })).not.toContain('Recommended')
  })

  it('renders the per-group key count', () => {
    expect(renderItem({ keyCount: 3 })).toContain('3 keys')
  })
})

// ── GroupKeysTable：脱敏/reveal、复制、删除、空态 ──
describe('GroupKeysTable', () => {
  function render(props: Partial<Parameters<typeof GroupKeysTable>[0]> = {}): string {
    return renderToStaticMarkup(
      createElement(GroupKeysTable, {
        keys: [token()],
        revealed: {},
        creating: false,
        onReveal: () => undefined,
        onCopy: () => undefined,
        onDelete: () => undefined,
        onCreate: () => undefined,
        t,
        ...props
      })
    )
  }

  it('masks the key by default and never leaks plaintext', () => {
    const html = render()
    expect(html).toContain('sk-****abcd')
    expect(html).not.toContain('sk-plaintext-secret')
  })

  it('shows plaintext only for tokens explicitly revealed and exposes copy', () => {
    const masked = render({ revealed: {} })
    expect(masked).not.toContain('sk-plaintext-secret')
    const shown = render({ revealed: { 1: 'sk-plaintext-secret' } })
    expect(shown).toContain('sk-plaintext-secret')
    expect(shown).toContain('Copy key')
  })

  it('renders quota: unlimited label vs numeric remaining', () => {
    expect(render({ keys: [token({ unlimitedQuota: true })] })).toContain('Unlimited')
    expect(render({ keys: [token({ unlimitedQuota: false, remainQuota: 12345 })] })).toContain('12,345')
  })

  it('always renders reveal and delete buttons per row', () => {
    const html = render()
    expect(html).toContain('Reveal key')
    expect(html).toContain('Delete key')
  })

  it('renders an empty state with hint when the group has no keys', () => {
    const html = render({ keys: [] })
    expect(html).toContain('No API keys in this group')
    expect(html).toContain('Click Create key to add the first one.')
  })

  it('invokes onReveal with the token id when reveal is clicked', () => {
    const onReveal = vi.fn()
    const tree = GroupKeysTable({
      keys: [token({ id: 42 })],
      revealed: {},
      creating: false,
      onReveal,
      onCopy: () => undefined,
      onDelete: () => undefined,
      onCreate: () => undefined,
      t
    })
    findClickByAriaLabel(tree, 'Reveal key')?.()
    expect(onReveal).toHaveBeenCalledWith(42)
  })

  it('invokes onCopy with the token id and plaintext so it can be cleared', () => {
    const onCopy = vi.fn()
    const tree = GroupKeysTable({
      keys: [token({ id: 7 })],
      revealed: { 7: 'sk-plain-7' },
      creating: false,
      onReveal: () => undefined,
      onCopy,
      onDelete: () => undefined,
      onCreate: () => undefined,
      t
    })
    findClickByAriaLabel(tree, 'Copy key')?.()
    expect(onCopy).toHaveBeenCalledWith(7, 'sk-plain-7')
  })

  it('invokes onDelete with the token id when delete is clicked', () => {
    const onDelete = vi.fn()
    const tree = GroupKeysTable({
      keys: [token({ id: 9 })],
      revealed: {},
      creating: false,
      onReveal: () => undefined,
      onCopy: () => undefined,
      onDelete,
      onCreate: () => undefined,
      t
    })
    findClickByAriaLabel(tree, 'Delete key')?.()
    expect(onDelete).toHaveBeenCalledWith(9)
  })

  it('exposes a create button that calls onCreate', () => {
    const onCreate = vi.fn()
    const tree = GroupKeysTable({
      keys: [],
      revealed: {},
      creating: false,
      onReveal: () => undefined,
      onCopy: () => undefined,
      onDelete: () => undefined,
      onCreate,
      t
    })
    findClickByText(tree, 'Create key')?.()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})

// ── 在 React element 树里按 aria-label / 文本找到 onClick ──
type AnyElement = {
  props?: {
    onClick?: () => void
    'aria-label'?: string
    children?: unknown
    [key: string]: unknown
  }
}

function eachChild(node: unknown, visit: (el: AnyElement) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child) => eachChild(child, visit))
    return
  }
  const el = node as AnyElement
  if (el.props) {
    visit(el)
    eachChild(el.props.children, visit)
    // Some primitives pass elements through non-children props (e.g. the
    // section's `action` slot holds the create button), so walk those too.
    eachChild(el.props.action, visit)
    eachChild(el.props.title, visit)
  }
}

function findClickByAriaLabel(root: unknown, label: string): (() => void) | undefined {
  let found: (() => void) | undefined
  eachChild(root, (el) => {
    if (!found && el.props?.['aria-label'] === label && typeof el.props.onClick === 'function') {
      found = el.props.onClick
    }
  })
  return found
}

function collectText(node: unknown, out: string[]): void {
  if (node == null) return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out))
    return
  }
  const el = node as AnyElement
  if (el.props) collectText(el.props.children, out)
}

function findClickByText(root: unknown, text: string): (() => void) | undefined {
  let found: (() => void) | undefined
  eachChild(root, (el) => {
    if (found || typeof el.props?.onClick !== 'function') return
    const out: string[] = []
    collectText(el.props.children, out)
    if (out.join('').includes(text)) found = el.props.onClick
  })
  return found
}
