/**
 * 从助手回复里认出「刚生成的文档」路径，好在气泡下面给一个打开入口。
 *
 * 起因：PPT 是 ppt-master skill 用 bash 跑 Python 脚本产出的，运行时不会像
 * 内置的写作/绘图工具那样把它登记进 `meta.generatedFiles`，所以现成的
 * `GeneratedFilesPanel` 看不见它。助手自己会在收尾时报出绝对路径
 * （"**PPTX 文件：** `/…/exports/xxx.pptx`"），从那句话里取路径最直接。
 */

/**
 * 只认最终交付物，不认中间产物。
 *
 * 刻意不收 `.md` / `.json` / `.svg`：PPT 流程里满地都是 design_spec.md、
 * recommendations.stage2.json、逐页 SVG 这类过程文件，全渲染成打开按钮
 * 只会淹没真正要打开的那一个。
 */
const ARTIFACT_EXTENSIONS = [
  'pptx',
  'ppt',
  'docx',
  'doc',
  'xlsx',
  'xls',
  'pdf',
  'csv'
] as const

/**
 * 绝对路径 + 白名单扩展名。
 *
 * 路径里允许中文（用户的项目名常是中文），所以排除法只挡掉空白和成对符号：
 * 反引号、引号、括号、尖括号——助手爱把路径包在反引号或 markdown 链接里，
 * 不挡的话结尾的 `` ` `` 会被吃进路径。
 *
 * 开头的 lookbehind 不能省：没有它，相对路径 `exports/deck.pptx` 里的
 * `/deck.pptx` 会被当成一个绝对路径匹配出来，点开必然失败。
 */
const ARTIFACT_PATH_PATTERN = new RegExp(
  `(?<![\\w./\\\\-])(?:[A-Za-z]:\\\\|/)(?:[^\\s\`'"()\\[\\]<>,;:]|[,;:](?![\\s]))+\\.(?:${ARTIFACT_EXTENSIONS.join('|')})`,
  'gi'
)

export type ArtifactPath = {
  /** 绝对路径，原样保留供 openEditorPath 使用。 */
  path: string
  /** 末段文件名，用于展示。 */
  name: string
}

function fileName(path: string): string {
  const segments = path.split(/[/\\]/)
  return segments[segments.length - 1] ?? path
}

/**
 * 提取助手文本里提到的产物文件，按出现顺序去重。
 *
 * 同一条回复里通常只有一个最终文件，但「导出了 PPTX + 附带 PDF」这种也存在，
 * 所以返回数组。
 */
export function extractArtifactPaths(text: string): ArtifactPath[] {
  if (!text) return []
  const seen = new Set<string>()
  const results: ArtifactPath[] = []
  for (const match of text.matchAll(ARTIFACT_PATH_PATTERN)) {
    const raw = match[0]
    // 助手偶尔把路径写成 markdown 链接或句末带标点，收尾的标点不属于路径。
    const path = raw.replace(/[.,;:]+$/, '')
    if (seen.has(path)) continue
    seen.add(path)
    results.push({ path, name: fileName(path) })
  }
  return results
}
