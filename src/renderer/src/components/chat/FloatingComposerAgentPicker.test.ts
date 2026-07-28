import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import {
  AgentPickerView,
  buildAssistantMenuItems,
  nextAssistantMenuFocusIndex
} from './FloatingComposerAgentPicker'

beforeAll(() => setupI18nTestEnglish())

const translate = (key: string): string => `t:${key}`

function renderView(overrides: Partial<Parameters<typeof AgentPickerView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(AgentPickerView, {
    displayAgentId: '',
    onSelect: () => undefined,
    ...overrides
  }))
}

describe('buildAssistantMenuItems', () => {
  it('puts the "no assistant" entry first and lists all six builtins in catalog order', () => {
    const items = buildAssistantMenuItems(translate)
    expect(items.none.id).toBe('')
    expect(items.none.name).toBe('t:assistantNone')
    expect(items.builtins.map((item) => item.id)).toEqual([
      'builtin.official-document',
      'builtin.meeting-notes',
      'builtin.report-summary',
      'builtin.research',
      'builtin.data-analysis',
      'builtin.contract-review',
      'builtin.speech-writing',
      'builtin.rules-regulations',
      'builtin.briefing-publicity',
      'builtin.party-building'
    ])
  })

  it('never offers custom subagent profiles — personas are unrelated to AI agents', () => {
    const items = buildAssistantMenuItems(translate)
    expect(Object.keys(items).sort()).toEqual(['builtins', 'none'])
  })
})

describe('nextAssistantMenuFocusIndex', () => {
  it('cycles with arrow keys and jumps with Home/End', () => {
    expect(nextAssistantMenuFocusIndex('ArrowDown', 0, 3)).toBe(1)
    expect(nextAssistantMenuFocusIndex('ArrowDown', 2, 3)).toBe(0)
    expect(nextAssistantMenuFocusIndex('ArrowUp', 0, 3)).toBe(2)
    expect(nextAssistantMenuFocusIndex('ArrowDown', -1, 3)).toBe(0)
    expect(nextAssistantMenuFocusIndex('Home', 2, 3)).toBe(0)
    expect(nextAssistantMenuFocusIndex('End', 0, 3)).toBe(2)
    expect(nextAssistantMenuFocusIndex('Enter', 1, 3)).toBeNull()
    expect(nextAssistantMenuFocusIndex('ArrowDown', 0, 0)).toBeNull()
  })
})

describe('AgentPickerView button', () => {
  it('renders the neutral picker label when no assistant is selected (default)', () => {
    const html = renderView()
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-label="Assistant: Assistant"')
    expect(html).not.toContain('General Assistant')
    expect(html).not.toContain('disabled=""')
  })

  it('shows the selected builtin assistant name', () => {
    const html = renderView({ displayAgentId: 'builtin.official-document' })
    expect(html).toContain('Official Document Assistant')
  })

  it('shows the stable id for an unknown historical id', () => {
    const html = renderView({ displayAgentId: 'builtin.retired-assistant' })
    expect(html).toContain('builtin.retired-assistant')
  })

  it('stays enabled regardless of runtime state — switching is pure local state', () => {
    const html = renderView({ displayAgentId: 'builtin.meeting-notes' })
    expect(html).not.toContain('disabled=""')
  })

  it('keeps the full assistant name accessible in compact icon mode', () => {
    const html = renderView({ compact: true, displayAgentId: 'builtin.meeting-notes' })
    expect(html).toContain('aria-label="Assistant: Meeting Notes Assistant"')
    expect(html).not.toContain('>Meeting Notes Assistant</span>')
  })

  it('carries no legacy general-assistant or my-assistants wording', () => {
    const html = renderView()
    expect(html).not.toContain('General Assistant')
    expect(html).not.toContain('My assistants')
    expect(html).not.toContain('Manage my assistants')
  })
})
