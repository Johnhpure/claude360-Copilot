import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_WORKFLOWS,
  defaultImageWorkflow,
  defaultImageWorkflowSettings,
  generateImageWorkflowId,
  mergeImageWorkflowSettings,
  normalizeImageWorkflowSettings
} from './app-settings-image-workflow'
import type { ImageWorkflowV1 } from './app-settings-types'

function sampleWorkflow(overrides: Partial<ImageWorkflowV1> = {}): ImageWorkflowV1 {
  return { ...defaultImageWorkflow(1_700_000_000_000), id: 'wf-1', name: '海报', ...overrides }
}

describe('normalizeImageWorkflowSettings', () => {
  it('任意坏数据（非对象 / 缺 workflows）归一化为空列表', () => {
    expect(normalizeImageWorkflowSettings(undefined)).toEqual({ workflows: [] })
    expect(normalizeImageWorkflowSettings(null)).toEqual({ workflows: [] })
    expect(normalizeImageWorkflowSettings('garbage')).toEqual({ workflows: [] })
    expect(normalizeImageWorkflowSettings({ workflows: 'not-an-array' })).toEqual({ workflows: [] })
    expect(defaultImageWorkflowSettings()).toEqual({ workflows: [] })
  })

  it('缺字段补默认：空对象条目也能归一化为合法 shape', () => {
    const settings = normalizeImageWorkflowSettings({ workflows: [{}] })
    const workflow = settings.workflows[0]
    expect(workflow.id).toBe('image-workflow-1')
    expect(workflow.name).toBe('工作流 1')
    expect(workflow.visibility).toBe('private')
    expect(workflow.variables).toEqual([])
    expect(workflow.promptTemplate).toEqual({ system: '', positive: '', negative: '' })
    expect(workflow.textExpansion).toEqual({
      enabled: false,
      model: '',
      count: 4,
      concurrency: 2,
      rule: '',
      prependBasePrompt: true
    })
    expect(workflow.imageConfig).toMatchObject({
      model: '',
      aspectPresetId: 'square',
      resolution: '1K',
      quality: 'auto',
      count: 1,
      retry: 0,
      format: 'png',
      compression: 100,
      moderation: 'auto',
      stream: false,
      returnBase64: false,
      codexCliCompatible: false,
      timeoutSeconds: 600
    })
    expect(workflow.createdAt).toBeGreaterThan(0)
    expect(workflow.updatedAt).toBeGreaterThan(0)
  })

  it('枚举越界回退 + 数值越界 clamp', () => {
    const settings = normalizeImageWorkflowSettings({
      workflows: [
        {
          id: 'wf-1',
          visibility: 'team',
          textExpansion: { enabled: true, count: 999, concurrency: 0, prependBasePrompt: 'yes' },
          imageConfig: {
            aspectPresetId: 'not-a-preset',
            width: 3,
            height: 1_000_000,
            resolution: '8K',
            quality: 'ultra',
            count: 40,
            retry: -3,
            format: 'gif',
            compression: 250,
            moderation: 'strict',
            timeoutSeconds: 1
          }
        }
      ]
    })
    const workflow = settings.workflows[0]
    expect(workflow.visibility).toBe('private')
    expect(workflow.textExpansion.count).toBe(20)
    expect(workflow.textExpansion.concurrency).toBe(1)
    // 非布尔的 prependBasePrompt 回退默认 true。
    expect(workflow.textExpansion.prependBasePrompt).toBe(true)
    expect(workflow.imageConfig.aspectPresetId).toBe('square')
    expect(workflow.imageConfig.width).toBe(16)
    expect(workflow.imageConfig.height).toBe(99_999)
    expect(workflow.imageConfig.resolution).toBe('1K')
    expect(workflow.imageConfig.quality).toBe('auto')
    expect(workflow.imageConfig.count).toBe(4)
    expect(workflow.imageConfig.retry).toBe(0)
    expect(workflow.imageConfig.format).toBe('png')
    expect(workflow.imageConfig.compression).toBe(100)
    expect(workflow.imageConfig.moderation).toBe('auto')
    expect(workflow.imageConfig.timeoutSeconds).toBe(30)
  })

  it('变量归一化：非法 key / 重复 key 丢弃，select 之外 options 清空', () => {
    const settings = normalizeImageWorkflowSettings({
      workflows: [
        {
          id: 'wf-1',
          variables: [
            { key: 'topic', label: '', type: 'text', options: ['应被清空'] },
            { key: 'topic', label: '重复', type: 'text' },
            { key: '非法 key!', label: 'bad' },
            { key: 'style', label: '风格', type: 'select', options: ['扁平', ' 3D ', ''] },
            { key: 'size', type: 'not-a-type', required: 'yes', defaultValue: 42 }
          ]
        }
      ]
    })
    const variables = settings.workflows[0].variables
    expect(variables.map((variable) => variable.key)).toEqual(['topic', 'style', 'size'])
    // label 缺省回退 key；非 select 的 options 恒为 []。
    expect(variables[0]).toMatchObject({ label: 'topic', type: 'text', options: [] })
    expect(variables[1].options).toEqual(['扁平', '3D'])
    // 未知类型回退 text，非布尔 required 回退 false，非字符串 defaultValue 回退 ''。
    expect(variables[2]).toMatchObject({ type: 'text', required: false, defaultValue: '' })
  })

  it('保留合法字段与 Unix 毫秒时间戳', () => {
    const workflow = sampleWorkflow({ createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_001 })
    const settings = normalizeImageWorkflowSettings({ workflows: [workflow] })
    expect(settings.workflows[0]).toEqual(workflow)
  })

  it('超上限截尾：最多保留 MAX_IMAGE_WORKFLOWS 条', () => {
    const workflows = Array.from({ length: MAX_IMAGE_WORKFLOWS + 5 }, (_, index) => ({ id: `wf-${index}` }))
    const settings = normalizeImageWorkflowSettings({ workflows })
    expect(settings.workflows).toHaveLength(MAX_IMAGE_WORKFLOWS)
    expect(settings.workflows[0].id).toBe('wf-0')
  })
})

describe('mergeImageWorkflowSettings', () => {
  it('patch 未提供 workflows 时保留现状', () => {
    const current = { workflows: [sampleWorkflow()] }
    expect(mergeImageWorkflowSettings(current, undefined).workflows).toHaveLength(1)
    expect(mergeImageWorkflowSettings(current, {}).workflows).toHaveLength(1)
  })

  it('workflows present 即整体替换（含空数组清空）', () => {
    const current = { workflows: [sampleWorkflow()] }
    const replaced = mergeImageWorkflowSettings(current, {
      workflows: [sampleWorkflow({ id: 'wf-2', name: '封面' })]
    })
    expect(replaced.workflows.map((workflow) => workflow.id)).toEqual(['wf-2'])
    expect(mergeImageWorkflowSettings(current, { workflows: [] }).workflows).toEqual([])
  })

  it('merge 结果同样经过归一化（坏 patch 不落盘坏数据）', () => {
    const merged = mergeImageWorkflowSettings(defaultImageWorkflowSettings(), {
      workflows: [{ imageConfig: { count: 99 } } as Partial<ImageWorkflowV1>]
    })
    expect(merged.workflows[0].imageConfig.count).toBe(4)
  })
})

describe('defaultImageWorkflow', () => {
  it('新建初始值符合 design 默认参数且时间戳取传入 now', () => {
    const now = 1_720_000_000_000
    const workflow = defaultImageWorkflow(now)
    expect(workflow.createdAt).toBe(now)
    expect(workflow.updatedAt).toBe(now)
    expect(workflow.imageConfig).toMatchObject({
      format: 'png',
      resolution: '1K',
      quality: 'auto',
      count: 1,
      retry: 0,
      timeoutSeconds: 600,
      moderation: 'auto',
      compression: 100
    })
    expect(workflow.id).toBeTruthy()
  })

  it('generateImageWorkflowId 每次生成唯一 id', () => {
    expect(generateImageWorkflowId()).not.toBe(generateImageWorkflowId())
  })
})
