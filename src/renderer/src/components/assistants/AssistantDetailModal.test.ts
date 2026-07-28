import { beforeAll, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupI18nTestEnglish } from '../../test-support/i18n-en'
import { AssistantDetailContent, type AssistantDetailModel } from './AssistantDetailModal'

beforeAll(() => setupI18nTestEnglish())

const sample: AssistantDetailModel = {
  id: 'builtin.official-document',
  name: 'Official Document',
  description: 'Drafts and reviews official documents',
  capability: 'Handles notices, requests, reports, and minutes.',
  strengths: ['Notices & requests', 'Routing & tone'],
  examples: ['Draft a safety inspection notice', 'Rewrite this into a formal request'],
  riskNote: 'Drafting aid; needs human sign-off',
  inUse: false
}

// Modal 走 createPortal，node 环境的 renderToStaticMarkup 不支持；故直接渲染
// 拆分出来的展示体 AssistantDetailContent（open 态视觉走手测，同 ImageLightbox）。
function render(detail: AssistantDetailModel): string {
  return renderToStaticMarkup(
    createElement(AssistantDetailContent, {
      detail,
      onClose: () => undefined,
      onSummon: () => undefined,
      onDismiss: () => undefined,
      onAskExample: () => undefined
    })
  )
}

describe('AssistantDetailModal', () => {
  it('shows capability, strength tags, and clickable examples', () => {
    const html = render(sample)
    expect(html).toContain('Official Document')
    expect(html).toContain('Handles notices, requests, reports, and minutes.')
    expect(html).toContain('Notices &amp; requests')
    expect(html).toContain('Draft a safety inspection notice')
    // Section titles come from i18n
    expect(html).toContain('What it does')
    expect(html).toContain('Strengths')
    expect(html).toContain('Example prompts')
  })

  it('offers a summon action when the assistant is not in use', () => {
    const html = render(sample)
    expect(html).toContain('Summon')
    expect(html).not.toContain('>Remove<')
  })

  it('offers a remove action and in-use badge when already summoned', () => {
    const html = render({ ...sample, inUse: true })
    expect(html).toContain('In use')
    expect(html).toContain('Remove')
  })
})
