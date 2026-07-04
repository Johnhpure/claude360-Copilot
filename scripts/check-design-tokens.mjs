#!/usr/bin/env node
/**
 * check-design-tokens.mjs — Calm Blue 设计 token 守护脚本（oneui-redesign 阶段6 落地）。
 *
 * 零依赖审计：对「已完成迁移域」强制执行 spec（frontend/css-design.md）的强约束，
 * 防止字面量色值 / 死类 / 游离缓动回潮。规则：
 *   A alpha-on-var    tsx 中对 var() 自定义色使用 /alpha 修饰符（Tailwind 静默不生成，已实证陷阱）
 *   B literal-color   tsx 中的 #hex / rgb() / hsl() 字面量（UI 色必须走 token）
 *   C literal-duration tsx 中的 duration-{N}（必须 duration-[var(--motion-*)]）
 *   D raw-easing      css 中游离 cubic-bezier(（必须 --ease-* token 或 ease-exempt 演出区间）
 *
 * 用法：
 *   node scripts/check-design-tokens.mjs            # 违规 exit 1（质量门）
 *   node scripts/check-design-tokens.mjs --report   # 软模式：只列出，恒 exit 0
 *
 * 豁免机制（三层，均显式）：
 *   1. INCLUDED_SCOPES 白名单——只审计已完成迁移的域；p5/p7 完成一个域就加一行（收网清单）。
 *   2. 行级：包含 `token-exempt` 注释标记的行跳过（极少数确需保留处，须写明原因）。
 *   3. 区间级（css）：`ease-exempt:<reason>` 注释行 … `/ease-exempt` 注释行之间跳过——
 *      装饰演出动画（logo 编排/打印机/声呐）的逐帧缓动属演出设计，不强制 token 化。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src', 'renderer', 'src')

/**
 * 已完成迁移、纳入审计的域（相对 src/renderer/src，目录以 / 结尾）。
 * 未列出的路径 = 尚未迁移（p5 进行中：settings-* / my / plan / schedule / sdd / terminal /
 * workflow / PluginMarketplace 系 / components/sidebar；未认领待 p7 裁决：mcp、subagents、todo、根级散件）。
 * p5 归档后由 p7 将其域加入本数组并最终并入 `npm run lint` 主链。
 */
const INCLUDED_SCOPES = [
  'AppShell.tsx', //                p2 壳层
  'components/chat/', //            p3
  'components/write/', //           p3
  'components/canvas/', //          p4
  'components/music/', //           p4
  'components/ui/', //              p2 Primitives
  'components/shell/', //           p2 Patterns
  'components/task/', //            p4 TaskCard
  'components/Workbench.tsx', //    p2 拆壳
  'components/GroupKeyPromptModal.tsx', // p2 Modal 迁移示范
  'styles/' //                      p1–p3 归一四文件 + ui-primitives（规则 D）
]

/** 测试文件不审计（断言里合法出现旧类名/色值）。 */
const EXEMPT_FILE = [/\.test\.[tj]sx?$/, /__tests__\//]

const isReport = process.argv.includes('--report')

/** @returns {string[]} 递归收集文件 */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const relOf = (p) => relative(SRC, p).split(sep).join('/')
const inScope = (rel) =>
  INCLUDED_SCOPES.some((s) => (s.endsWith('/') ? rel.startsWith(s) : rel === s))
const isExemptFile = (rel) => EXEMPT_FILE.some((re) => re.test(rel))

/* ---- 规则正则 ---- */
// A：utility 前缀 + 自定义 var 色（ds-*/accent*）+ /alpha —— 整类静默不生成
const RE_ALPHA_ON_VAR =
  /\b(?:bg|text|border|ring|shadow|from|to|via|divide|outline|decoration|fill|stroke|caret)-(?:ds-[\w-]+|accent(?:-[\w-]+)?)\/\d+(?:\.\d+)?\b/
// B：色值字面量
const RE_HEX = /#[0-9a-fA-F]{3,8}\b/
// rgba(/hsl( 前允许 `_`/`(`/`,`（Tailwind arbitrary value 下划线形态，如 shadow-[0_2px_rgba(...)]）
const RE_FUNC_COLOR = /(?:\b|[_(,])(?:rgba?|hsla?)\(/
// C：Tailwind 时长字面量（duration-[var(...)] 因 `[` 天然不匹配）
const RE_DURATION = /\bduration-\d+\b/
// D：css 游离缓动
const RE_BEZIER = /cubic-bezier\(/

const isCommentLine = (line) => {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/** @type {{rel:string,line:number,rule:string,snippet:string}[]} */
const violations = []
const push = (rel, i, rule, line) =>
  violations.push({ rel, line: i + 1, rule, snippet: line.trim().slice(0, 120) })

for (const file of walk(SRC)) {
  const rel = relOf(file)
  if (!inScope(rel) || isExemptFile(rel)) continue

  const isTsx = /\.tsx$/.test(rel)
  const isCss = /\.css$/.test(rel) && rel.startsWith('styles/')
  if (!isTsx && !isCss) continue

  const lines = readFileSync(file, 'utf8').split('\n')
  let inEaseExempt = false

  lines.forEach((line, i) => {
    if (line.includes('token-exempt')) return

    if (isCss) {
      // 区间级豁免：演出编排段
      if (line.includes('ease-exempt:')) inEaseExempt = true
      if (line.includes('/ease-exempt')) {
        inEaseExempt = false
        return
      }
      if (inEaseExempt) return
      // token 定义行（--ease-*: cubic-bezier(...)）合法
      if (RE_BEZIER.test(line) && !/--ease-[\w-]+\s*:/.test(line)) {
        push(rel, i, 'raw-easing', line)
      }
      return
    }

    // tsx 规则
    if (isCommentLine(line)) return
    if (RE_ALPHA_ON_VAR.test(line)) push(rel, i, 'alpha-on-var', line)
    if (RE_HEX.test(line) || RE_FUNC_COLOR.test(line)) push(rel, i, 'literal-color', line)
    if (RE_DURATION.test(line)) push(rel, i, 'literal-duration', line)
  })
}

/* ---- 输出 ---- */
if (violations.length) {
  let lastFile = ''
  for (const v of violations) {
    if (v.rel !== lastFile) {
      console.log(`\n${v.rel}`)
      lastFile = v.rel
    }
    console.log(`  :${v.line} [${v.rule}] ${v.snippet}`)
  }
  const byRule = {}
  for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1
  console.log(`\n✗ ${violations.length} violation(s):`, JSON.stringify(byRule))
  if (!isReport) process.exit(1)
  console.log('(report mode — exit 0)')
} else {
  console.log('✓ design-token check passed (scopes:', INCLUDED_SCOPES.length + ')')
}
