import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { builtinAssistantById } from './assistant-catalog'
import type {
  AssistantResolveError,
  AssistantSelectionId,
  ResolvedAssistant
} from './assistant-types'

export type AssistantResolveResult = ResolvedAssistant | AssistantResolveError

function error(
  selectionId: AssistantSelectionId,
  code: AssistantResolveError['code'],
  message: string
): AssistantResolveError {
  return { selectionId, code, message }
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed || undefined
}

export function isAssistantResolveError(
  result: AssistantResolveResult
): result is AssistantResolveError {
  return 'code' in result
}

export function isCustomAssistantEligible(profile: KunSubagentProfileV1): boolean {
  const id = profile.id.trim()
  return Boolean(
    id &&
    id === profile.id &&
    !id.startsWith('builtin.') &&
    profile.enabled &&
    (profile.mode === 'primary' || profile.mode === 'all')
  )
}

/**
 * Resolve a user selection into the existing createThread persona fields.
 * This function is deterministic and performs no React, IPC, HTTP or settings writes.
 */
export function resolveAssistant(
  selectionId: AssistantSelectionId,
  profiles: readonly KunSubagentProfileV1[] = []
): AssistantResolveResult {
  if (selectionId === '') {
    return { selectionId: '', kind: 'general', threadFields: {} }
  }

  const normalizedId = selectionId.trim()
  if (!normalizedId || normalizedId !== selectionId) {
    return error(
      selectionId,
      'invalid_id',
      `Assistant selection id must not be empty or contain surrounding whitespace: ${selectionId}`
    )
  }

  if (normalizedId.startsWith('builtin.')) {
    const conflictingProfile = profiles.find((profile) => profile.id === normalizedId)
    if (conflictingProfile) {
      return error(
        normalizedId,
        'builtin_namespace_conflict',
        `Custom assistant cannot use the reserved builtin.* namespace: ${normalizedId}`
      )
    }

    const builtin = builtinAssistantById.get(normalizedId)
    if (builtin) {
      return {
        selectionId: builtin.id,
        kind: 'builtin',
        threadFields: {
          agentId: builtin.id,
          systemPrompt: builtin.systemPrompt
        }
      }
    }

    return error(normalizedId, 'not_found', `Builtin assistant not found: ${normalizedId}`)
  }

  const profile = profiles.find((candidate) => candidate.id === normalizedId)
  if (!profile) {
    const malformedProfile = profiles.find((candidate) => candidate.id.trim() === normalizedId)
    if (malformedProfile) {
      return error(
        normalizedId,
        'invalid_id',
        `Assistant id must not contain surrounding whitespace: ${malformedProfile.id}`
      )
    }
    return error(normalizedId, 'not_found', `Assistant not found: ${normalizedId}`)
  }
  if (!profile.enabled) {
    return error(normalizedId, 'disabled', `Assistant is disabled: ${normalizedId}`)
  }
  if (profile.mode !== 'primary' && profile.mode !== 'all') {
    return error(
      normalizedId,
      'not_primary',
      `Assistant is not available for primary conversations: ${normalizedId}`
    )
  }

  const providerId = trimmedOrUndefined(profile.providerId)
  const model = trimmedOrUndefined(profile.model)
  const systemPrompt = profile.systemPrompt?.trim() ? profile.systemPrompt : undefined

  return {
    selectionId: normalizedId,
    kind: 'custom',
    threadFields: {
      agentId: normalizedId,
      ...(providerId ? { providerId } : {}),
      ...(model ? { model } : {}),
      ...(systemPrompt ? { systemPrompt } : {})
    }
  }
}
