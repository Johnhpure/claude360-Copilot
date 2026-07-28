import { describe, expect, it } from 'vitest'
import { displayNameForAssistantId } from './assistant-display-name'

const translate = (key: string): string => `t:${key}`

describe('displayNameForAssistantId', () => {
  it('shows the neutral picker label when no assistant is selected', () => {
    expect(displayNameForAssistantId(undefined, translate)).toBe('t:assistantPickerLabel')
    expect(displayNameForAssistantId(null, translate)).toBe('t:assistantPickerLabel')
    expect(displayNameForAssistantId('', translate)).toBe('t:assistantPickerLabel')
    expect(displayNameForAssistantId('   ', translate)).toBe('t:assistantPickerLabel')
  })

  it('shows the locale name for a known builtin assistant', () => {
    expect(displayNameForAssistantId('builtin.official-document', translate)).toBe(
      't:assistantNameOfficialDocument'
    )
  })

  it('falls back to the stable id for an unknown id instead of faking a selection', () => {
    expect(displayNameForAssistantId('builtin.retired-assistant', translate)).toBe(
      'builtin.retired-assistant'
    )
    expect(displayNameForAssistantId('custom-writer', translate)).toBe('custom-writer')
  })
})
