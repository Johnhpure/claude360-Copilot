// image-workflow-ui 纯逻辑单测（07-11 image-workflow Step 4）：
// 面板过滤/分类、复制语义、编辑弹窗校验、输出尺寸、参考图元信息拼接。
import { describe, expect, it } from 'vitest'
import { defaultImageWorkflow } from '@shared/app-settings-image-workflow'
import type { ImageWorkflowV1 } from '@shared/app-settings-types'
import {
  IMAGE_WORKFLOW_MULTI_CATEGORY,
  IMAGE_WORKFLOW_PRESET_CATEGORIES,
  buildReferenceNotes,
  duplicateImageWorkflow,
  filterImageWorkflows,
  formatWorkflowTime,
  imageWorkflowIssueMessage,
  listWorkflowCategories,
  validateImageWorkflow,
  workflowOutputSize
} from './image-workflow-ui'

function makeWorkflow(partial: Partial<ImageWorkflowV1> = {}): ImageWorkflowV1 {
  const base = defaultImageWorkflow(1_700_000_000_000)
  return {
    ...base,
    name: '测试工作流',
    imageConfig: { ...base.imageConfig, model: 'img-model' },
    promptTemplate: { system: '', positive: '画一张 {{topic}} 的图', negative: '' },
    variables: [
      { key: 'topic', label: '主题', type: 'text', required: true, defaultValue: '', options: [] }
    ],
    ...partial
  }
}

describe('listWorkflowCategories / filterImageWorkflows', () => {
  it('分类去重且跳过空分类；过滤支持分类 + 名称/分类/描述包含匹配（大小写不敏感）', () => {
    const workflows = [
      makeWorkflow({ id: 'a', name: 'Cover Maker', category: '小红书封面', description: '封面' }),
      makeWorkflow({ id: 'b', name: '海报', category: '电商海报', description: 'Poster flow' }),
      makeWorkflow({ id: 'c', name: '无分类', category: '' }),
      makeWorkflow({ id: 'd', name: '重复分类', category: '小红书封面' })
    ]
    expect(listWorkflowCategories(workflows)).toEqual(['小红书封面', '电商海报'])
    expect(filterImageWorkflows(workflows, '小红书封面', '').map((w) => w.id)).toEqual(['a', 'd'])
    expect(filterImageWorkflows(workflows, '', 'cover').map((w) => w.id)).toEqual(['a'])
    expect(filterImageWorkflows(workflows, '', 'poster').map((w) => w.id)).toEqual(['b'])
    expect(filterImageWorkflows(workflows, '电商海报', '封面')).toEqual([])
  })

  it('预置分类包含「多图生成」且与新建多图入口常量一致', () => {
    expect(IMAGE_WORKFLOW_PRESET_CATEGORIES).toContain(IMAGE_WORKFLOW_MULTI_CATEGORY)
  })
})

describe('duplicateImageWorkflow', () => {
  it('深拷贝 + 名称加（副本）后缀 + 新 id/时间戳；嵌套对象不共享引用', () => {
    const source = makeWorkflow({ id: 'src' })
    const copy = duplicateImageWorkflow(source, 1_800_000_000_000)
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toBe('测试工作流（副本）')
    expect(copy.createdAt).toBe(1_800_000_000_000)
    expect(copy.updatedAt).toBe(1_800_000_000_000)
    expect(copy.variables).not.toBe(source.variables)
    expect(copy.imageConfig).not.toBe(source.imageConfig)
    copy.variables[0].label = '改'
    expect(source.variables[0].label).toBe('主题')
  })
})

describe('validateImageWorkflow', () => {
  it('合法工作流无错误；未使用变量给弱提示（不阻断）', () => {
    const ok = validateImageWorkflow(makeWorkflow())
    expect(ok.errors).toEqual([])
    expect(ok.unusedVariables).toEqual([])

    const withUnused = validateImageWorkflow(
      makeWorkflow({
        variables: [
          { key: 'topic', label: '主题', type: 'text', required: true, defaultValue: '', options: [] },
          { key: 'extra', label: '备用', type: 'text', required: false, defaultValue: '', options: [] }
        ]
      })
    )
    expect(withUnused.errors).toEqual([])
    expect(withUnused.unusedVariables).toEqual(['extra'])
  })

  it('名称/生图模型/正向模板必填', () => {
    const result = validateImageWorkflow(
      makeWorkflow({
        name: '  ',
        imageConfig: { ...makeWorkflow().imageConfig, model: '' },
        promptTemplate: { system: '', positive: '', negative: '' },
        variables: []
      })
    )
    const codes = result.errors.map((issue) => issue.code)
    expect(codes).toContain('nameRequired')
    expect(codes).toContain('imageModelRequired')
    expect(codes).toContain('positiveRequired')
  })

  it('变量 key 非法/重复报错；模板引用未定义变量报错', () => {
    const result = validateImageWorkflow(
      makeWorkflow({
        variables: [
          { key: 'ok_1', label: '', type: 'text', required: false, defaultValue: '', options: [] },
          { key: '中文key', label: '', type: 'text', required: false, defaultValue: '', options: [] },
          { key: 'ok_1', label: '', type: 'text', required: false, defaultValue: '', options: [] }
        ],
        promptTemplate: { system: '', positive: '用 {{ok_1}} 与 {{missing}}', negative: '' }
      })
    )
    expect(result.errors).toContainEqual({ code: 'variableKeyInvalid', key: '中文key' })
    expect(result.errors).toContainEqual({ code: 'variableKeyDuplicate', key: 'ok_1' })
    expect(result.errors).toContainEqual({ code: 'templateVarUndefined', key: 'missing' })
  })

  it('多图规则启用且未选文本模型时报错；未启用不报', () => {
    const base = makeWorkflow()
    const enabled = validateImageWorkflow(
      makeWorkflow({ textExpansion: { ...base.textExpansion, enabled: true, model: '' } })
    )
    expect(enabled.errors).toContainEqual({ code: 'expansionModelRequired' })
    const disabled = validateImageWorkflow(
      makeWorkflow({ textExpansion: { ...base.textExpansion, enabled: false, model: '' } })
    )
    expect(disabled.errors).toEqual([])
  })
})

describe('imageWorkflowIssueMessage', () => {
  it('全部 issue code 映射到 canvasWorkflowError* 词条；带 key 的 issue 透传参数', () => {
    const calls: Array<{ key: string; opts?: Record<string, unknown> }> = []
    const t = (key: string, opts?: Record<string, unknown>): string => {
      calls.push({ key, ...(opts ? { opts } : {}) })
      return key
    }
    expect(imageWorkflowIssueMessage({ code: 'nameRequired' }, t)).toBe(
      'canvasWorkflowErrorNameRequired'
    )
    expect(imageWorkflowIssueMessage({ code: 'imageModelRequired' }, t)).toBe(
      'canvasWorkflowErrorImageModelRequired'
    )
    expect(imageWorkflowIssueMessage({ code: 'positiveRequired' }, t)).toBe(
      'canvasWorkflowErrorPositiveRequired'
    )
    expect(imageWorkflowIssueMessage({ code: 'expansionModelRequired' }, t)).toBe(
      'canvasWorkflowErrorExpansionModelRequired'
    )
    expect(imageWorkflowIssueMessage({ code: 'variableKeyInvalid', key: 'k1' }, t)).toBe(
      'canvasWorkflowErrorVariableKeyInvalid'
    )
    expect(imageWorkflowIssueMessage({ code: 'variableKeyDuplicate', key: 'k2' }, t)).toBe(
      'canvasWorkflowErrorVariableKeyDuplicate'
    )
    expect(imageWorkflowIssueMessage({ code: 'templateVarUndefined', key: 'k3' }, t)).toBe(
      'canvasWorkflowErrorTemplateVarUndefined'
    )
    expect(calls.filter((call) => call.opts)).toEqual([
      { key: 'canvasWorkflowErrorVariableKeyInvalid', opts: { key: 'k1' } },
      { key: 'canvasWorkflowErrorVariableKeyDuplicate', opts: { key: 'k2' } },
      { key: 'canvasWorkflowErrorTemplateVarUndefined', opts: { key: 'k3' } }
    ])
  })
})

describe('workflowOutputSize', () => {
  it('预设 = 预设 × 分辨率派生；custom = width x height', () => {
    const base = makeWorkflow().imageConfig
    expect(workflowOutputSize({ ...base, aspectPresetId: 'square', resolution: '2K' })).toBe(
      '2048x2048'
    )
    expect(
      workflowOutputSize({ ...base, aspectPresetId: 'custom', width: 800, height: 600 })
    ).toBe('800x600')
  })
})

describe('buildReferenceNotes / formatWorkflowTime', () => {
  it('拼接素材文件名与提示词元信息（仅文本）；空字段跳过', () => {
    const notes = buildReferenceNotes([
      { name: 'cover.png', prompt: '蓝色海报' },
      { name: 'photo.jpg' },
      { prompt: '仅提示词' }
    ])
    expect(notes).toContain('参考图 1，文件名：cover.png，原始提示词：蓝色海报')
    expect(notes).toContain('参考图 2，文件名：photo.jpg')
    expect(notes).toContain('参考图 3，原始提示词：仅提示词')
  })

  it('非法时间戳返回空串；合法毫秒时间戳产出非空本地时间', () => {
    expect(formatWorkflowTime(0)).toBe('')
    expect(formatWorkflowTime(Number.NaN)).toBe('')
    expect(formatWorkflowTime(1_700_000_000_000)).not.toBe('')
  })
})
