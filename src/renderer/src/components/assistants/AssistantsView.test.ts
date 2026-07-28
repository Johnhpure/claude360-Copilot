import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import {
  AssistantsCardsView,
  buildAssistantCards,
  buildAssistantDetails,
  type AssistantCardModel
} from './AssistantsView'

beforeAll(() => setupI18nTestEnglish())

const translate = (key: string): string => `t:${key}`

function renderCards(
  overrides: Partial<Parameters<typeof AssistantsCardsView>[0]> = {},
  cards?: readonly AssistantCardModel[]
): string {
  return renderToStaticMarkup(createElement(AssistantsCardsView, {
    leftSidebarCollapsed: false,
    onToggleLeftSidebar: () => undefined,
    cards: cards ?? buildAssistantCards('', (key) => key),
    storeError: null,
    onSummon: () => undefined,
    onDismiss: () => undefined,
    onOpenDetail: () => undefined,
    ...overrides
  }))
}

describe('buildAssistantCards', () => {
  it('lists exactly the ten builtins with risk notes — no general card, no customs', () => {
    const cards = buildAssistantCards('', translate)
    expect(cards.map((card) => card.id)).toEqual([
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
    expect(cards.every((card) => card.riskNote)).toBe(true)
  })

  it('marks exactly the card matching the current selection as in use', () => {
    const cards = buildAssistantCards('builtin.official-document', translate)
    expect(cards.filter((card) => card.inUse).map((card) => card.id)).toEqual([
      'builtin.official-document'
    ])
  })

  it('marks no card as in use when no assistant is selected (default)', () => {
    const cards = buildAssistantCards('', translate)
    expect(cards.filter((card) => card.inUse)).toHaveLength(0)
  })
})

describe('buildAssistantDetails', () => {
  it('resolves capability, strengths, and examples for every builtin', () => {
    const details = buildAssistantDetails('', translate)
    expect(details).toHaveLength(10)
    for (const detail of details) {
      expect(detail.capability).toBeTruthy()
      expect(detail.strengths.length).toBeGreaterThanOrEqual(1)
      expect(detail.examples.length).toBeGreaterThanOrEqual(1)
      expect(detail.strengths.every((s) => s.length > 0)).toBe(true)
      expect(detail.examples.every((e) => e.length > 0)).toBe(true)
    }
  })

  it('marks the selected assistant in use, mirroring the cards', () => {
    const details = buildAssistantDetails('builtin.speech-writing', translate)
    expect(details.filter((d) => d.inUse).map((d) => d.id)).toEqual([
      'builtin.speech-writing'
    ])
  })
})

describe('AssistantsCardsView', () => {
  it('renders every card with a summon action and no install-store wording', () => {
    const html = renderCards()
    expect(html).toContain('assistantNameOfficialDocument')
    expect(html).toContain('assistantRiskOfficialDocument')
    expect(html.split('Summon').length - 1).toBeGreaterThanOrEqual(6)
    expect(html).not.toContain('Install')
    expect(html).not.toContain('安装')
    expect(html).not.toContain('General Assistant')
  })

  it('shows the in-use badge and a remove action for a summoned assistant', () => {
    const html = renderCards({}, buildAssistantCards('builtin.official-document', (key) => key))
    expect(html).toContain('In use')
    expect(html).toContain('Remove')
  })

  it('offers no remove action when no assistant is selected', () => {
    const html = renderCards()
    expect(html).not.toContain('In use')
    expect(html).not.toContain('>Remove<')
  })

  it('surfaces the store error inline', () => {
    const html = renderCards({ storeError: 'The selected assistant is unavailable' })
    expect(html).toContain('The selected assistant is unavailable')
  })
})
