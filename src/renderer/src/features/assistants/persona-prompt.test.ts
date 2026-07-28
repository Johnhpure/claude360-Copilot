import { describe, expect, it } from 'vitest'
import { builtinAssistantById } from './assistant-catalog'
import {
  PERSONA_INSTRUCTIONS_HEADING,
  PERSONA_USER_REQUEST_HEADING,
  buildPersonaRuntimePrompt,
  personaPromptForSelection
} from './persona-prompt'

const OFFICIAL_DOCUMENT_ID = 'builtin.official-document'

describe('personaPromptForSelection', () => {
  it('returns null when no assistant is selected', () => {
    expect(personaPromptForSelection('')).toBeNull()
    expect(personaPromptForSelection('   ')).toBeNull()
  })

  it('returns the builtin persona text for a catalog id', () => {
    expect(personaPromptForSelection(OFFICIAL_DOCUMENT_ID)).toBe(
      builtinAssistantById.get(OFFICIAL_DOCUMENT_ID)?.systemPrompt
    )
  })

  it('returns null for an unknown or legacy id instead of guessing', () => {
    expect(personaPromptForSelection('builtin.retired-assistant')).toBeNull()
    expect(personaPromptForSelection('custom-writer')).toBeNull()
  })
})

describe('buildPersonaRuntimePrompt', () => {
  it('wraps the request with the persona heading and user-request marker', () => {
    const wrapped = buildPersonaRuntimePrompt('You are a careful reviewer.', 'check this doc')
    expect(wrapped).toContain(PERSONA_INSTRUCTIONS_HEADING)
    expect(wrapped).toContain('You are a careful reviewer.')
    expect(wrapped.endsWith(`${PERSONA_USER_REQUEST_HEADING}\ncheck this doc`)).toBe(true)
  })

  it('returns the prompt untouched when the persona text is blank', () => {
    expect(buildPersonaRuntimePrompt('   ', 'hello')).toBe('hello')
  })
})
