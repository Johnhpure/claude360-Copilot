import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Claude360TokenListItem } from '@shared/claude360'
import { MyTokenGroupsTable } from './MyTokenGroupsTable'

const labels: Record<string, string> = {
  myApiKeys: 'API Key groups',
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
      onReveal: () => undefined,
      onCopy: () => undefined,
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
      onReveal,
      onCopy: () => undefined,
      t
    })
    // Walk the element tree to find the reveal button and fire its onClick.
    const revealClick = findClickByAriaLabel(dialog, 'Reveal key')
    expect(revealClick).toBeTypeOf('function')
    revealClick?.()
    expect(onReveal).toHaveBeenCalledWith(42)
  })

  it('invokes onCopy with the token id and plaintext so the container can clear it', () => {
    const onCopy = vi.fn()
    const dialog = MyTokenGroupsTable({
      tokens: [token({ id: 7 })],
      revealed: { 7: 'sk-plain-7' },
      onReveal: () => undefined,
      onCopy,
      t
    })
    const copyClick = findClickByAriaLabel(dialog, 'Copy')
    expect(copyClick).toBeTypeOf('function')
    copyClick?.()
    expect(onCopy).toHaveBeenCalledWith(7, 'sk-plain-7')
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
