import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1, KunSubagentProfileV1 } from '@shared/app-settings'
import type { NormalizedThread } from '../agent/types'
import { builtinAssistantById, isAssistantResolveError } from '../features/assistants'
import type { ResolvedAssistant } from '../features/assistants'
import {
  createThreadWithAssistant,
  resolveThreadAssistant,
  threadAssistantSelectionId,
  threadMatchesRequestedAssistant
} from './chat-store-thread-action-helpers'

const OFFICIAL_DOCUMENT_ID = 'builtin.official-document'
const officialDocumentPersona = builtinAssistantById.get(OFFICIAL_DOCUMENT_ID)?.systemPrompt ?? ''

function profile(overrides: Partial<KunSubagentProfileV1> = {}): KunSubagentProfileV1 {
  return {
    id: 'custom-writer',
    enabled: true,
    name: 'Writer',
    mode: 'primary',
    toolPolicy: 'inherit',
    providerId: 'deepseek',
    model: 'deepseek-v4-pro',
    systemPrompt: 'You are a careful writer.',
    ...overrides
  }
}

function settingsWith(profiles: KunSubagentProfileV1[]): AppSettingsV1 {
  return { agents: { kun: { subagents: { enabled: true, profiles } } } } as unknown as AppSettingsV1
}

function createdThread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id: 'thr_created',
    title: '',
    updatedAt: '2026-07-24T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    ...overrides
  }
}

describe('threadAssistantSelectionId precedence', () => {
  const activeThread = { agentId: 'active-agent' }

  it('prefers the explicit options agent id over every other source', () => {
    expect(
      threadAssistantSelectionId({
        explicitAgentId: ' builtin.research ',
        activeThread,
        composerAgentId: 'composer-agent'
      })
    ).toBe('builtin.research')
  })

  it('treats an explicit empty string as the general assistant instead of falling through', () => {
    expect(
      threadAssistantSelectionId({
        explicitAgentId: '',
        activeThread,
        composerAgentId: 'composer-agent'
      })
    ).toBe('')
  })

  it('uses the active thread agent id when no explicit id is given', () => {
    expect(
      threadAssistantSelectionId({
        activeThread,
        composerAgentId: 'composer-agent'
      })
    ).toBe('active-agent')
  })

  it('keeps a general active thread general even when the composer holds a pending selection', () => {
    expect(
      threadAssistantSelectionId({
        activeThread: { agentId: undefined },
        composerAgentId: 'composer-agent'
      })
    ).toBe('')
  })

  it('falls back to composerAgentId only when no thread is active', () => {
    expect(
      threadAssistantSelectionId({
        activeThread: null,
        composerAgentId: 'composer-agent'
      })
    ).toBe('composer-agent')
    expect(threadAssistantSelectionId({})).toBe('')
  })
})

describe('resolveThreadAssistant', () => {
  it('resolves the general assistant to empty thread fields', () => {
    const resolved = resolveThreadAssistant(settingsWith([profile()]), '')
    expect(isAssistantResolveError(resolved)).toBe(false)
    if (!isAssistantResolveError(resolved)) {
      expect(resolved.kind).toBe('general')
      expect(resolved.threadFields).toEqual({})
    }
  })

  it('resolves a builtin assistant to its stable id and catalog persona', () => {
    const resolved = resolveThreadAssistant(settingsWith([]), OFFICIAL_DOCUMENT_ID)
    expect(isAssistantResolveError(resolved)).toBe(false)
    if (!isAssistantResolveError(resolved)) {
      expect(resolved.kind).toBe('builtin')
      expect(resolved.threadFields.agentId).toBe(OFFICIAL_DOCUMENT_ID)
      expect(resolved.threadFields.systemPrompt).toBe(officialDocumentPersona)
      expect(resolved.threadFields.providerId).toBeUndefined()
      expect(resolved.threadFields.model).toBeUndefined()
    }
  })

  it('snapshots an eligible custom primary profile with provider, model, and prompt', () => {
    const resolved = resolveThreadAssistant(settingsWith([profile()]), 'custom-writer')
    expect(isAssistantResolveError(resolved)).toBe(false)
    if (!isAssistantResolveError(resolved)) {
      expect(resolved.kind).toBe('custom')
      expect(resolved.threadFields).toEqual({
        agentId: 'custom-writer',
        providerId: 'deepseek',
        model: 'deepseek-v4-pro',
        systemPrompt: 'You are a careful writer.'
      })
    }
  })

  it('fails closed for a deleted profile', () => {
    const resolved = resolveThreadAssistant(settingsWith([]), 'custom-writer')
    expect(isAssistantResolveError(resolved)).toBe(true)
    if (isAssistantResolveError(resolved)) expect(resolved.code).toBe('not_found')
  })

  it('fails closed for a disabled profile', () => {
    const resolved = resolveThreadAssistant(
      settingsWith([profile({ enabled: false })]),
      'custom-writer'
    )
    expect(isAssistantResolveError(resolved)).toBe(true)
    if (isAssistantResolveError(resolved)) expect(resolved.code).toBe('disabled')
  })

  it('fails closed for a subagent-only profile', () => {
    const resolved = resolveThreadAssistant(
      settingsWith([profile({ mode: 'subagent' })]),
      'custom-writer'
    )
    expect(isAssistantResolveError(resolved)).toBe(true)
    if (isAssistantResolveError(resolved)) expect(resolved.code).toBe('not_primary')
  })

  it('fails closed when a custom profile squats the builtin namespace', () => {
    const resolved = resolveThreadAssistant(
      settingsWith([profile({ id: OFFICIAL_DOCUMENT_ID })]),
      OFFICIAL_DOCUMENT_ID
    )
    expect(isAssistantResolveError(resolved)).toBe(true)
    if (isAssistantResolveError(resolved)) expect(resolved.code).toBe('builtin_namespace_conflict')
  })
})

describe('threadMatchesRequestedAssistant', () => {
  const general: ResolvedAssistant = { selectionId: '', kind: 'general', threadFields: {} }
  const builtin: ResolvedAssistant = {
    selectionId: OFFICIAL_DOCUMENT_ID,
    kind: 'builtin',
    threadFields: { agentId: OFFICIAL_DOCUMENT_ID, systemPrompt: officialDocumentPersona }
  }

  it('requires an empty actual agent id for the general assistant', () => {
    expect(threadMatchesRequestedAssistant({ agentId: undefined }, general)).toBe(true)
    expect(threadMatchesRequestedAssistant({ agentId: '' }, general)).toBe(true)
    expect(threadMatchesRequestedAssistant({ agentId: OFFICIAL_DOCUMENT_ID }, general)).toBe(false)
  })

  it('requires the exact agent id for a dedicated assistant', () => {
    expect(threadMatchesRequestedAssistant({ agentId: OFFICIAL_DOCUMENT_ID }, builtin)).toBe(true)
    expect(threadMatchesRequestedAssistant({ agentId: 'builtin.research' }, builtin)).toBe(false)
    expect(threadMatchesRequestedAssistant({ agentId: undefined }, builtin)).toBe(false)
  })
})

describe('createThreadWithAssistant', () => {
  const builtinResolved: ResolvedAssistant = {
    selectionId: OFFICIAL_DOCUMENT_ID,
    kind: 'builtin',
    threadFields: { agentId: OFFICIAL_DOCUMENT_ID, systemPrompt: officialDocumentPersona }
  }

  it('spreads the resolved persona fields into the create input and accepts a matching thread', async () => {
    const provider = {
      createThread: vi.fn(async () => createdThread({ agentId: OFFICIAL_DOCUMENT_ID })),
      deleteThread: vi.fn(async () => undefined)
    }

    const thread = await createThreadWithAssistant(
      provider,
      { workspace: '/workspace/deepseek-gui', title: 'T', mode: 'agent' },
      builtinResolved
    )

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: '/workspace/deepseek-gui',
      title: 'T',
      mode: 'agent',
      agentId: OFFICIAL_DOCUMENT_ID,
      systemPrompt: officialDocumentPersona
    })
    expect(provider.deleteThread).not.toHaveBeenCalled()
    expect(thread.id).toBe('thr_created')
  })

  it('sends no persona fields for the general assistant', async () => {
    const provider = {
      createThread: vi.fn(async () => createdThread()),
      deleteThread: vi.fn(async () => undefined)
    }

    await createThreadWithAssistant(
      provider,
      { workspace: '/workspace/deepseek-gui', title: 'T', mode: 'agent' },
      { selectionId: '', kind: 'general', threadFields: {} }
    )

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: '/workspace/deepseek-gui',
      title: 'T',
      mode: 'agent'
    })
  })

  it('deletes the thread best-effort and throws when the returned agent id mismatches', async () => {
    const provider = {
      createThread: vi.fn(async () => createdThread({ agentId: undefined })),
      deleteThread: vi.fn(async () => undefined)
    }

    await expect(
      createThreadWithAssistant(provider, { workspace: '/w' }, builtinResolved)
    ).rejects.toThrow()
    expect(provider.deleteThread).toHaveBeenCalledWith('thr_created')
  })

  it('still throws the mismatch error when best-effort cleanup itself fails', async () => {
    const provider = {
      createThread: vi.fn(async () => createdThread({ agentId: 'someone-else' })),
      deleteThread: vi.fn(async () => {
        throw new Error('delete failed')
      })
    }

    await expect(
      createThreadWithAssistant(provider, { workspace: '/w' }, builtinResolved)
    ).rejects.toThrow()
    expect(provider.deleteThread).toHaveBeenCalledWith('thr_created')
  })
})
