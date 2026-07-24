/**
 * 企业助手选择器：领域类型
 *
 * 助手 selection ID 语义：
 * - '' 表示通用助手（无额外 persona）
 * - 'builtin.*' 表示内置助手，persona 来自静态目录
 * - 其他非空字符串表示自定义 primary profile ID
 */
export type AssistantSelectionId = string

/** 内置助手稳定 ID 集合 */
export type BuiltinAssistantId =
  | 'builtin.official-document'
  | 'builtin.meeting-notes'
  | 'builtin.report-summary'
  | 'builtin.research'
  | 'builtin.data-analysis'
  | 'builtin.contract-review'

export interface BuiltinAssistantDefinition {
  /** 稳定 ID，必须以 'builtin.' 开头 */
  id: BuiltinAssistantId
  /** 正整数版本，persona 内容变更时递增 */
  version: number
  /** 菜单排序（升序） */
  order: number
  /** locale key，如 'assistant.name.officialDocument' */
  nameKey: string
  /** locale key，如 'assistant.desc.officialDocument' */
  descriptionKey: string
  /** 可选风险提示 locale key */
  riskNoteKey: string
  /** 稳定静态 persona 文本。不含动态日期、用户名、workspace、provider/model */
  systemPrompt: string
}

export interface ResolvedAssistant {
  selectionId: AssistantSelectionId
  kind: 'general' | 'builtin' | 'custom'
  threadFields: {
    /** 通用助手不传；内置/自定义传 */
    agentId?: string
    /** 自定义助手可选 */
    providerId?: string
    /** 自定义助手可选 */
    model?: string
    /** 内置/自定义 persona */
    systemPrompt?: string
  }
}

export interface AssistantResolveError {
  selectionId: AssistantSelectionId
  code: 'not_found' | 'disabled' | 'not_primary' | 'invalid_id' | 'builtin_namespace_conflict'
  message: string
}
