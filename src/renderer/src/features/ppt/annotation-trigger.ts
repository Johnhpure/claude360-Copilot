/**
 * PPT Master 标注自动触发：判定逻辑。
 *
 * ppt-master 的浏览器 SVG 编辑器（`scripts/svg_editor`）在用户点「应用修改」时
 * 只把结果写进磁盘——标注写成 SVG 上的 `data-edit-annotation` 属性并追加
 * `live_preview/annotations.jsonl`，直接编辑则追加 `live_preview/edits.jsonl`。
 * 它**没有任何通知 agent 的通道**，skill 的 `workflows/stages/live-preview.md`
 * 要求用户自己回聊天说一句 `apply my annotations`。用户的实际体验是「点了按钮
 * 没反应」，所以这里从日志变化反推该不该替用户把那句话发出去。
 *
 * 本模块只做纯粹的判定，不碰 IPC、不碰 store，便于单测覆盖各种边界。
 */

/**
 * 从一条 bash 命令里认出 SVG 编辑器的启动，并取出它操作的项目目录。
 *
 * skill 规定的形式是 `python3 <skill>/scripts/svg_editor/server.py <project> [flags]`
 * （live-preview.md Step 1），实际命令可能带 `cd ... &&` 前缀、路径可能被单引号
 * 或双引号包起来。这里只认 `svg_editor/server.py` 之后的第一个非选项参数，
 * 不去猜项目根的位置——它既可能在工作区的 `projects/` 下，也可能在 skill 自带的
 * `projects/` 下，取决于模型当时的选择。
 */
export function extractSvgEditorProject(command: string): string | null {
  const marker = command.indexOf('svg_editor/server.py')
  if (marker < 0) return null
  let rest = command.slice(marker + 'svg_editor/server.py'.length)
  // 脚本路径自身可能是被引号包住的，跳过那个收尾引号。
  rest = rest.replace(/^['"]/, '')

  for (const token of tokenizeShellArgs(rest)) {
    if (token.startsWith('-')) continue
    return token
  }
  return null
}

/** 够用的 shell 分词：认单/双引号，不处理转义与变量展开。 */
function tokenizeShellArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      // `&&`、`;` 之后就是另一条命令了，项目参数不会出现在那边。
      continue
    }
    if (char === '&' || char === ';' || char === '|') {
      if (current) tokens.push(current)
      return tokens
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

/** 会话里一个工具块的最小形状——只取认路径需要的字段。 */
export type ToolBlockLike = {
  kind?: string
  meta?: Record<string, unknown>
  summary?: string
}

/**
 * 找出会话里**最后一次**编辑器启动对应的项目目录。
 *
 * 从后往前扫：一个会话可能先后开过不同项目（换主题重做），最新那次才是
 * 用户眼前正在看的那个。
 */
export function activeEditorProject(blocks: readonly ToolBlockLike[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block?.kind !== 'tool') continue
    const command =
      typeof block.meta?.command === 'string' ? block.meta.command : block.summary ?? ''
    const project = extractSvgEditorProject(command)
    if (project) return project
  }
  return null
}

/** `live_preview/*.jsonl` 里的一条记录。skill 写入的字段，勿改名。 */
export type LivePreviewLogRecord = {
  /** Python `time.time()`，秒级浮点。 */
  ts: number
  file: string
  element_id: string
  action: string
}

export type AnnotationTriggerKind =
  /** 有待应用的 AI 标注 → 让 agent 跑 check_annotations.py 并逐条改。 */
  | 'apply-annotations'
  /** 只有确定性的直接编辑（已写进 SVG）→ agent 只需重新导出 PPTX。 */
  | 're-export'

export type AnnotationTrigger = {
  kind: AnnotationTriggerKind
  /** 触发这次判定的最大 ts，调用方存下来用于去重。 */
  ts: number
}

function parseLog(jsonl: string): LivePreviewLogRecord[] {
  const records: LivePreviewLogRecord[] = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<LivePreviewLogRecord>
      if (
        typeof parsed?.ts === 'number' &&
        typeof parsed.action === 'string' &&
        typeof parsed.file === 'string' &&
        typeof parsed.element_id === 'string'
      ) {
        records.push(parsed as LivePreviewLogRecord)
      }
    } catch {
      // 半行/损坏行：编辑器可能正在追加。跳过而不是丢弃整份日志。
    }
  }
  return records
}

/**
 * 逐个 (file, element_id) 看它的**最后一条**记录，而不是全局比时间戳：
 * agent 应用标注是一条条来的，用全局时间会把「刚应用完一条、还剩两条」
 * 误判成全部完成。最后一条是 saved/updated 才算还欠着。
 */
export function pendingAnnotations(annotationsJsonl: string): {
  hasPending: boolean
  latestTs: number
} {
  const lastByElement = new Map<string, LivePreviewLogRecord>()
  for (const record of parseLog(annotationsJsonl)) {
    const key = `${record.file}::${record.element_id}`
    const previous = lastByElement.get(key)
    if (!previous || record.ts >= previous.ts) lastByElement.set(key, record)
  }
  let hasPending = false
  let latestTs = 0
  for (const record of lastByElement.values()) {
    if (record.action !== 'annotation_saved' && record.action !== 'annotation_updated') continue
    hasPending = true
    if (record.ts > latestTs) latestTs = record.ts
  }
  return { hasPending, latestTs }
}

/** 直接编辑没有「已应用」状态（保存即写进 SVG），只能靠时间戳判新旧。 */
export function latestEditTs(editsJsonl: string): number {
  let latest = 0
  for (const record of parseLog(editsJsonl)) {
    if (record.ts > latest) latest = record.ts
  }
  return latest
}

export type DecideTriggerInput = {
  /** `live_preview/annotations.jsonl` 内容；文件不存在传空串。 */
  annotationsJsonl: string
  /** `live_preview/edits.jsonl` 内容；文件不存在传空串。 */
  editsJsonl: string
  /** 上一次已经触发过的 ts，用于去重。首次传 0。 */
  lastHandledTs: number
  /**
   * `exports/` 是否已有 .pptx。live-preview.md Step 2 有硬 GATE：Step 7 导出
   * 完成前不允许应用标注。此时发消息只会被 skill 当场拒绝，不如不发。
   */
  hasExportedPptx: boolean
}

/**
 * 决定这次日志变化要不要替用户发消息、发哪一句。返回 `null` 表示什么都不做。
 *
 * 标注优先于直接编辑：一次提交里两者都有时，应用标注的流程本身就会重新导出，
 * 单独再发一次「重新导出」是多余的。
 */
export function decideTrigger(input: DecideTriggerInput): AnnotationTrigger | null {
  if (!input.hasExportedPptx) return null

  const annotations = pendingAnnotations(input.annotationsJsonl)
  if (annotations.hasPending && annotations.latestTs > input.lastHandledTs) {
    return { kind: 'apply-annotations', ts: annotations.latestTs }
  }

  const editTs = latestEditTs(input.editsJsonl)
  if (editTs > input.lastHandledTs) {
    return { kind: 're-export', ts: editTs }
  }

  return null
}

/**
 * 触发时替用户发出的话。用中文写给中文用户，同时带上 skill 认得的英文触发词
 * （live-preview.md 的 "When to Run" 列了 `apply my annotations` / `应用注解`
 * 等等价表达），避免模型把它当成普通闲聊。
 */
export function triggerMessage(kind: AnnotationTriggerKind): string {
  if (kind === 'apply-annotations') {
    return '我在 SVG 编辑器里提交了标注，请应用它们（apply my annotations）：跑 check_annotations.py 读取待处理标注，逐条修改对应页面，然后重新导出 PPTX。'
  }
  return '我在 SVG 编辑器里直接改了页面元素并已保存到 svg_output，请重新导出 PPTX。'
}
