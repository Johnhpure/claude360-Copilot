import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import {
  AgentPickerView,
  buildAssistantMenuItems,
  nextAssistantMenuFocusIndex
} from './FloatingComposerAgentPicker'

beforeAll(() => setupI18nTestEnglish())

const translate = (key: string): string => `t:${key}`

function profile(overrides: Partial<KunSubagentProfileV1> = {}): KunSubagentProfileV1 {
  return {
    id: 'custom-writer',
    enabled: true,
    name: 'My Writer',
    description: 'Careful drafting',
    mode: 'primary',
    toolPolicy: 'inherit',
    ...overrides
  }
}

function renderView(overrides: Partial<Parameters<typeof AgentPickerView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(AgentPickerView, {
    displayAgentId: '',
    profiles: [],
    profilesError: false,
    busy: false,
    hasPendingWork: false,
    onSelect: () => undefined,
    onManage: () => undefined,
    onRetryProfiles: () => undefined,
    ...overrides
  }))
}

describe('buildAssistantMenuItems', () => {
  it('puts the general assistant first and lists all six builtins in catalog order', () => {
    const items = buildAssistantMenuItems([], translate)
    expect(items.general.id).toBe('')
    expect(items.general.name).toBe('t:assistantNameGeneral')
    expect(items.builtins.map((item) => item.id)).toEqual([
      'builtin.official-document',
      'builtin.meeting-notes',
      'builtin.report-summary',
      'builtin.research',
      'builtin.data-analysis',
      'builtin.contract-review'
    ])
  })

  it('offers only resolver-eligible custom profiles', () => {
    const items = buildAssistantMenuItems([
      profile(),
      profile({ id: 'disabled-one', enabled: false }),
      profile({ id: 'subagent-only', mode: 'subagent' }),
      profile({ id: 'builtin.official-document', name: 'Namespace Squatter' })
    ], translate)

    expect(items.customs.map((item) => item.id)).toEqual(['custom-writer'])
    expect(items.customs[0]).toMatchObject({ name: 'My Writer', description: 'Careful drafting' })
  })

  it('falls back to the stable id when a profile name is blank', () => {
    const items = buildAssistantMenuItems([profile({ name: '   ' })], translate)
    expect(items.customs[0]?.name).toBe('custom-writer')
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
  it('always renders and shows the general assistant by default', () => {
    const html = renderView()
    expect(html).toContain('General Assistant')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-label="Assistant: General Assistant"')
    expect(html).not.toContain('disabled=""')
  })

  it('shows the selected builtin assistant name', () => {
    const html = renderView({ displayAgentId: 'builtin.official-document' })
    expect(html).toContain('Official Document Assistant')
  })

  it('shows the current custom profile name for a custom assistant', () => {
    const html = renderView({ displayAgentId: 'custom-writer', profiles: [profile()] })
    expect(html).toContain('My Writer')
  })

  it('shows the stable id for a deleted custom assistant instead of pretending general', () => {
    const html = renderView({ displayAgentId: 'deleted-profile' })
    expect(html).toContain('deleted-profile')
    expect(html).not.toContain('General Assistant')
  })

  it('shows the stable id for an unknown historical builtin id', () => {
    const html = renderView({ displayAgentId: 'builtin.retired-assistant' })
    expect(html).toContain('builtin.retired-assistant')
  })

  it('disables switching with an explanatory reason while a turn runs', () => {
    const html = renderView({ busy: true })
    expect(html).toContain('disabled=""')
    expect(html).toContain('A task is still running')
  })

  it('disables switching while an approval or user input is pending', () => {
    const html = renderView({ hasPendingWork: true })
    expect(html).toContain('disabled=""')
    expect(html).toContain('pending approval or input request')
  })

  it('keeps the full assistant name accessible in compact icon mode', () => {
    const html = renderView({ compact: true, displayAgentId: 'builtin.meeting-notes' })
    expect(html).toContain('aria-label="Assistant: Meeting Notes Assistant"')
    expect(html).not.toContain('>Meeting Notes Assistant</span>')
  })

  it('carries no legacy agent-persona wording', () => {
    const html = renderView({ profiles: [profile()] })
    expect(html).not.toContain('Agent persona')
    expect(html).not.toContain('Default (runtime)')
    expect(html).not.toContain('Applies to the next new chat')
    expect(html).not.toContain('No agents available')
  })
})
