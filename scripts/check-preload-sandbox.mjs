#!/usr/bin/env node
/**
 * check-preload-sandbox.mjs — preload 沙箱依赖守护(构建自检)。
 *
 * 背景:preload 运行在沙箱中,运行时 require() 只能加载 'electron' 与少数
 * polyfill 模块(events/timers/url),无法加载任何 node_modules。v0.2.12/13
 * 曾因 preload 值引入 '../shared/crash-types'(顶层 import zod)且 zod 被
 * externalizeDepsPlugin 外置,打包版 preload 整体加载失败——window.kunGui
 * 消失,全部功能表现为「连接失败」。源码级守护见
 * src/preload/preload-sandbox-safety.test.ts;本脚本在【构建产物】层面
 * 再拦一道:直接断言 out/preload/*.cjs 的外部 require 全部在沙箱白名单内。
 *
 * 用法:
 *   node scripts/check-preload-sandbox.mjs            # 检查 out/preload,违规 exit 1
 *   node scripts/check-preload-sandbox.mjs <dir>      # 检查指定目录(自测用)
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = join(import.meta.dirname, '..')
const targetDir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, 'out', 'preload')

/** Electron 沙箱 preload 中 require 可用的模块(polyfill 子集)。 */
const SANDBOX_ALLOWED = new Set([
  'electron',
  'events',
  'node:events',
  'timers',
  'node:timers',
  'url',
  'node:url'
])

let files = []
try {
  files = readdirSync(targetDir).filter((file) => file.endsWith('.cjs') || file.endsWith('.js'))
} catch {
  console.error(`✗ preload-sandbox check: cannot read ${targetDir} — run the build first.`)
  process.exit(1)
}
if (files.length === 0) {
  console.error(`✗ preload-sandbox check: no bundles found in ${targetDir} — run the build first.`)
  process.exit(1)
}

const violations = []
for (const file of files) {
  const source = readFileSync(join(targetDir, file), 'utf8')
  for (const match of source.matchAll(/\brequire\(\s*(["'])([^"')]+)\1\s*\)/g)) {
    const specifier = match[2]
    // 相对路径属于 bundle 内部分块,允许。
    if (specifier.startsWith('./') || specifier.startsWith('../')) continue
    if (!SANDBOX_ALLOWED.has(specifier)) violations.push({ file, specifier })
  }
}

if (violations.length > 0) {
  console.error('✗ preload-sandbox check failed — sandboxed preload cannot require these at runtime:')
  for (const { file, specifier } of violations) {
    console.error(`    ${file}: require("${specifier}")`)
  }
  console.error(
    '  Fix: keep preload value-imports zod-free (import from dependency-free shared modules,\n' +
    '  e.g. src/shared/crash-channel.ts), or bundle the dependency via\n' +
    "  externalizeDepsPlugin({ exclude: [...] }) in electron.vite.config.ts's preload section."
  )
  process.exit(1)
}

console.log(`✓ preload-sandbox check passed (${files.length} bundle(s), externals within sandbox allowlist)`)
