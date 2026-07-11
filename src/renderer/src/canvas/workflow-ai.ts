// 创作工作流的文本模型调用（07-11 image-workflow，renderer）。
//
// 复用既有 claude360:chat 流式 IPC（先例 music/lyrics-ai.ts）：renderer 侧按
// streamId 过滤订阅 delta，累积成完整文本后再解析。两个能力：
// - generateWorkflowDraft：自然语言描述 → 结构化工作流草稿（JSON）；
// - expandPrompts：主提示词 + 拆分规则 → N 条独立生图提示词（JSON）。
//
// Risk Notes：
// - renderer 全程不触碰明文 Key；分组仅以名称经 IPC 透传（main 侧 ensureGroupKey）。
// - LLM 输出不可信：extractJsonObject 容错解析 + 字段级校验 + normalizeImageWorkflow
//   同源收敛 shape；任何失败抛带简体中文 message 的 Error，由弹窗 toast，不崩页面。
import type {
  Claude360ChatDeltaPayload,
  Claude360ChatEndPayload,
  Claude360ChatErrorPayload,
  Claude360ChatStreamStartPayload
} from '@shared/kun-gui-api'
import type { ImageWorkflowV1 } from '@shared/app-settings-types'
import { normalizeImageWorkflow } from '@shared/app-settings-image-workflow'
import { extractJsonObject } from '@shared/json-extract'
import { CLAUDE360_ASPECT_PRESETS } from '@shared/claude360-canvas'

/** 本模块依赖的 kunGui API 子集（注入式，便于测试 mock）。 */
export type WorkflowChatApi = {
  claude360ChatStreamStart: (p: Claude360ChatStreamStartPayload) => Promise<{ streamId: string }>
  claude360ChatStreamStop: (streamId: string) => Promise<boolean>
  onClaude360ChatDelta: (cb: (p: Claude360ChatDeltaPayload) => void) => () => void
  onClaude360ChatEnd: (cb: (p: Claude360ChatEndPayload) => void) => () => void
  onClaude360ChatError: (cb: (p: Claude360ChatErrorPayload) => void) => () => void
}

export type WorkflowDraftInput = {
  /** 文本模型 id（modelCache 动态列表，禁止硬编码白名单）。 */
  model: string
  /** 可选文本分组覆盖；缺省走 selectedTextGroup。 */
  group?: string
  /** 用户的自然语言需求描述。 */
  description: string
  /** 参考图元信息（素材 prompt/文件名等文本），仅供意图理解，不传像素数据。 */
  referenceNotes?: string
}

export type ExpandPromptsInput = {
  model: string
  group?: string
  /** 主模板渲染后的基础提示词。 */
  basePrompt: string
  /** 自然语言拆分规则。 */
  rule: string
  /** 期望条数（1-20）；模型返回条数不符时如实返回实际条数，由调用方弱提示。 */
  count: number
}

const CHAT_FALLBACK_ERROR = 'AI 生成失败，请稍后重试'

function createWorkflowStreamId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}

/**
 * 发起一次流式 chat 并把 delta 累积为完整文本（end 时 resolve，error 时 reject）。
 * start 调用本身失败（IPC/未登录等）也走 reject，错误信息保持中文。
 */
export function collectChatText(
  api: WorkflowChatApi,
  params: { model: string; group?: string; system: string; user: string }
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const streamId = createWorkflowStreamId('imgwf')
    let text = ''
    const offs: Array<() => void> = []
    const cleanup = (): void => {
      for (const off of offs) off()
      offs.length = 0
    }
    offs.push(
      api.onClaude360ChatDelta((p) => {
        if (p.streamId === streamId) text += p.delta
      })
    )
    offs.push(
      api.onClaude360ChatEnd((p) => {
        if (p.streamId === streamId) {
          cleanup()
          resolve(text)
        }
      })
    )
    offs.push(
      api.onClaude360ChatError((p) => {
        if (p.streamId === streamId) {
          cleanup()
          reject(new Error(p.message ?? CHAT_FALLBACK_ERROR))
        }
      })
    )
    api
      .claude360ChatStreamStart({
        model: params.model,
        system: params.system,
        user: params.user,
        streamId,
        ...(params.group ? { group: params.group } : {})
      })
      .catch((e: unknown) => {
        cleanup()
        reject(e instanceof Error ? e : new Error(CHAT_FALLBACK_ERROR))
      })
  })
}

/** 草稿生成的 system prompt：要求仅输出 JSON，并给出目标字段 schema 示例。 */
function buildDraftSystemPrompt(): string {
  const aspectIds = [...CLAUDE360_ASPECT_PRESETS.map((preset) => preset.id), 'custom'].join('/')
  return [
    '你是一名 AI 生图工作流设计助手。请根据用户的需求描述，设计一个可复用的生图工作流。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。',
    '',
    'JSON 字段结构示例：',
    '{',
    '  "name": "小红书封面",',
    '  "description": "根据主题快速生成小红书风格封面图",',
    '  "category": "小红书封面",',
    '  "variables": [',
    '    { "key": "topic", "label": "主题", "type": "text", "required": true, "defaultValue": "", "options": [] }',
    '  ],',
    '  "promptTemplate": {',
    '    "system": "你是一名资深平面设计师",',
    '    "positive": "为主题「{{topic}}」设计一张封面图，构图醒目，色彩明快",',
    '    "negative": "文字乱码, 低分辨率, 水印"',
    '  },',
    '  "textExpansion": { "enabled": false, "model": "", "count": 4, "concurrency": 2, "rule": "", "prependBasePrompt": true },',
    '  "imageConfig": { "aspectPresetId": "story", "resolution": "1K", "quality": "auto", "count": 1, "format": "png" }',
    '}',
    '',
    '要求：',
    '- variables 的 key 只能包含字母、数字、下划线，且不得重复；type 只能取 text/textarea/number/select（select 时给出 options）。',
    '- promptTemplate.positive 必填；模板中用 {{key}} 引用变量，引用的变量必须在 variables 中定义，占位符保持原样输出。',
    '- 若需求适合一次生成多张不同画面的图，把 textExpansion.enabled 设为 true，并给出拆分 rule 与 count。',
    `- imageConfig.aspectPresetId 只能取：${aspectIds}。`,
    '- 所有文案使用简体中文。'
  ].join('\n')
}

function buildDraftUserPrompt(input: WorkflowDraftInput): string {
  const sections: string[] = [`需求描述：\n${input.description.trim()}`]
  const notes = input.referenceNotes?.trim()
  if (notes) {
    sections.push(`参考图信息（仅文本元信息，供理解风格与内容意图）：\n${notes}`)
  }
  return sections.join('\n\n')
}

/**
 * 自然语言描述 → 工作流草稿。返回未持久化的 ImageWorkflowV1（id/时间戳为占位，
 * 保存时由调用方重新生成）；解析/校验失败抛带中文 message 的 Error。
 */
export async function generateWorkflowDraft(
  api: WorkflowChatApi,
  input: WorkflowDraftInput
): Promise<ImageWorkflowV1> {
  if (!input.model.trim()) throw new Error('请先选择文本模型')
  if (!input.description.trim()) throw new Error('请先填写工作流需求描述')
  const raw = await collectChatText(api, {
    model: input.model,
    ...(input.group ? { group: input.group } : {}),
    system: buildDraftSystemPrompt(),
    user: buildDraftUserPrompt(input)
  })
  const parsed = extractJsonObject(raw)
  if (!parsed) throw new Error('AI 返回内容不是有效的 JSON，请重试或更换文本模型')
  const template = parsed.promptTemplate
  const positive =
    template && typeof template === 'object' && !Array.isArray(template)
      ? (template as Record<string, unknown>).positive
      : undefined
  if (typeof positive !== 'string' || positive.trim().length === 0) {
    throw new Error('AI 草稿缺少正向提示词模板，请调整描述后重试')
  }
  // 与列表 normalize 同源收敛 shape：枚举越界回退、数值 clamp、非法变量丢弃。
  return normalizeImageWorkflow(parsed, 0, Date.now())
}

/** 多图提示词拆分的 system prompt：要求仅输出 {"prompts": string[]}。 */
function buildExpandSystemPrompt(count: number): string {
  return [
    `你是一名生图提示词扩写助手。请根据给定的基础提示词与拆分规则，生成 ${count} 条相互独立、可直接用于文生图的简体中文提示词。`,
    '只输出一个 JSON 对象，格式为 {"prompts": ["提示词1", "提示词2"]}，不要 markdown 代码块，不要任何解释文字。'
  ].join('\n')
}

/**
 * 主提示词 + 规则 → N 条独立生图提示词。返回条数可能与 count 不符（如实返回，
 * 调用方弱提示）；无有效条目/解析失败抛带中文 message 的 Error。
 */
export async function expandPrompts(
  api: WorkflowChatApi,
  input: ExpandPromptsInput
): Promise<string[]> {
  if (!input.model.trim()) throw new Error('请先选择多图规则的文本模型')
  const raw = await collectChatText(api, {
    model: input.model,
    ...(input.group ? { group: input.group } : {}),
    system: buildExpandSystemPrompt(input.count),
    user: `基础提示词：\n${input.basePrompt}\n\n拆分规则：\n${input.rule}\n\n请生成 ${input.count} 条提示词。`
  })
  const parsed = extractJsonObject(raw)
  if (!parsed) throw new Error('多图提示词生成失败：AI 返回内容不是有效的 JSON，请重试')
  const prompts = Array.isArray(parsed.prompts)
    ? parsed.prompts
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : []
  if (prompts.length === 0) throw new Error('多图提示词生成失败：AI 未返回有效的提示词列表，请重试')
  return prompts
}
