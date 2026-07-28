import { builtinAssistantById } from './assistant-catalog'

/**
 * 人设助手的按轮注入：发送时把 persona 提示词包在实际请求文本外层。
 * UI 通过 sendUserMessage 的 displayText 展示用户原文，因此注入对界面透明；
 * 切换/移除人设即刻对下一条消息生效，无需新建线程或改动线程字段。
 */
export const PERSONA_INSTRUCTIONS_HEADING = '[Assistant persona instructions]'
export const PERSONA_USER_REQUEST_HEADING = '[Current user request]'

export function buildPersonaRuntimePrompt(personaPrompt: string, prompt: string): string {
  const persona = personaPrompt.trim()
  if (!persona) return prompt
  return `${PERSONA_INSTRUCTIONS_HEADING}\n\n${persona}\n\n---\n${PERSONA_USER_REQUEST_HEADING}\n${prompt}`
}

/** 按当前选择取 persona 文本；未选择或 id 未知（历史残留）返回 null。 */
export function personaPromptForSelection(selectionId: string | null | undefined): string | null {
  const normalized = selectionId?.trim() ?? ''
  if (!normalized) return null
  return builtinAssistantById.get(normalized)?.systemPrompt ?? null
}
