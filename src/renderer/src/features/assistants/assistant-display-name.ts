import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { builtinAssistantById } from './assistant-catalog'

export type AssistantTranslate = (key: string) => string

/**
 * Derive a user-visible assistant name without persisting a second identity.
 * Unknown historical ids deliberately fall back to the stable id instead of
 * pretending the thread is using the general assistant.
 */
export function displayNameForAssistantId(
  agentId: string | null | undefined,
  profiles: readonly KunSubagentProfileV1[],
  translate: AssistantTranslate
): string {
  const normalizedId = agentId?.trim() ?? ''
  if (!normalizedId) return translate('assistantNameGeneral')

  const builtin = builtinAssistantById.get(normalizedId)
  if (builtin) return translate(builtin.nameKey)
  if (normalizedId.startsWith('builtin.')) return normalizedId

  const custom = profiles.find((profile) => profile.id.trim() === normalizedId)
  const customName = custom?.name.trim()
  return customName || normalizedId
}
