/**
 * 归一化 LLM 输出里的数学公式分隔符，供 remark-math 识别。
 *
 * remark-math 只认 `$...$`（行内）和 `$$...$$`（块级）。但大量模型（尤其
 * 经 OpenAI/Anthropic 训练的）习惯输出 LaTeX 原生分隔符 `\(...\)`（行内）和
 * `\[...\]`（块级），这些不会被 remark-math 解析，直接漏成原文。这里把它们
 * 转成美元语法，让同一条渲染管线覆盖两类分隔符。
 *
 * 保守原则——不破坏代码与转义：
 * - 跳过围栏代码块（``` / ~~~）与行内代码（`...`）内部，公式语法在代码里应原样保留。
 * - 只转换成对出现的 `\(...\)` / `\[...\]`；孤立分隔符原样保留。
 * - 已是 `$`/`$$` 的内容不动。
 */

/** 把一段“非代码”的普通文本里的 \(...\) 和 \[...\] 转成 $...$ / $$...$$。 */
function convertSegment(segment: string): string {
  // \[ ... \] → $$ ... $$（块级）。非贪婪，允许跨行。
  let out = segment.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `$$${body}$$`)
  // \( ... \) → $ ... $（行内）。非贪婪，允许跨行。
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`)
  return out
}

/**
 * 按代码边界切分文本，只在代码之外做分隔符归一化。
 *
 * 用一个组合正则同时匹配围栏代码块和行内代码；匹配到的代码原样保留，
 * 其余片段做转换。这样公式转换不会污染代码示例。
 */
export function normalizeMathDelimiters(input: string): string {
  if (!input || (!input.includes('\\(') && !input.includes('\\['))) return input

  // 围栏代码块：```lang\n...\n``` 或 ~~~...~~~；行内代码：`...`（含多反引号）。
  const codePattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*?`+)/g
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codePattern.exec(input)) !== null) {
    // match 之前的普通文本：转换。
    result += convertSegment(input.slice(lastIndex, match.index))
    // 代码本身：原样保留。
    result += match[0]
    lastIndex = match.index + match[0].length
  }
  // 收尾的普通文本。
  result += convertSegment(input.slice(lastIndex))
  return result
}
