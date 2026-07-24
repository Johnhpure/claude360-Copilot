import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { describe, expect, it } from 'vitest'
import { builtinAssistantById } from './assistant-catalog'
import { displayNameForAssistantId } from './assistant-display-name'
import {
  isAssistantResolveError,
  isCustomAssistantEligible,
  resolveAssistant
} from './assistant-resolver'

function profile(
  overrides: Partial<KunSubagentProfileV1> = {}
): KunSubagentProfileV1 {
  return {
    id: 'finance-review',
    enabled: true,
    name: '财务复核',
    mode: 'primary',
    toolPolicy: 'readOnly',
    ...overrides
  }
}

function expectErrorCode(
  result: ReturnType<typeof resolveAssistant>,
  code: 'not_found' | 'disabled' | 'not_primary' | 'invalid_id' | 'builtin_namespace_conflict'
): void {
  expect(isAssistantResolveError(result)).toBe(true)
  if (isAssistantResolveError(result)) expect(result.code).toBe(code)
}

describe('resolveAssistant', () => {
  it('uses only the exact empty string for the general assistant', () => {
    expect(resolveAssistant('')).toEqual({
      selectionId: '',
      kind: 'general',
      threadFields: {}
    })
    expectErrorCode(resolveAssistant('   '), 'invalid_id')
    expectErrorCode(resolveAssistant(' finance-review ', [profile()]), 'invalid_id')
  })

  it('resolves a builtin to stable agentId and static systemPrompt only', () => {
    const definition = builtinAssistantById.get('builtin.official-document')
    expect(definition).toBeDefined()
    expect(resolveAssistant('builtin.official-document')).toEqual({
      selectionId: 'builtin.official-document',
      kind: 'builtin',
      threadFields: {
        agentId: 'builtin.official-document',
        systemPrompt: definition?.systemPrompt
      }
    })
  })

  it('rejects custom profiles occupying the reserved builtin namespace', () => {
    expectErrorCode(
      resolveAssistant('builtin.official-document', [
        profile({ id: 'builtin.official-document' })
      ]),
      'builtin_namespace_conflict'
    )
    expectErrorCode(
      resolveAssistant('builtin.unknown', [profile({ id: 'builtin.unknown' })]),
      'builtin_namespace_conflict'
    )
  })

  it('returns not_found for deleted custom and unknown builtin ids', () => {
    expectErrorCode(resolveAssistant('deleted-profile', []), 'not_found')
    expectErrorCode(resolveAssistant('builtin.unknown', []), 'not_found')
  })

  it('snapshots eligible custom primary profile fields', () => {
    const custom = profile({
      id: 'finance-review',
      providerId: ' provider-a ',
      model: ' model-a ',
      systemPrompt: '只核对用户提供的财务材料。'
    })
    expect(resolveAssistant(custom.id, [custom])).toEqual({
      selectionId: 'finance-review',
      kind: 'custom',
      threadFields: {
        agentId: 'finance-review',
        providerId: 'provider-a',
        model: 'model-a',
        systemPrompt: '只核对用户提供的财务材料。'
      }
    })

    const allMode = profile({ id: 'all-mode', mode: 'all' })
    expect(resolveAssistant(allMode.id, [allMode])).toMatchObject({
      selectionId: 'all-mode',
      kind: 'custom'
    })
  })

  it('rejects disabled, subagent-only, and malformed custom profiles', () => {
    expectErrorCode(
      resolveAssistant('disabled', [profile({ id: 'disabled', enabled: false })]),
      'disabled'
    )
    expectErrorCode(
      resolveAssistant('child-only', [profile({ id: 'child-only', mode: 'subagent' })]),
      'not_primary'
    )
    expectErrorCode(
      resolveAssistant('malformed', [profile({ id: ' malformed ' })]),
      'invalid_id'
    )
  })

  it('filters custom picker candidates with the same primary rules', () => {
    expect(isCustomAssistantEligible(profile())).toBe(true)
    expect(isCustomAssistantEligible(profile({ mode: 'all' }))).toBe(true)
    expect(isCustomAssistantEligible(profile({ enabled: false }))).toBe(false)
    expect(isCustomAssistantEligible(profile({ mode: 'subagent' }))).toBe(false)
    expect(isCustomAssistantEligible(profile({ id: 'builtin.shadow' }))).toBe(false)
    expect(isCustomAssistantEligible(profile({ id: ' malformed ' }))).toBe(false)
  })
})

describe('displayNameForAssistantId', () => {
  const translate = (key: string): string => `translated:${key}`

  it('derives names for general, builtin, and custom assistants', () => {
    expect(displayNameForAssistantId('', [], translate)).toBe(
      'translated:assistantNameGeneral'
    )
    expect(displayNameForAssistantId('builtin.research', [], translate)).toBe(
      'translated:assistantNameResearch'
    )
    expect(displayNameForAssistantId('finance-review', [profile()], translate)).toBe('财务复核')
  })

  it('falls back to stable historical ids without pretending they are general', () => {
    expect(displayNameForAssistantId('removed-profile', [], translate)).toBe('removed-profile')
    expect(
      displayNameForAssistantId(
        'builtin.retired',
        [profile({ id: 'builtin.retired', name: '伪装名称' })],
        translate
      )
    ).toBe('builtin.retired')
  })
})
