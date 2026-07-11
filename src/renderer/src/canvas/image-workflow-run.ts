// 创作工作流运行编排（07-11 image-workflow，renderer 纯逻辑层）。
//
// 依赖注入（generate/expand 均为闭包），不 import canvas-store / kunGui，
// 保持纯函数可测。流程（design §6）：
//   必填变量校验 → 渲染主提示词 → （可选）文本模型扩写 N 条 →
//   mapWithConcurrency 批量生图（单张 retryable 失败按 retry 重试）。
//
// 取消语义：派发每个任务前查 isCancelled()；已置 true 的任务不发请求，直接以
// 「已取消」失败结果回调（占位由容器标记）。已发出的单张 HTTP 请求无中断通道
// （IPC 无 abort），属已知局限（prd R4）。
// ensureGroupKey 由容器层在运行前调用，不在本模块内（renderer 不触碰明文 Key）。
import type {
  Claude360CanvasImage,
  Claude360ImageGeneratePayload,
  Claude360ImageResult,
  Claude360ImageSize
} from '@shared/claude360-canvas'
import { resolveImageSizeValue } from '@shared/claude360-canvas'
import type { ImageWorkflowV1 } from '@shared/app-settings-types'
import { mapWithConcurrency } from '@shared/concurrency'

// —— 模板渲染 ——

const TEMPLATE_VAR_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

/** 把模板中的 {{key}}（key 两侧允许空白）替换为对应值；未定义的占位符保持原样。 */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(TEMPLATE_VAR_PATTERN, (raw, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : raw
  )
}

/** 列出模板中引用的变量 key（去重，按出现顺序），供保存/运行前校验。 */
export function listTemplateVars(template: string): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const match of template.matchAll(TEMPLATE_VAR_PATTERN)) {
    const key = match[1]
    if (seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/**
 * 解析运行时变量的生效值：用户填写值优先，空缺回填 defaultValue；
 * 必填变量最终仍为空时抛中文错误。
 */
export function resolveWorkflowValues(
  workflow: ImageWorkflowV1,
  values: Record<string, string>
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const variable of workflow.variables) {
    const provided = values[variable.key]
    const effective =
      typeof provided === 'string' && provided.trim().length > 0 ? provided : variable.defaultValue
    if (variable.required && effective.trim().length === 0) {
      throw new Error(`请填写必填变量「${variable.label || variable.key}」`)
    }
    resolved[variable.key] = effective
  }
  return resolved
}

/**
 * 主模板渲染为最终提示词：system 渲染结果拼正文前、negative 以「不要出现：…」
 * 拼尾（images API 无 system 概念，模板层合并）；空段跳过，各段之间换行。
 */
export function buildFinalPrompt(workflow: ImageWorkflowV1, values: Record<string, string>): string {
  const segments: string[] = []
  const system = renderTemplate(workflow.promptTemplate.system, values).trim()
  const positive = renderTemplate(workflow.promptTemplate.positive, values).trim()
  const negative = renderTemplate(workflow.promptTemplate.negative, values).trim()
  if (system) segments.push(system)
  if (positive) segments.push(positive)
  if (negative) segments.push(`不要出现：${negative}`)
  return segments.join('\n')
}

/** 按 imageConfig 组装单条提示词的生成请求体（保存的参数真正进入请求，prd C4）。 */
export function buildGeneratePayload(
  workflow: ImageWorkflowV1,
  prompt: string
): Claude360ImageGeneratePayload {
  const config = workflow.imageConfig
  const size: Claude360ImageSize =
    config.aspectPresetId === 'custom'
      ? (`${config.width}x${config.height}` as Claude360ImageSize)
      : resolveImageSizeValue(config.aspectPresetId, config.resolution)
  return {
    model: config.model,
    prompt,
    size,
    n: config.count,
    quality: config.quality,
    output_format: config.format,
    // output_compression 仅对有损格式有意义（service 层同样按格式过滤）。
    ...(config.format === 'jpeg' || config.format === 'webp'
      ? { output_compression: config.compression }
      : {}),
    moderation: config.moderation,
    response_format: config.returnBase64 ? 'b64_json' : 'url',
    stream: config.stream,
    codex_cli: config.codexCliCompatible,
    timeout_ms: config.timeoutSeconds * 1000
  }
}

// —— 运行编排 ——

/** 单个任务的最终结果（cancelled 为「未派发即取消」标记）。 */
export type ImageWorkflowTaskResult =
  | { ok: true; images: Claude360CanvasImage[] }
  | { ok: false; message: string; retryable?: boolean; cancelled?: boolean }

export type ImageWorkflowRunDeps = {
  /** 生图请求（既有 claude360:canvas:generate IPC 的注入闭包）。 */
  generate: (payload: Claude360ImageGeneratePayload) => Promise<Claude360ImageResult>
  /** 多图提示词拆分（workflow-ai.expandPrompts 的注入闭包，group 由容器绑定）。 */
  expand: (input: { model: string; basePrompt: string; rule: string; count: number }) => Promise<string[]>
}

export type ImageWorkflowRunCallbacks = {
  /** 提示词条数确定后回调（扩写完成/单条主模板），容器据此显示进度分母「x/N」。 */
  onPlanned?: (total: number) => void
  /** 任务派发时回调（容器插入 pending 占位）；已取消的任务同样回调后立即回 onTaskDone。 */
  onTaskStart: (taskId: string, prompt: string) => void
  /** 任务终态回调（容器原位替换占位为 success/failed）。 */
  onTaskDone: (taskId: string, result: ImageWorkflowTaskResult) => void
  /** 取消探测：true 时停止派发新任务。 */
  isCancelled: () => boolean
}

export type ImageWorkflowRunSummary = {
  total: number
  succeeded: number
  failed: number
  /** failed 中「未派发即取消」的条数（failed 不含 cancelled）。 */
  cancelled: number
}

const CANCELLED_MESSAGE = '已取消'
const GENERATE_FALLBACK_ERROR = '生成失败，请稍后重试'

function createRunId(): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `imgwfrun_${Date.now().toString(36)}_${random}`
}

/** 单张任务：生成 + retryable 自动重试（重试间隙探测取消，取消后不再补发）。 */
async function runGenerateTask(
  deps: ImageWorkflowRunDeps,
  workflow: ImageWorkflowV1,
  prompt: string,
  isCancelled: () => boolean
): Promise<ImageWorkflowTaskResult> {
  const payload = buildGeneratePayload(workflow, prompt)
  const maxAttempts = 1 + Math.max(0, workflow.imageConfig.retry)
  let last: ImageWorkflowTaskResult = { ok: false, message: GENERATE_FALLBACK_ERROR }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await deps.generate(payload)
      if (result.ok) return { ok: true, images: result.images }
      last = { ok: false, message: result.message, ...(result.retryable ? { retryable: true } : {}) }
      if (!result.retryable) return last
    } catch (e) {
      // IPC 层意外异常：按不可重试失败处理（handler 已统一兜底，这里再兜一层）。
      return { ok: false, message: e instanceof Error && e.message ? e.message : GENERATE_FALLBACK_ERROR }
    }
    if (isCancelled()) return last
  }
  return last
}

/**
 * 运行一次工作流：变量校验 → （可选）扩写 N 条提示词 → 并发批量生图。
 * 扩写失败整次终止（reject 中文错误）；单张失败/取消不 reject，计入 summary。
 */
export async function runImageWorkflow(
  deps: ImageWorkflowRunDeps,
  workflow: ImageWorkflowV1,
  values: Record<string, string>,
  callbacks: ImageWorkflowRunCallbacks
): Promise<ImageWorkflowRunSummary> {
  const resolvedValues = resolveWorkflowValues(workflow, values)
  const basePrompt = buildFinalPrompt(workflow, resolvedValues)
  if (!basePrompt.trim()) throw new Error('正向提示词模板渲染结果为空，请检查工作流配置')

  const expansion = workflow.textExpansion
  let prompts: string[] = [basePrompt]
  let concurrency = 1
  if (expansion.enabled) {
    // 扩写失败整次运行终止（expandPrompts 抛中文错误，这里透传）。
    const expanded = await deps.expand({
      model: expansion.model,
      basePrompt,
      rule: expansion.rule,
      count: expansion.count
    })
    if (expanded.length === 0) throw new Error('未能生成多图提示词，请调整拆分规则后重试')
    prompts = expansion.prependBasePrompt
      ? expanded.map((item) => `${basePrompt}\n${item}`)
      : expanded
    concurrency = Math.max(1, expansion.concurrency)
  }

  const runId = createRunId()
  callbacks.onPlanned?.(prompts.length)
  const results = await mapWithConcurrency(prompts, concurrency, async (prompt, index) => {
    const taskId = `${runId}_${index}`
    if (callbacks.isCancelled()) {
      // 未派发即取消：不发请求，占位直接标「已取消」。
      const cancelled: ImageWorkflowTaskResult = { ok: false, message: CANCELLED_MESSAGE, cancelled: true }
      callbacks.onTaskStart(taskId, prompt)
      callbacks.onTaskDone(taskId, cancelled)
      return cancelled
    }
    callbacks.onTaskStart(taskId, prompt)
    const result = await runGenerateTask(deps, workflow, prompt, callbacks.isCancelled)
    callbacks.onTaskDone(taskId, result)
    return result
  })

  const summary: ImageWorkflowRunSummary = { total: results.length, succeeded: 0, failed: 0, cancelled: 0 }
  for (const result of results) {
    if (result.ok) summary.succeeded += 1
    else if (result.cancelled) summary.cancelled += 1
    else summary.failed += 1
  }
  return summary
}
