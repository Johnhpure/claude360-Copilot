import { builtinAssistantById } from './assistant-catalog'

export type AssistantTranslate = (key: string) => string

/**
 * 人设助手的展示名。未选择（空 id）显示中性的「助手」入口文案，而不是
 * 「通用助手」——默认状态就是不使用任何助手。未知历史 id 原样展示，
 * 不假装成某个内置助手。
 */
export function displayNameForAssistantId(
  agentId: string | null | undefined,
  translate: AssistantTranslate
): string {
  const normalizedId = agentId?.trim() ?? ''
  if (!normalizedId) return translate('assistantPickerLabel')

  const builtin = builtinAssistantById.get(normalizedId)
  if (builtin) return translate(builtin.nameKey)
  return normalizedId
}
