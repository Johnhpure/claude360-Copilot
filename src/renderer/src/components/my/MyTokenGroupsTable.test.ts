import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Claude360TokenListItem } from '@shared/claude360'
import { MyTokenGroupsTable } from './MyTokenGroupsTable'

const labels: Record<string, string> = {
  myApiKeys: 'API Key groups',
  myCreateKey: 'Create key',
  myCreatingKey: 'Creating…',
  myNoApiKeys: 'No API keys yet.',
  myKeyName: 'Name',
  myKeyGroup: 'Group',
  myKeyValue: 'Key',
  myKeyQuota: 'Remaining quota',
  myKeyActions: 'Actions',
  myKeyUnlimited: 'Unlimited',
  myRevealKey: 'Reveal key',
  myCopyKey: 'Copy'
}

function t(key: string): string {
  return labels[key] ?? key
}

function token(overrides: Partial<Claude360TokenListItem> = {}): Claude360TokenListItem {
  return {
    id: 1,
    name: 'text-key',
    maskedKey: 'sk-****abcd',
    status: 1,
    group: 'default',
    remainQuota: 12345,
    unlimitedQuota: false,
    ...overrides
  }
}

function render(props: Partial<Parameters<typeof MyTokenGroupsTable>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(MyTokenGroupsTable, {
      tokens: [token()],
      revealed: {},
      creating: false,
      onReveal: () => undefined,
      onCopy: () => undefined,
      onCreate: () => undefined,
      t,
      ...props
    })
  )
}

describe('MyTokenGroupsTable', () => {
  it('masks the API key by default and never renders the plaintext', () => {
    const html = render()
    expect(html).toContain('sk-****abcd')
    // The plaintext key must not leak into the default (unrevealed) render.
    expect(html).not.toContain('sk-plaintext-secret')
  })

  it('shows plaintext only for tokens explicitly revealed via the revealed map', () => {
    const masked = render({ revealed: {} })
    expect(masked).not.toContain('sk-plaintext-secret')
    // Reveal is an explicit action: plaintext appears only once the container
    // has fetched and passed it down through `revealed`.
    const shown = render({ revealed: { 1: 'sk-plaintext-secret' } })
    expect(shown).toContain('sk-plaintext-secret')
    expect(shown).toContain('Copy')
  })

  it('invokes onReveal with the token id when reveal is clicked', () => {
    const onReveal = vi.fn()
    const dialog = MyTokenGroupsTable({
      tokens: [token({ id: 42 })],
      revealed: {},
      creating: false,
      onReveal,
      onCopy: () => undefined,
      onCreate: () => undefined,
      t
    })
    // Walk the element tree to find the reveal button and fire its onClick.
    const revealClick = findClickByAriaLabel(dialog, 'Reveal key')
    expect(revealClick).toBeTypeOf('function')
    revealClick?.()
    expect(onReveal).toHaveBeenCalledWith(42)
  })

  it('exposes a create button that calls onCreate', () => {
    const onCreate = vi.fn()
    const dialog = MyTokenGroupsTable({
      tokens: [],
      revealed: {},
      creating: false,
      onReveal: () => undefined,
      onCopy: () => undefined,
      onCreate,
      t
    })
    const createClick = findClickByText(dialog, 'Create key')
    expect(createClick).toBeTypeOf('function')
    createClick?.()
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state when there are no keys', () => {
    const html = render({ tokens: [] })
    expect(html).toContain('No API keys yet.')
  })
})

// ── 小工具:在 React element 树里按 aria-label / 文本找到 onClick ──
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
