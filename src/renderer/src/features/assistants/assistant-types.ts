/**
 * 人设助手（persona assistant）：领域类型
 *
 * 人设助手是纯前端的「回答风格/专业角色」选择，与设置中的 AI 助手
 * （subagent profiles）是两个互不相关的概念：
 * - 选择只存在于本地（localStorage），不绑定线程、不写入后端设置；
 * - 生效方式是发送消息时按轮注入 persona 提示词，可随时切换。
 *
 * selection ID 语义：
 * - '' 表示不使用助手（默认）
 * - 'builtin.*' 表示内置人设助手，persona 来自静态目录
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
  | 'builtin.speech-writing'
  | 'builtin.rules-regulations'
  | 'builtin.briefing-publicity'
  | 'builtin.party-building'

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
  /** 能力介绍段落 locale key（详情弹窗顶部说明） */
  capabilityKey: string
  /** 擅长领域标签 locale key 列表（详情弹窗标签区） */
  strengthKeys: readonly string[]
  /** 提问示例 locale key 列表（详情弹窗可点击示例） */
  exampleKeys: readonly string[]
  /** 稳定静态 persona 文本。不含动态日期、用户名、workspace、provider/model */
  systemPrompt: string
}
