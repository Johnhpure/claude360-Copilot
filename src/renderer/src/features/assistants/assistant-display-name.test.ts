import { describe, expect, it } from 'vitest'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { displayNameForAssistantId } from './assistant-display-name'

const translate = (key: string): string => `t:${key}`

function profile(overrides: Partial<KunSubagentProfileV1> = {}): KunSubagentProfileV1 {
  return {
    id: 'custom-writer',
    enabled: true,
    name: 'My Writer',
    mode: 'primary',
    toolPolicy: 'inherit',
    ...overrides
  }
}

describe('displayNameForAssistantId', () => {
  it('shows the general assistant for an empty or missing agent id', () => {
    expect(displayNameForAssistantId(undefined, [], translate)).toBe('t:assistantNameGeneral')
    expect(displayNameForAssistantId(null, [], translate)).toBe('t:assistantNameGeneral')
    expect(displayNameForAssistantId('', [], translate)).toBe('t:assistantNameGeneral')
    expect(displayNameForAssistantId('   ', [], translate)).toBe('t:assistantNameGeneral')
  })

  it('shows the locale name for a known builtin assistant', () => {
    expect(displayNameForAssistantId('builtin.official-document', [], translate)).toBe(
      't:assistantNameOfficialDocument'
    )
  })

  it('falls back to the stable id for an unknown builtin id instead of faking general', () => {
    expect(displayNameForAssistantId('builtin.retired-assistant', [], translate)).toBe(
      'builtin.retired-assistant'
    )
  })

  it('prefers the current custom profile name', () => {
    expect(displayNameForAssistantId('custom-writer', [profile()], translate)).toBe('My Writer')
  })

  it('degrades to the stable id when the custom profile was deleted or renamed away', () => {
    expect(displayNameForAssistantId('custom-writer', [], translate)).toBe('custom-writer')
    expect(
      displayNameForAssistantId('custom-writer', [profile({ id: 'other-profile' })], translate)
    ).toBe('custom-writer')
  })

  it('degrades to the stable id when the profile name is blank', () => {
    expect(displayNameForAssistantId('custom-writer', [profile({ name: '   ' })], translate)).toBe(
      'custom-writer'
    )
  })

  it('resolves a fork-inherited agent id exactly like the source thread', () => {
    // Kun forks copy the persona fields; the display function needs nothing
    // beyond the inherited agentId to render the same name.
    const inheritedAgentId = 'builtin.contract-review'
    expect(displayNameForAssistantId(inheritedAgentId, [], translate)).toBe(
      't:assistantNameContractReview'
    )
  })
})
