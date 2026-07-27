import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import {
  AssistantsCardsView,
  buildAssistantCards,
  type AssistantCardModel
} from './AssistantsView'

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

function renderCards(
  overrides: Partial<Parameters<typeof AssistantsCardsView>[0]> = {},
  cards?: readonly AssistantCardModel[]
): string {
  return renderToStaticMarkup(createElement(AssistantsCardsView, {
    leftSidebarCollapsed: false,
    onToggleLeftSidebar: () => undefined,
    cards: cards ?? buildAssistantCards([], '', (key) => key),
    profilesError: false,
    busy: false,
    hasPendingWork: false,
    storeError: null,
    onSummon: () => undefined,
    onDismiss: () => undefined,
    onRetryProfiles: () => undefined,
    ...overrides
  }))
}

describe('buildAssistantCards', () => {
  it('lists general first, six builtins with risk notes, then eligible customs', () => {
    const cards = buildAssistantCards([
      profile(),
      profile({ id: 'disabled-one', enabled: false }),
      profile({ id: 'subagent-only', mode: 'subagent' })
    ], '', translate)

    expect(cards[0]).toMatchObject({ id: '', group: 'general' })
    expect(cards.filter((card) => card.group === 'builtin')).toHaveLength(6)
    expect(cards.filter((card) => card.group === 'builtin').every((card) => card.riskNote)).toBe(true)
    expect(cards.filter((card) => card.group === 'custom').map((card) => card.id)).toEqual([
      'custom-writer'
    ])
  })

  it('marks exactly the card matching the current agent id as in use', () => {
    const cards = buildAssistantCards([profile()], 'builtin.official-document', translate)
    expect(cards.filter((card) => card.inUse).map((card) => card.id)).toEqual([
      'builtin.official-document'
    ])
    const generalCards = buildAssistantCards([], '', translate)
    expect(generalCards.filter((card) => card.inUse).map((card) => card.id)).toEqual([''])
  })
})

describe('AssistantsCardsView', () => {
  const englishCards = (currentAgentId = ''): AssistantCardModel[] =>
    buildAssistantCards([profile()], currentAgentId, (key) => {
      // Route through real English resources for user-visible names.
      const map: Record<string, string> = {
        assistantNameGeneral: 'General Assistant',
        assistantGeneralDescription: 'General Q&A and tasks in the current workspace'
      }
      return map[key] ?? key
    })

  it('renders every card with a summon action and no install-store wording', () => {
    const html = renderCards({}, englishCards())
    expect(html).toContain('General Assistant')
    expect(html).toContain('assistantNameOfficialDocument')
    expect(html).toContain('assistantRiskOfficialDocument')
    expect(html).toContain('My Writer')
    expect(html.split('Summon').length - 1).toBeGreaterThanOrEqual(7)
    expect(html).not.toContain('Install')
    expect(html).not.toContain('安装')
  })

  it('shows the in-use badge and a remove action for a summoned assistant', () => {
    const html = renderCards({}, englishCards('builtin.official-document'))
    expect(html).toContain('In use')
    expect(html).toContain('Remove')
  })

  it('offers no remove action when the general assistant is current', () => {
    const html = renderCards({}, englishCards(''))
    expect(html).toContain('In use')
    expect(html).not.toContain('>Remove<')
  })

  it('disables summoning with an explanation while a turn runs', () => {
    const html = renderCards({ busy: true }, englishCards())
    expect(html).toContain('A task is still running')
    expect(html).toContain('disabled=""')
  })

  it('keeps builtins available and shows a retry row when profiles fail to load', () => {
    const html = renderCards({ profilesError: true }, buildAssistantCards([], '', (key) => key))
    expect(html).toContain('assistantNameOfficialDocument')
    expect(html).toContain('Failed to load your assistants')
    expect(html).toContain('Retry')
  })

  it('surfaces the store error inline', () => {
    const html = renderCards({ storeError: 'The selected assistant is unavailable' }, englishCards())
    expect(html).toContain('The selected assistant is unavailable')
  })
})
