// 创作工作流 UI 层的纯逻辑（07-11 image-workflow Step 4）。
//
// 面板过滤/分类、卡片复制、编辑弹窗校验等从组件剥离为纯函数，便于 node 单测
// （模式同 canvas-workbench-actions.ts）。校验结果返回结构化 code，由组件层
// 映射为 i18n 文案（用户可见文案不在本文件硬编码）。
import type { ImageWorkflowImageConfigV1, ImageWorkflowV1 } from '@shared/app-settings-types'
import {
  IMAGE_WORKFLOW_VARIABLE_KEY_PATTERN,
  generateImageWorkflowId
} from '@shared/app-settings-image-workflow'
import { resolveImageSizeValue } from '@shared/claude360-canvas'
import { listTemplateVars } from './image-workflow-run'

/**
 * 预置分类（prd R3）。注意：这是随工作流持久化的**数据值**（AI 草稿 prompt 也以
 * 中文分类输出），不是 UI 文案，故不走 i18n。
 */
export const IMAGE_WORKFLOW_PRESET_CATEGORIES: readonly string[] = [
  '多图生成',
  '电商海报',
  '小红书封面',
  '文章配图',
  '产品图'
]

/** 「新建多图」入口预置的分类（prd R1）。 */
export const IMAGE_WORKFLOW_MULTI_CATEGORY = IMAGE_WORKFLOW_PRESET_CATEGORIES[0]

/** 列出工作流中出现过的分类（去重、按出现顺序，空分类跳过），供面板筛选。 */
export function listWorkflowCategories(workflows: ImageWorkflowV1[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const workflow of workflows) {
    const category = workflow.category.trim()
    if (!category || seen.has(category)) continue
    seen.add(category)
    out.push(category)
  }
  return out
}

/**
 * 面板过滤：category 为空串 = 全部分类；query 对名称/分类/描述做大小写不敏感的
 * 包含匹配（prd R1）。
 */
export function filterImageWorkflows(
  workflows: ImageWorkflowV1[],
  category: string,
  query: string
): ImageWorkflowV1[] {
  const q = query.trim().toLowerCase()
  return workflows.filter((workflow) => {
    if (category && workflow.category !== category) return false
    if (!q) return true
    return (
      workflow.name.toLowerCase().includes(q) ||
      workflow.category.toLowerCase().includes(q) ||
      workflow.description.toLowerCase().includes(q)
    )
  })
}

/** 复制工作流：深拷贝 + 名称加「（副本）」后缀 + 新 id / 时间戳（Unix 毫秒）。 */
export function duplicateImageWorkflow(workflow: ImageWorkflowV1, now: number): ImageWorkflowV1 {
  const copy = structuredClone(workflow)
  return {
    ...copy,
    id: generateImageWorkflowId(),
    name: `${workflow.name}（副本）`,
    createdAt: now,
    updatedAt: now
  }
}

// —— 编辑弹窗校验（prd R3）——

export type ImageWorkflowValidationIssue =
  | { code: 'nameRequired' }
  | { code: 'imageModelRequired' }
  | { code: 'positiveRequired' }
  | { code: 'variableKeyInvalid'; key: string }
  | { code: 'variableKeyDuplicate'; key: string }
  | { code: 'templateVarUndefined'; key: string }
  | { code: 'expansionModelRequired' }

export type ImageWorkflowValidationResult = {
  /** 阻断保存的错误（组件层映射 i18n 文案）。 */
  errors: ImageWorkflowValidationIssue[]
  /** 已定义但未在任何模板中使用的变量 key（弱提示，不阻断保存）。 */
  unusedVariables: string[]
}

/**
 * 保存前校验：名称/生图模型/正向模板必填；变量 key 仅 [A-Za-z0-9_] 且不得重复；
 * 模板引用 {{var}} 必须已定义；多图规则启用时文本模型必填。
 */
export function validateImageWorkflow(workflow: ImageWorkflowV1): ImageWorkflowValidationResult {
  const errors: ImageWorkflowValidationIssue[] = []
  if (!workflow.name.trim()) errors.push({ code: 'nameRequired' })
  if (!workflow.imageConfig.model.trim()) errors.push({ code: 'imageModelRequired' })
  if (!workflow.promptTemplate.positive.trim()) errors.push({ code: 'positiveRequired' })

  const seen = new Set<string>()
  const definedKeys = new Set<string>()
  for (const variable of workflow.variables) {
    const key = variable.key.trim()
    if (!IMAGE_WORKFLOW_VARIABLE_KEY_PATTERN.test(key)) {
      errors.push({ code: 'variableKeyInvalid', key })
      continue
    }
    if (seen.has(key)) {
      errors.push({ code: 'variableKeyDuplicate', key })
      continue
    }
    seen.add(key)
    definedKeys.add(key)
  }

  const referenced = new Set<string>([
    ...listTemplateVars(workflow.promptTemplate.system),
    ...listTemplateVars(workflow.promptTemplate.positive),
    ...listTemplateVars(workflow.promptTemplate.negative)
  ])
  for (const key of referenced) {
    if (!definedKeys.has(key)) errors.push({ code: 'templateVarUndefined', key })
  }
  const unusedVariables = [...definedKeys].filter((key) => !referenced.has(key))

  if (workflow.textExpansion.enabled && !workflow.textExpansion.model.trim()) {
    errors.push({ code: 'expansionModelRequired' })
  }
  return { errors, unusedVariables }
}

/** i18n t 函数的最小签名（组件层传入，避免本文件依赖 react-i18next）。 */
export type ImageWorkflowTranslateFn = (key: string, opts?: Record<string, unknown>) => string

/**
 * 校验 issue → 中文提示文案（i18n key 映射；编辑弹窗与 AI「直接保存」共用同一套文案）。
 */
export function imageWorkflowIssueMessage(
  issue: ImageWorkflowValidationIssue,
  t: ImageWorkflowTranslateFn
): string {
  switch (issue.code) {
    case 'nameRequired':
      return t('canvasWorkflowErrorNameRequired')
    case 'imageModelRequired':
      return t('canvasWorkflowErrorImageModelRequired')
    case 'positiveRequired':
      return t('canvasWorkflowErrorPositiveRequired')
    case 'variableKeyInvalid':
      return t('canvasWorkflowErrorVariableKeyInvalid', { key: issue.key })
    case 'variableKeyDuplicate':
      return t('canvasWorkflowErrorVariableKeyDuplicate', { key: issue.key })
    case 'templateVarUndefined':
      return t('canvasWorkflowErrorTemplateVarUndefined', { key: issue.key })
    case 'expansionModelRequired':
      return t('canvasWorkflowErrorExpansionModelRequired')
  }
}

/** 当前输出像素串（自定义 = width x height；预设 = 预设 × 分辨率派生）。 */
export function workflowOutputSize(config: ImageWorkflowImageConfigV1): string {
  return config.aspectPresetId === 'custom'
    ? `${config.width}x${config.height}`
    : resolveImageSizeValue(config.aspectPresetId, config.resolution)
}

/** AI 创建弹窗的参考图元信息拼接（仅文本，不含像素数据，prd R2 / design §4）。 */
export function buildReferenceNotes(
  items: Array<{ name?: string; prompt?: string }>
): string {
  return items
    .map((item, index) => {
      const parts: string[] = [`参考图 ${index + 1}`]
      const name = item.name?.trim()
      const prompt = item.prompt?.trim()
      if (name) parts.push(`文件名：${name}`)
      if (prompt) parts.push(`原始提示词：${prompt}`)
      return parts.join('，')
    })
    .join('\n')
}

/** 创建时间（Unix 毫秒）→ 本地短时间；非法/缺失返回空串。 */
export function formatWorkflowTime(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return ''
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
