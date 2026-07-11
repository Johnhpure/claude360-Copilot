// 创作工作流 AI 草稿 / 多图提示词拆分测试（node 环境，mock 流式 chat api）。
// 覆盖：code fence JSON / 裸 JSON / 杂文本兜底、缺 positive 失败、
// expandPrompts 条数不符与格式兜底、stream error 中文传播、group 透传。
import { describe, expect, it } from 'vitest'
import type {
  Claude360ChatDeltaPayload,
  Claude360ChatEndPayload,
  Claude360ChatErrorPayload,
  Claude360ChatStreamStartPayload
} from '@shared/kun-gui-api'
import { collectChatText, expandPrompts, generateWorkflowDraft, type WorkflowChatApi } from './workflow-ai'

type MockScript = {
  /** 模型完整回复文本（拆成两段 delta 推送）。 */
  reply?: string
  /** 走 error push 通道并携带该 message。 */
  errorMessage?: string
  /** start invoke 本身 reject。 */
  rejectStart?: boolean
}

function createMockApi(script: MockScript): { api: WorkflowChatApi; startCalls: Claude360ChatStreamStartPayload[] } {
  const startCalls: Claude360ChatStreamStartPayload[] = []
  let deltaCb: ((p: Claude360ChatDeltaPayload) => void) | null = null
  let endCb: ((p: Claude360ChatEndPayload) => void) | null = null
  let errorCb: ((p: Claude360ChatErrorPayload) => void) | null = null
  const api: WorkflowChatApi = {
    claude360ChatStreamStart: async (p) => {
      startCalls.push(p)
      if (script.rejectStart) throw new Error('未登录，请先登录 Claude360')
      const streamId = p.streamId ?? 'sid'
      queueMicrotask(() => {
        if (script.errorMessage !== undefined) {
          errorCb?.({ streamId, message: script.errorMessage })
          return
        }
        const reply = script.reply ?? ''
        const mid = Math.ceil(reply.length / 2)
        deltaCb?.({ streamId, delta: reply.slice(0, mid) })
        deltaCb?.({ streamId, delta: reply.slice(mid) })
        endCb?.({ streamId })
      })
      return { streamId }
    },
    claude360ChatStreamStop: async () => true,
    onClaude360ChatDelta: (cb) => {
      deltaCb = cb
      return () => {
        deltaCb = null
      }
    },
    onClaude360ChatEnd: (cb) => {
      endCb = cb
      return () => {
        endCb = null
      }
    },
    onClaude360ChatError: (cb) => {
      errorCb = cb
      return () => {
        errorCb = null
      }
    }
  }
  return { api, startCalls }
}

const draftJson = {
  name: '小红书封面',
  description: '根据主题快速生成小红书风格封面图',
  category: '小红书封面',
  variables: [
    { key: 'topic', label: '主题', type: 'text', required: true, defaultValue: '', options: [] },
    { key: '非法 key!', label: '坏变量', type: 'text', required: false, defaultValue: '', options: [] }
  ],
  promptTemplate: { system: '你是设计师', positive: '为主题「{{topic}}」设计封面', negative: '水印' },
  textExpansion: { enabled: true, model: 'gpt-text', count: 4, concurrency: 2, rule: '按角度拆分', prependBasePrompt: true },
  imageConfig: { aspectPresetId: 'story', resolution: '1K', quality: 'auto', count: 1, format: 'png' }
}

describe('collectChatText', () => {
  it('累积多段 delta，end 后 resolve 完整文本', async () => {
    const { api } = createMockApi({ reply: '你好，世界' })
    await expect(collectChatText(api, { model: 'm', system: 's', user: 'u' })).resolves.toBe('你好，世界')
  })

  it('stream error 时 reject 并透传中文 message', async () => {
    const { api } = createMockApi({ errorMessage: '模型暂不可用，请稍后重试' })
    await expect(collectChatText(api, { model: 'm', system: 's', user: 'u' })).rejects.toThrow(
      '模型暂不可用，请稍后重试'
    )
  })

  it('start invoke 本身失败也 reject（错误保持中文）', async () => {
    const { api } = createMockApi({ rejectStart: true })
    await expect(collectChatText(api, { model: 'm', system: 's', user: 'u' })).rejects.toThrow('未登录')
  })

  it('group 传入时随 start payload 透传，缺省不带 group 字段', async () => {
    const withGroup = createMockApi({ reply: 'ok' })
    await collectChatText(withGroup.api, { model: 'm', group: '电商', system: 's', user: 'u' })
    expect(withGroup.startCalls[0].group).toBe('电商')

    const withoutGroup = createMockApi({ reply: 'ok' })
    await collectChatText(withoutGroup.api, { model: 'm', system: 's', user: 'u' })
    expect('group' in withoutGroup.startCalls[0]).toBe(false)
  })
})

describe('generateWorkflowDraft · JSON 解析容错', () => {
  it('```json code fence 包裹的 JSON 可解析，字段经 normalize 收敛', async () => {
    const { api } = createMockApi({ reply: '```json\n' + JSON.stringify(draftJson) + '\n```' })
    const draft = await generateWorkflowDraft(api, { model: 'gpt-text', description: '做小红书封面' })
    expect(draft.name).toBe('小红书封面')
    expect(draft.category).toBe('小红书封面')
    // {{topic}} 占位符保持原样，不做替换
    expect(draft.promptTemplate.positive).toBe('为主题「{{topic}}」设计封面')
    // 非法 key 的变量被 normalize 丢弃
    expect(draft.variables.map((v) => v.key)).toEqual(['topic'])
    expect(draft.textExpansion).toMatchObject({ enabled: true, model: 'gpt-text', count: 4 })
    expect(draft.imageConfig).toMatchObject({ aspectPresetId: 'story', resolution: '1K', format: 'png' })
    expect(draft.visibility).toBe('private')
  })

  it('裸 JSON 可解析', async () => {
    const { api } = createMockApi({ reply: JSON.stringify(draftJson) })
    const draft = await generateWorkflowDraft(api, { model: 'gpt-text', description: '做封面' })
    expect(draft.name).toBe('小红书封面')
  })

  it('JSON 混在解释文字里也能兜底提取', async () => {
    const { api } = createMockApi({ reply: '好的，为你设计如下：\n' + JSON.stringify(draftJson) + '\n希望有帮助！' })
    const draft = await generateWorkflowDraft(api, { model: 'gpt-text', description: '做封面' })
    expect(draft.name).toBe('小红书封面')
  })

  it('参考图元信息拼入 user prompt', async () => {
    const { api, startCalls } = createMockApi({ reply: JSON.stringify(draftJson) })
    await generateWorkflowDraft(api, {
      model: 'gpt-text',
      description: '做封面',
      referenceNotes: '素材1：赛博朋克城市夜景'
    })
    expect(startCalls[0].user).toContain('赛博朋克城市夜景')
  })

  it('完全不是 JSON 时 reject 中文错误', async () => {
    const { api } = createMockApi({ reply: '抱歉，我无法完成这个任务。' })
    await expect(generateWorkflowDraft(api, { model: 'gpt-text', description: '做封面' })).rejects.toThrow(
      'AI 返回内容不是有效的 JSON'
    )
  })

  it('缺正向提示词模板时 reject 中文错误', async () => {
    const bad = { ...draftJson, promptTemplate: { system: '', positive: '', negative: '' } }
    const { api } = createMockApi({ reply: JSON.stringify(bad) })
    await expect(generateWorkflowDraft(api, { model: 'gpt-text', description: '做封面' })).rejects.toThrow(
      'AI 草稿缺少正向提示词模板'
    )
  })

  it('stream error 中文传播；未选模型 / 描述为空前置校验', async () => {
    const { api } = createMockApi({ errorMessage: '分组 Key 创建失败' })
    await expect(generateWorkflowDraft(api, { model: 'gpt-text', description: '做封面' })).rejects.toThrow(
      '分组 Key 创建失败'
    )
    const idle = createMockApi({ reply: '' })
    await expect(generateWorkflowDraft(idle.api, { model: '  ', description: '做封面' })).rejects.toThrow(
      '请先选择文本模型'
    )
    await expect(generateWorkflowDraft(idle.api, { model: 'gpt-text', description: ' ' })).rejects.toThrow(
      '请先填写工作流需求描述'
    )
    expect(idle.startCalls).toHaveLength(0)
  })
})

describe('expandPrompts', () => {
  it('解析 {"prompts": string[]}，条数与 count 不符时如实返回实际条数', async () => {
    const { api } = createMockApi({ reply: '```json\n{"prompts": ["特写", "全景", "俯视"]}\n```' })
    const prompts = await expandPrompts(api, { model: 'gpt-text', basePrompt: '画柯基', rule: '按镜头', count: 5 })
    expect(prompts).toEqual(['特写', '全景', '俯视'])
  })

  it('过滤空串与非字符串条目', async () => {
    const { api } = createMockApi({ reply: '{"prompts": ["  特写  ", "", 42, null, "全景"]}' })
    const prompts = await expandPrompts(api, { model: 'gpt-text', basePrompt: 'p', rule: 'r', count: 2 })
    expect(prompts).toEqual(['特写', '全景'])
  })

  it('无有效条目 / 非 JSON 时 reject 中文错误', async () => {
    const empty = createMockApi({ reply: '{"prompts": []}' })
    await expect(expandPrompts(empty.api, { model: 'gpt-text', basePrompt: 'p', rule: 'r', count: 2 })).rejects.toThrow(
      '未返回有效的提示词列表'
    )
    const garbage = createMockApi({ reply: '这是一段解释文字' })
    await expect(
      expandPrompts(garbage.api, { model: 'gpt-text', basePrompt: 'p', rule: 'r', count: 2 })
    ).rejects.toThrow('不是有效的 JSON')
  })

  it('group 透传到 start payload；stream error 中文传播', async () => {
    const { api, startCalls } = createMockApi({ reply: '{"prompts": ["a"]}' })
    await expandPrompts(api, { model: 'gpt-text', group: '文生图', basePrompt: 'p', rule: 'r', count: 1 })
    expect(startCalls[0].group).toBe('文生图')

    const failed = createMockApi({ errorMessage: '文本模型调用失败' })
    await expect(
      expandPrompts(failed.api, { model: 'gpt-text', basePrompt: 'p', rule: 'r', count: 1 })
    ).rejects.toThrow('文本模型调用失败')
  })
})
