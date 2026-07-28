import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isValidPersonaSelectionId,
  readStoredPersonaAssistantId,
  storePersonaAssistantId
} from './persona-selection'

const KEY = 'c360.personaAssistantId'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubStorage(initial: string | null = null) {
  const store = new Map<string, string>()
  if (initial !== null) store.set(KEY, initial)
  const localStorage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
    removeItem: vi.fn((key: string) => void store.delete(key))
  }
  vi.stubGlobal('window', { localStorage })
  return { store, localStorage }
}

describe('isValidPersonaSelectionId', () => {
  it('accepts the empty selection (no assistant) and any builtin id', () => {
    expect(isValidPersonaSelectionId('')).toBe(true)
    expect(isValidPersonaSelectionId('builtin.official-document')).toBe(true)
  })

  it('rejects unknown ids and legacy custom profile ids', () => {
    expect(isValidPersonaSelectionId('builtin.retired')).toBe(false)
    expect(isValidPersonaSelectionId('custom-writer')).toBe(false)
  })
})

describe('readStoredPersonaAssistantId', () => {
  it('returns a stored valid builtin id', () => {
    stubStorage('builtin.meeting-notes')
    expect(readStoredPersonaAssistantId()).toBe('builtin.meeting-notes')
  })

  it('degrades an unknown stored id to no-assistant', () => {
    stubStorage('builtin.retired')
    expect(readStoredPersonaAssistantId()).toBe('')
  })

  it('returns empty when nothing is stored', () => {
    stubStorage(null)
    expect(readStoredPersonaAssistantId()).toBe('')
  })
})

describe('storePersonaAssistantId', () => {
  it('persists a selected assistant', () => {
    const { localStorage } = stubStorage(null)
    storePersonaAssistantId('builtin.research')
    expect(localStorage.setItem).toHaveBeenCalledWith(KEY, 'builtin.research')
  })

  it('removes the key when clearing the selection', () => {
    const { localStorage } = stubStorage('builtin.research')
    storePersonaAssistantId('')
    expect(localStorage.removeItem).toHaveBeenCalledWith(KEY)
  })
})
