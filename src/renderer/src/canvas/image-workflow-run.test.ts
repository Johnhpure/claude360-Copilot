// 创作工作流运行编排纯逻辑测试（node 环境）。
// 覆盖：模板渲染 / 变量列举 / 最终提示词合成 / 请求体组装；
// runImageWorkflow：单图、多图串接、并发上限、重试、取消、部分失败、扩写失败终止、必填变量校验。
import { describe, expect, it, vi } from 'vitest'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import type {
  ImageWorkflowImageConfigV1,
  ImageWorkflowTextExpansionV1,
  ImageWorkflowV1,
  ImageWorkflowVariableV1
} from '@shared/app-settings-types'
import { defaultImageWorkflow } from '@shared/app-settings-image-workflow'
import {
  buildFinalPrompt,
  buildGeneratePayload,
  listTemplateVars,
  renderTemplate,
  resolveWorkflowValues,
  runImageWorkflow,
  type ImageWorkflowRunCallbacks,
  type ImageWorkflowRunDeps,
  type ImageWorkflowTaskResult
} from './image-workflow-run'

const NOW = 1_770_000_000_000

function variable(key: string, overrides: Partial<ImageWorkflowVariableV1> = {}): ImageWorkflowVariableV1 {
  return { key, label: key, type: 'text', required: false, defaultValue: '', options: [], ...overrides }
}

function makeWorkflow(
  overrides: Partial<Omit<ImageWorkflowV1, 'promptTemplate' | 'textExpansion' | 'imageConfig'>> & {
    promptTemplate?: Partial<ImageWorkflowV1['promptTemplate']>
    textExpansion?: Partial<ImageWorkflowTextExpansionV1>
    imageConfig?: Partial<ImageWorkflowImageConfigV1>
  } = {}
): ImageWorkflowV1 {
  const base = defaultImageWorkflow(NOW)
  const { promptTemplate, textExpansion, imageConfig, ...rest } = overrides
  return {
    ...base,
    id: 'wf-1',
    name: '测试工作流',
    variables: [variable('animal')],
    ...rest,
    promptTemplate: { ...base.promptTemplate, positive: '画一只{{animal}}', ...promptTemplate },
    textExpansion: { ...base.textExpansion, ...textExpansion },
    imageConfig: { ...base.imageConfig, model: 'gpt-image-1', ...imageConfig }
  }
}

function image(id: string): Claude360CanvasImage {
  return {
    id,
    source: 'url',
    url: `https://cdn.example/${id}.png`,
    mimeType: 'image/png',
    prompt: `p-${id}`,
    model: 'gpt-image-1',
    createdAt: '2026-07-11T00:00:00.000Z'
  }
}

function collectCallbacks(isCancelled: () => boolean = () => false): {
  started: Array<{ id: string; prompt: string }>
  done: Array<{ id: string; result: ImageWorkflowTaskResult }>
  callbacks: ImageWorkflowRunCallbacks
} {
  const started: Array<{ id: string; prompt: string }> = []
  const done: Array<{ id: string; result: ImageWorkflowTaskResult }> = []
  return {
    started,
    done,
    callbacks: {
      onTaskStart: (id, prompt) => started.push({ id, prompt }),
      onTaskDone: (id, result) => done.push({ id, result }),
      isCancelled
    }
  }
}

function okGenerate(): ImageWorkflowRunDeps['generate'] {
  return vi.fn(async () => ({ ok: true as const, images: [image('a')] }))
}

const noExpand: ImageWorkflowRunDeps['expand'] = async () => {
  throw new Error('不应调用 expand')
}

describe('renderTemplate / listTemplateVars', () => {
  it('替换 {{key}} 与 {{ key }}（两侧空白），未定义占位符保持原样', () => {
    expect(renderTemplate('画{{animal}}，风格{{ style }}，保留{{unknown}}', { animal: '柯基', style: '水彩' })).toBe(
      '画柯基，风格水彩，保留{{unknown}}'
    )
  })

  it('同一变量多处出现全部替换', () => {
    expect(renderTemplate('{{a}}+{{a}}', { a: 'x' })).toBe('x+x')
  })

  it('listTemplateVars 去重且按出现顺序', () => {
    expect(listTemplateVars('{{b}} {{a}} {{ b }} {{c}}')).toEqual(['b', 'a', 'c'])
  })
})

describe('resolveWorkflowValues', () => {
  it('用户值优先，空缺回填 defaultValue', () => {
    const wf = makeWorkflow({
      variables: [variable('animal', { defaultValue: '猫' }), variable('style', { defaultValue: '油画' })]
    })
    expect(resolveWorkflowValues(wf, { animal: '柯基' })).toEqual({ animal: '柯基', style: '油画' })
  })

  it('必填变量最终为空时抛中文错误', () => {
    const wf = makeWorkflow({ variables: [variable('animal', { label: '动物', required: true })] })
    expect(() => resolveWorkflowValues(wf, {})).toThrow('请填写必填变量「动物」')
  })
})

describe('buildFinalPrompt', () => {
  it('system 拼正文前、negative 以「不要出现：」拼尾，各段换行', () => {
    const wf = makeWorkflow({
      promptTemplate: { system: '你是{{role}}', positive: '画一只{{animal}}', negative: '水印, 模糊' }
    })
    expect(buildFinalPrompt(wf, { role: '插画师', animal: '柯基' })).toBe(
      '你是插画师\n画一只柯基\n不要出现：水印, 模糊'
    )
  })

  it('空段跳过（无 system / 无 negative 时只剩正文）', () => {
    const wf = makeWorkflow({ promptTemplate: { system: '', positive: '画一只{{animal}}', negative: '' } })
    expect(buildFinalPrompt(wf, { animal: '柯基' })).toBe('画一只柯基')
  })
})

describe('buildGeneratePayload', () => {
  it('预设宽高比由 resolveImageSizeValue 派生，png 不发 output_compression', () => {
    const wf = makeWorkflow({
      imageConfig: { aspectPresetId: 'square', resolution: '2K', format: 'png', count: 2, quality: 'high' }
    })
    const payload = buildGeneratePayload(wf, '画一只柯基')
    expect(payload).toMatchObject({
      model: 'gpt-image-1',
      prompt: '画一只柯基',
      size: '2048x2048',
      n: 2,
      quality: 'high',
      output_format: 'png',
      moderation: 'auto',
      response_format: 'url',
      stream: false,
      codex_cli: false,
      timeout_ms: 600_000
    })
    expect(payload.output_compression).toBeUndefined()
  })

  it('custom 宽高比用 WxH；jpeg/webp 发送 output_compression；returnBase64 → b64_json', () => {
    const wf = makeWorkflow({
      imageConfig: {
        aspectPresetId: 'custom',
        width: 800,
        height: 600,
        format: 'jpeg',
        compression: 80,
        returnBase64: true,
        timeoutSeconds: 120
      }
    })
    const payload = buildGeneratePayload(wf, 'p')
    expect(payload.size).toBe('800x600')
    expect(payload.output_compression).toBe(80)
    expect(payload.response_format).toBe('b64_json')
    expect(payload.timeout_ms).toBe(120_000)
  })
})

describe('runImageWorkflow · 单图', () => {
  it('未启用多图规则时用主模板渲染结果发起一次生成', async () => {
    const generate = okGenerate()
    const { started, done, callbacks } = collectCallbacks()
    const wf = makeWorkflow()
    const summary = await runImageWorkflow({ generate, expand: noExpand }, wf, { animal: '柯基' }, callbacks)

    expect(generate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generate).mock.calls[0][0].prompt).toBe('画一只柯基')
    expect(started).toHaveLength(1)
    expect(started[0].prompt).toBe('画一只柯基')
    expect(done).toHaveLength(1)
    expect(done[0].id).toBe(started[0].id)
    expect(done[0].result.ok).toBe(true)
    expect(summary).toEqual({ total: 1, succeeded: 1, failed: 0, cancelled: 0 })
  })

  it('缺必填变量时 reject 中文错误且不发起任何请求', async () => {
    const generate = okGenerate()
    const { callbacks } = collectCallbacks()
    const wf = makeWorkflow({ variables: [variable('animal', { label: '动物', required: true })] })
    await expect(runImageWorkflow({ generate, expand: noExpand }, wf, {}, callbacks)).rejects.toThrow(
      '请填写必填变量「动物」'
    )
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('runImageWorkflow · 多图规则', () => {
  it('先扩写 N 条，prependBasePrompt 时每条前接主渲染结果', async () => {
    const generate = okGenerate()
    const expand = vi.fn(async () => ['特写镜头', '全景镜头'])
    const { started, callbacks } = collectCallbacks()
    const wf = makeWorkflow({
      textExpansion: { enabled: true, model: 'gpt-text', count: 2, concurrency: 1, rule: '按镜头拆分', prependBasePrompt: true }
    })
    const summary = await runImageWorkflow({ generate, expand }, wf, { animal: '柯基' }, callbacks)

    expect(expand).toHaveBeenCalledWith({ model: 'gpt-text', basePrompt: '画一只柯基', rule: '按镜头拆分', count: 2 })
    expect(started.map((t) => t.prompt)).toEqual(['画一只柯基\n特写镜头', '画一只柯基\n全景镜头'])
    expect(summary).toEqual({ total: 2, succeeded: 2, failed: 0, cancelled: 0 })
  })

  it('关闭串接时直接用扩写结果作为提示词', async () => {
    const generate = okGenerate()
    const expand = vi.fn(async () => ['独立提示词一', '独立提示词二'])
    const { started, callbacks } = collectCallbacks()
    const wf = makeWorkflow({
      textExpansion: { enabled: true, model: 'gpt-text', count: 2, concurrency: 1, prependBasePrompt: false }
    })
    await runImageWorkflow({ generate, expand }, wf, { animal: '柯基' }, callbacks)
    expect(started.map((t) => t.prompt)).toEqual(['独立提示词一', '独立提示词二'])
  })

  it('扩写失败整次运行终止（错误透传，不发生图请求）', async () => {
    const generate = okGenerate()
    const expand = vi.fn(async () => {
      throw new Error('多图提示词生成失败：AI 未返回有效的提示词列表，请重试')
    })
    const { callbacks } = collectCallbacks()
    const wf = makeWorkflow({ textExpansion: { enabled: true, model: 'gpt-text' } })
    await expect(runImageWorkflow({ generate, expand }, wf, { animal: '柯基' }, callbacks)).rejects.toThrow(
      '多图提示词生成失败'
    )
    expect(generate).not.toHaveBeenCalled()
  })

  it('并发在途任务数不超过 concurrency', async () => {
    let active = 0
    let maxActive = 0
    const generate = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { ok: true as const, images: [image('x')] }
    })
    const expand = vi.fn(async () => ['一', '二', '三', '四', '五'])
    const { callbacks } = collectCallbacks()
    const wf = makeWorkflow({
      textExpansion: { enabled: true, model: 'gpt-text', count: 5, concurrency: 2, prependBasePrompt: false }
    })
    const summary = await runImageWorkflow({ generate, expand }, wf, { animal: '柯基' }, callbacks)
    expect(summary.succeeded).toBe(5)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(maxActive).toBeGreaterThan(1)
  })
})

describe('runImageWorkflow · 重试', () => {
  it('retryable 失败自动重试至 retry 次（retry=2 → 最多 3 次尝试）', async () => {
    const generate = vi.fn(async () => ({ ok: false as const, message: '网络错误', retryable: true }))
    const { done, callbacks } = collectCallbacks()
    const wf = makeWorkflow({ imageConfig: { retry: 2 } })
    const summary = await runImageWorkflow({ generate, expand: noExpand }, wf, { animal: '柯基' }, callbacks)
    expect(generate).toHaveBeenCalledTimes(3)
    expect(done[0].result).toMatchObject({ ok: false, message: '网络错误' })
    expect(summary).toEqual({ total: 1, succeeded: 0, failed: 1, cancelled: 0 })
  })

  it('retryable 失败一次后成功即停止重试', async () => {
    const generate = vi
      .fn<ImageWorkflowRunDeps['generate']>()
      .mockResolvedValueOnce({ ok: false, message: '网络错误', retryable: true })
      .mockResolvedValueOnce({ ok: true, images: [image('a')] })
    const { callbacks } = collectCallbacks()
    const wf = makeWorkflow({ imageConfig: { retry: 3 } })
    const summary = await runImageWorkflow({ generate, expand: noExpand }, wf, { animal: '柯基' }, callbacks)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(summary.succeeded).toBe(1)
  })

  it('非 retryable 失败不重试', async () => {
    const generate = vi.fn(async () => ({ ok: false as const, message: '提示词被拒绝' }))
    const { callbacks } = collectCallbacks()
    const wf = makeWorkflow({ imageConfig: { retry: 5 } })
    const summary = await runImageWorkflow({ generate, expand: noExpand }, wf, { animal: '柯基' }, callbacks)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(summary.failed).toBe(1)
  })

  it('generate 抛异常按不可重试失败兜底（不炸整次运行）', async () => {
    const generate = vi.fn(async () => {
      throw new Error('IPC 意外错误')
    })
    const { done, callbacks } = collectCallbacks()
    const wf = makeWorkflow({ imageConfig: { retry: 2 } })
    const summary = await runImageWorkflow({ generate, expand: noExpand }, wf, { animal: '柯基' }, callbacks)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(done[0].result).toMatchObject({ ok: false, message: 'IPC 意外错误' })
    expect(summary.failed).toBe(1)
  })
})

describe('runImageWorkflow · 取消与部分失败', () => {
  it('取消后未派发的任务不发请求、标「已取消」；已派发任务结果不受影响', async () => {
    let cancelled = false
    const generate = vi.fn(async () => {
      cancelled = true // 第一张完成后触发取消
      return { ok: true as const, images: [image('a')] }
    })
    const expand = vi.fn(async () => ['一', '二', '三'])
    const { done, callbacks } = collectCallbacks(() => cancelled)
    const wf = makeWorkflow({
      textExpansion: { enabled: true, model: 'gpt-text', count: 3, concurrency: 1, prependBasePrompt: false }
    })
    const summary = await runImageWorkflow({ generate, expand }, wf, { animal: '柯基' }, callbacks)

    expect(generate).toHaveBeenCalledTimes(1)
    expect(done).toHaveLength(3)
    expect(done[0].result.ok).toBe(true)
    expect(done[1].result).toMatchObject({ ok: false, message: '已取消', cancelled: true })
    expect(done[2].result).toMatchObject({ ok: false, message: '已取消', cancelled: true })
    expect(summary).toEqual({ total: 3, succeeded: 1, failed: 0, cancelled: 2 })
  })

  it('部分成功部分失败如实汇总', async () => {
    const generate = vi
      .fn<ImageWorkflowRunDeps['generate']>()
      .mockResolvedValueOnce({ ok: true, images: [image('a')] })
      .mockResolvedValueOnce({ ok: false, message: '内容被拒绝' })
      .mockResolvedValueOnce({ ok: true, images: [image('b')] })
    const expand = vi.fn(async () => ['一', '二', '三'])
    const { callbacks } = collectCallbacks()
    const wf = makeWorkflow({
      textExpansion: { enabled: true, model: 'gpt-text', count: 3, concurrency: 1, prependBasePrompt: false }
    })
    const summary = await runImageWorkflow({ generate, expand }, wf, { animal: '柯基' }, callbacks)
    expect(summary).toEqual({ total: 3, succeeded: 2, failed: 1, cancelled: 0 })
  })
})
