import { builtinAssistantById } from './assistant-catalog'
import type { AssistantSelectionId } from './assistant-types'

/**
 * 人设助手选择的本地持久化。
 *
 * 选择是纯前端状态：不绑定线程（thread.agentId 属于 AI 助手/subagent 体系，
 * 人设助手不写它），也不进入后端设置。刷新/重启后仍保留上次选择。
 */
const PERSONA_ASSISTANT_STORAGE_KEY = 'c360.personaAssistantId'

/** 校验 selection：仅空串（不使用助手）或内置目录中的 id 有效。 */
export function isValidPersonaSelectionId(selectionId: string): boolean {
  return selectionId === '' || builtinAssistantById.has(selectionId)
}

export function readStoredPersonaAssistantId(): AssistantSelectionId {
  try {
    const stored = window.localStorage.getItem(PERSONA_ASSISTANT_STORAGE_KEY)?.trim() ?? ''
    return isValidPersonaSelectionId(stored) ? stored : ''
  } catch {
    return ''
  }
}

export function storePersonaAssistantId(selectionId: AssistantSelectionId): void {
  try {
    if (selectionId) {
      window.localStorage.setItem(PERSONA_ASSISTANT_STORAGE_KEY, selectionId)
    } else {
      window.localStorage.removeItem(PERSONA_ASSISTANT_STORAGE_KEY)
    }
  } catch {
    /* 持久化失败不影响会话内选择 */
  }
}
