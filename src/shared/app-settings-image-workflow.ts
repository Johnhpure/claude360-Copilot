import {
  IMAGE_WORKFLOW_VARIABLE_TYPES,
  type ImageWorkflowImageConfigV1,
  type ImageWorkflowSettingsPatchV1,
  type ImageWorkflowSettingsV1,
  type ImageWorkflowTextExpansionV1,
  type ImageWorkflowV1,
  type ImageWorkflowVariableType,
  type ImageWorkflowVariableV1
} from './app-settings-types'
import { normalizeBoolean, normalizePositiveInteger } from './app-settings-normalizers'
import {
  CLAUDE360_ASPECT_PRESETS,
  CLAUDE360_DEFAULT_ASPECT,
  CLAUDE360_IMAGE_OUTPUT_FORMATS,
  CLAUDE360_IMAGE_QUALITIES,
  CLAUDE360_IMAGE_RESOLUTIONS
} from './claude360-canvas'

/**
 * 生图工作台「创作工作流」settings slice 的 default / normalize / merge
 * （07-11 image-workflow，范式对照 app-settings-workflow.ts）。
 *
 * normalize 保证读任意旧/坏数据都归一化为合法 shape：字段缺省补默认、
 * 枚举越界回退、数值 clamp、数组截尾——settings 演进没有 per-version
 * 迁移表，全靠这里的宽容归一化兜底。
 */

export const MAX_IMAGE_WORKFLOWS = 100
const MAX_IMAGE_WORKFLOW_VARIABLES = 50
const MAX_IMAGE_WORKFLOW_VARIABLE_OPTIONS = 50

// —— defaultImageWorkflow 的参数默认值（design §2）——
const DEFAULT_IMAGE_TIMEOUT_SECONDS = 600
const DEFAULT_IMAGE_COMPRESSION = 100
const DEFAULT_EXPANSION_COUNT = 4
const DEFAULT_EXPANSION_CONCURRENCY = 2

/** 变量 key 的合法形态（与编辑弹窗校验一致）。 */
export const IMAGE_WORKFLOW_VARIABLE_KEY_PATTERN = /^[A-Za-z0-9_]+$/

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asTrimmed(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeVariableType(value: unknown): ImageWorkflowVariableType {
  return IMAGE_WORKFLOW_VARIABLE_TYPES.includes(value as ImageWorkflowVariableType)
    ? (value as ImageWorkflowVariableType)
    : 'text'
}

function normalizeVariables(value: unknown): ImageWorkflowVariableV1[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: ImageWorkflowVariableV1[] = []
  for (const entry of value) {
    if (out.length >= MAX_IMAGE_WORKFLOW_VARIABLES) break
    const v = record(entry)
    const key = asTrimmed(v.key)
    // key 非法或重复的条目整条丢弃（编辑弹窗会阻断保存，这里兜底坏数据）。
    if (!IMAGE_WORKFLOW_VARIABLE_KEY_PATTERN.test(key) || seen.has(key)) continue
    seen.add(key)
    const type = normalizeVariableType(v.type)
    out.push({
      key,
      label: asTrimmed(v.label) || key,
      type,
      required: normalizeBoolean(v.required, false),
      defaultValue: asText(v.defaultValue),
      options:
        type === 'select' && Array.isArray(v.options)
          ? v.options
              .map((option) => asTrimmed(option))
              .filter((option) => option.length > 0)
              .slice(0, MAX_IMAGE_WORKFLOW_VARIABLE_OPTIONS)
          : []
    })
  }
  return out
}

function normalizeTextExpansion(value: unknown): ImageWorkflowTextExpansionV1 {
  const t = record(value)
  return {
    enabled: normalizeBoolean(t.enabled, false),
    model: asTrimmed(t.model),
    count: normalizePositiveInteger(t.count, DEFAULT_EXPANSION_COUNT, 1, 20),
    concurrency: normalizePositiveInteger(t.concurrency, DEFAULT_EXPANSION_CONCURRENCY, 1, 6),
    rule: asText(t.rule),
    prependBasePrompt: normalizeBoolean(t.prependBasePrompt, true)
  }
}

function normalizeAspectPresetId(value: unknown): string {
  const raw = asTrimmed(value)
  if (raw === 'custom') return raw
  return CLAUDE360_ASPECT_PRESETS.some((preset) => preset.id === raw) ? raw : CLAUDE360_DEFAULT_ASPECT
}

function normalizeResolution(value: unknown): ImageWorkflowImageConfigV1['resolution'] {
  return CLAUDE360_IMAGE_RESOLUTIONS.includes(value as ImageWorkflowImageConfigV1['resolution'])
    ? (value as ImageWorkflowImageConfigV1['resolution'])
    : '1K'
}

function normalizeQuality(value: unknown): ImageWorkflowImageConfigV1['quality'] {
  return CLAUDE360_IMAGE_QUALITIES.includes(value as ImageWorkflowImageConfigV1['quality'])
    ? (value as ImageWorkflowImageConfigV1['quality'])
    : 'auto'
}

function normalizeFormat(value: unknown): ImageWorkflowImageConfigV1['format'] {
  return CLAUDE360_IMAGE_OUTPUT_FORMATS.includes(value as ImageWorkflowImageConfigV1['format'])
    ? (value as ImageWorkflowImageConfigV1['format'])
    : 'png'
}

function normalizeModeration(value: unknown): ImageWorkflowImageConfigV1['moderation'] {
  return value === 'low' ? 'low' : 'auto'
}

function normalizeImageConfig(value: unknown): ImageWorkflowImageConfigV1 {
  const c = record(value)
  return {
    model: asTrimmed(c.model),
    aspectPresetId: normalizeAspectPresetId(c.aspectPresetId),
    // 自定义宽高：payload size 正则允许 1-5 位数字，这里 clamp 到 16..99999。
    width: normalizePositiveInteger(c.width, 1024, 16, 99_999),
    height: normalizePositiveInteger(c.height, 1024, 16, 99_999),
    resolution: normalizeResolution(c.resolution),
    quality: normalizeQuality(c.quality),
    count: normalizePositiveInteger(c.count, 1, 1, 4),
    retry: normalizePositiveInteger(c.retry, 0, 0, 5),
    format: normalizeFormat(c.format),
    compression: normalizePositiveInteger(c.compression, DEFAULT_IMAGE_COMPRESSION, 0, 100),
    moderation: normalizeModeration(c.moderation),
    stream: normalizeBoolean(c.stream, false),
    returnBase64: normalizeBoolean(c.returnBase64, false),
    codexCliCompatible: normalizeBoolean(c.codexCliCompatible, false),
    timeoutSeconds: normalizePositiveInteger(c.timeoutSeconds, DEFAULT_IMAGE_TIMEOUT_SECONDS, 30, 3_600)
  }
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/**
 * 单条工作流的宽容归一化（AI 草稿解析与列表 normalize 同源复用）。
 * `now` 为 Unix 毫秒，用作缺失时间戳的兜底。
 */
export function normalizeImageWorkflow(value: unknown, index: number, now: number): ImageWorkflowV1 {
  const w = record(value)
  const template = record(w.promptTemplate)
  return {
    id: asTrimmed(w.id) || `image-workflow-${index + 1}`,
    name: asTrimmed(w.name) || `工作流 ${index + 1}`,
    description: asText(w.description),
    category: asTrimmed(w.category),
    visibility: w.visibility === 'public' ? 'public' : 'private',
    variables: normalizeVariables(w.variables),
    promptTemplate: {
      system: asText(template.system),
      positive: asText(template.positive),
      negative: asText(template.negative)
    },
    textExpansion: normalizeTextExpansion(w.textExpansion),
    imageConfig: normalizeImageConfig(w.imageConfig),
    createdAt: normalizeTimestamp(w.createdAt, now),
    updatedAt: normalizeTimestamp(w.updatedAt, now)
  }
}

export function defaultImageWorkflowSettings(): ImageWorkflowSettingsV1 {
  return { workflows: [] }
}

/** 新建（编辑弹窗）的初始值；`now` 为 Unix 毫秒。id 由调用方生成后覆盖或沿用。 */
export function defaultImageWorkflow(now: number): ImageWorkflowV1 {
  return {
    id: generateImageWorkflowId(),
    name: '',
    description: '',
    category: '',
    visibility: 'private',
    variables: [],
    promptTemplate: { system: '', positive: '', negative: '' },
    textExpansion: {
      enabled: false,
      model: '',
      count: DEFAULT_EXPANSION_COUNT,
      concurrency: DEFAULT_EXPANSION_CONCURRENCY,
      rule: '',
      prependBasePrompt: true
    },
    imageConfig: {
      model: '',
      aspectPresetId: CLAUDE360_DEFAULT_ASPECT,
      width: 1024,
      height: 1024,
      resolution: '1K',
      quality: 'auto',
      count: 1,
      retry: 0,
      format: 'png',
      compression: DEFAULT_IMAGE_COMPRESSION,
      moderation: 'auto',
      stream: false,
      returnBase64: false,
      codexCliCompatible: false,
      timeoutSeconds: DEFAULT_IMAGE_TIMEOUT_SECONDS
    },
    createdAt: now,
    updatedAt: now
  }
}

/** 生成工作流 id：优先 crypto.randomUUID（main/renderer 均可用），退化为时间戳+随机串。 */
export function generateImageWorkflowId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `image-workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeImageWorkflowSettings(raw: unknown): ImageWorkflowSettingsV1 {
  const source = record(raw)
  const now = Date.now()
  const workflows = Array.isArray(source.workflows)
    ? source.workflows
        .slice(0, MAX_IMAGE_WORKFLOWS)
        .map((workflow, index) => normalizeImageWorkflow(workflow, index, now))
    : []
  return { workflows }
}

export function mergeImageWorkflowSettings(
  current: ImageWorkflowSettingsV1,
  patch: ImageWorkflowSettingsPatchV1 | undefined
): ImageWorkflowSettingsV1 {
  if (!patch) return normalizeImageWorkflowSettings(current)
  return normalizeImageWorkflowSettings({
    workflows: patch.workflows ?? current.workflows
  })
}
