#!/usr/bin/env node
/**
 * audit-bundle.mjs — 打包产物体积审计与黑名单守护（07-06-optimize-bundle-size 落地）。
 *
 * 零依赖审计：解析 electron-builder 产物（app.asar 头部 + app.asar.unpacked 实体文件），
 * 断言不该随包分发的包不存在，输出体积报告并与基线对比，防止依赖变更悄悄膨胀产物。
 *
 * 检查项：
 *   1. 黑名单包（asar 内与 asar.unpacked 双侧都查；实体 >1MB 才判违规，防空壳误报——
 *      files 排除规则会把 typescript 等掏成 0 字节空壳，见 design.md §1）：
 *        - @anthropic-ai/claude-agent-sdk-{linux,win32,darwin}-*（Claude Code 平台二进制，
 *          设计为运行时按需下载到 userData，见 src/main/agent-sdk-installer.ts）
 *        - typescript / vite / vitest / @rolldown/*（构建工具，不应出现在产物）
 *        - @napi-rs/canvas-*-musl（glibc 产物中的 musl 变体铁定冗余）
 *   2. 总体积基线：与 scripts/bundle-baseline.json 对比（platform 匹配时），
 *      超基线 +10% 报错。基线在每次刻意的体积优化后由人工刷新。
 *
 * 用法：
 *   node scripts/audit-bundle.mjs <产物目录>
 *   npm run audit:bundle -- dist/linux-unpacked
 *
 * 产物目录兼容三种布局（locateProduct 自动探测）：
 *   - linux/win unpacked：<dir>/resources/app.asar
 *   - mac .app 直传：     <dir>/Contents/Resources/app.asar
 *   - mac 输出目录：      <dir>/*.app/Contents/Resources/app.asar
 *
 * 退出码：0 通过；1 黑名单/基线断言失败；2 用法或产物结构错误。
 */
import { existsSync, closeSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const BASELINE_PATH = join(SCRIPT_DIR, 'bundle-baseline.json')

/** 黑名单判违规的最小实体体积：低于此值视为被 files 排除规则掏空的空壳，不报。 */
export const SIZE_FLOOR_BYTES = 1024 * 1024

/** 总体积相对基线允许的最大膨胀比例（+10%）。 */
export const BASELINE_DRIFT_RATIO = 0.1

/** 包根路径的 node_modules 段计数：==1 为顶层安装，>=2 为嵌套安装。 */
export function nodeModulesDepth(root) {
  return root.split('/').filter((segment) => segment === 'node_modules').length
}

/**
 * 黑名单规则：match 接收 (name, root)。name 为 node_modules 下的一级实体
 * （scoped 含 scope 前缀）；root 为包根相对路径，用于区分顶层 vs 嵌套安装。
 * Step 4 依赖重分类落地后，renderer-only 包名单会追加到这里。
 */
export const BLACKLIST_RULES = [
  {
    id: 'agent-sdk-platform-binary',
    match: (name) => /^@anthropic-ai\/claude-agent-sdk-(linux|win32|darwin)-/.test(name),
    reason: 'Claude Code 平台二进制应运行时按需下载到 userData（agent-sdk-installer.ts），不得随包分发'
  },
  {
    id: 'napi-rs-canvas',
    match: (name) => /^@napi-rs\/canvas(-.+)?$/.test(name),
    reason:
      'pdfjs-dist 的 canvas 渲染 optionalDependency；主进程只做 PDF 文本提取（getTextContent，' +
      '见 write-pdf-text-service.ts）不需要 canvas，已在 electron-builder.config.cjs 整体排除'
  },
  {
    // 顶层 jimp@1.x 是历史残留（src 无引用），已从 dependencies 移除。此规则仅防其
    // 经顶层安装回归：@computer-use 链条的嵌套 jimp@0.22（node_modules 深度 >=2）
    // 是自动化截图必需，绝不能误伤，故用 node_modules 深度区分顶层 vs 嵌套。
    id: 'top-level-jimp-v1',
    match: (name, root) =>
      (name === 'jimp' || name === '@jimp/core' || name === '@jimp/custom') &&
      nodeModulesDepth(root) === 1,
    reason: '顶层 jimp（v1 全源码）src 无引用，为历史残留，不得随包分发；@computer-use 嵌套 jimp@0.22 不受影响'
  },
  {
    id: 'build-tool-typescript',
    match: (name) => name === 'typescript',
    reason: '构建工具不应进入产物'
  },
  {
    id: 'build-tool-vite',
    match: (name) => name === 'vite',
    reason: '构建工具不应进入产物'
  },
  {
    id: 'build-tool-vitest',
    match: (name) => name === 'vitest',
    reason: '测试工具不应进入产物'
  },
  {
    id: 'build-tool-rolldown',
    match: (name) => name === 'rolldown' || name.startsWith('@rolldown/'),
    reason: '构建工具（含平台 binding）不应进入产物'
  },
  {
    // renderer-only 大头库（Step 4 依赖重分类落地）：这些包只被 renderer 直接 import，
    // electron-vite 已把它们 bundle 进 out/renderer，node_modules 副本纯冗余。移到
    // devDependencies 后 electron-builder 不再收集其进 asar。此规则守护回归——防其
    // 因误移回 dependencies 或被新增 prod 依赖传递引入而重新膨胀产物。
    //
    // 只列「确认不被任何保留 main/preload 生产依赖传递引用」的包（npm ls --omit=dev
    // 均查无，见 design.md §3.2）。mermaid/katex/es-toolkit 是 streamdown 的传递依赖，
    // streamdown 已一并 devDep，故它们在生产树也消失；但它们不进本名单——一旦未来某
    // 保留 prod 依赖传递引入 katex（如 react-markdown 数学插件链），黑名单会误报，
    // 宁可漏守也不误伤。这里只锁 renderer 直接依赖的顶层大库。
    id: 'renderer-only-dependency',
    match: (name) =>
      name === '@xyflow/react' ||
      name === 'lucide-react' ||
      name === 'shiki' ||
      name === 'streamdown' ||
      name === 'qrcode.react' ||
      name === 'react-i18next' ||
      name === 'i18next' ||
      name === 'zustand' ||
      name.startsWith('@codemirror/') ||
      name.startsWith('@tiptap/') ||
      name.startsWith('@xterm/'),
    reason:
      'renderer-only 依赖（Step 4 重分类为 devDependencies）；electron-vite 已 bundle 进 ' +
      'out/renderer，node_modules 副本不应随包分发'
  }
]

/* ---------------------------------------------------------------------------
 * asar 头部解析（零依赖）
 * 布局：[u32=4][u32 headerPickleSize][u32 headerStringPickleSize][u32 jsonLength][JSON...]
 * ------------------------------------------------------------------------- */

/** @returns {object} asar header JSON（{ files: {...} } 树） */
export function parseAsarHeader(buffer) {
  if (buffer.length < 16) throw new Error('asar 头部不足 16 字节')
  const magic = buffer.readUInt32LE(0)
  if (magic !== 4) throw new Error(`asar 头部魔数异常（期望 4，实测 ${magic}）`)
  const jsonLength = buffer.readUInt32LE(12)
  if (buffer.length < 16 + jsonLength) {
    throw new Error(`asar 头部 JSON 不完整（声明 ${jsonLength} 字节，缓冲仅 ${buffer.length - 16}）`)
  }
  return JSON.parse(buffer.subarray(16, 16 + jsonLength).toString('utf8'))
}

export function readAsarHeader(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const jsonBuf = Buffer.alloc(jsonLength)
    readSync(fd, jsonBuf, 0, jsonLength, 16)
    const merged = Buffer.concat([head, jsonBuf])
    return parseAsarHeader(merged)
  } finally {
    closeSync(fd)
  }
}

/**
 * 展平 asar header 为文件条目表。只收 asar 本体内的文件：
 * unpacked 标记的文件实体在 app.asar.unpacked（由文件系统侧统计），symlink 无体积，均跳过。
 * @returns {{ path: string, size: number }[]}
 */
export function collectAsarEntries(header, prefix = '') {
  const entries = []
  for (const [name, child] of Object.entries(header.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (child.files) {
      entries.push(...collectAsarEntries(child, path))
    } else if (!child.unpacked && !child.link && typeof child.size === 'number') {
      entries.push({ path, size: child.size })
    }
  }
  return entries
}

/* ---------------------------------------------------------------------------
 * 文件系统遍历（lstat，不跟符号链接，避免双计/环）
 * ------------------------------------------------------------------------- */

/** @returns {{ path: string, size: number }[]} 相对 rootDir 的文件条目（/ 分隔） */
export function walkFileEntries(rootDir) {
  const entries = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const stat = lstatSync(abs)
      if (stat.isDirectory()) {
        walk(abs)
      } else if (stat.isFile()) {
        entries.push({ path: relative(rootDir, abs).split(sep).join('/'), size: stat.size })
      }
      // symlink / socket 等：不计体积
    }
  }
  walk(rootDir)
  return entries
}

/* ---------------------------------------------------------------------------
 * 包体积归集与黑名单判定
 * ------------------------------------------------------------------------- */

/**
 * 把文件体积归集到路径上每一层 node_modules 包根（嵌套包同时计入外层与内层，
 * 保证黑名单在任意嵌套深度都能命中）。
 * @param {{ path: string, size: number }[]} entries
 * @returns {Map<string, { name: string, bytes: number }>} key 为包根相对路径
 */
export function aggregatePackages(entries) {
  const packages = new Map()
  for (const { path, size } of entries) {
    const segments = path.split('/')
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i] !== 'node_modules') continue
      const scoped = segments[i + 1]?.startsWith('@')
      const end = i + (scoped ? 3 : 2)
      if (end > segments.length) continue
      const name = segments.slice(i + 1, end).join('/')
      const root = segments.slice(0, end).join('/')
      // 包根本身是文件（如 .package-lock.json）时不是包，跳过
      if (end === segments.length) continue
      const existing = packages.get(root)
      if (existing) {
        existing.bytes += size
      } else {
        packages.set(root, { name, bytes: size })
      }
      i = end - 1
    }
  }
  return packages
}

/**
 * 对归集结果跑黑名单规则。
 * @param {Map<string, { name: string, bytes: number }>} packages
 * @param {string} side 报告用途的来源标记（如 'asar' / 'unpacked'）
 * @returns {{ ruleId: string, side: string, path: string, bytes: number, reason: string }[]}
 */
export function evaluateBlacklist(packages, side) {
  const violations = []
  for (const [root, { name, bytes }] of packages) {
    for (const rule of BLACKLIST_RULES) {
      if (rule.match(name, root) && bytes > SIZE_FLOOR_BYTES) {
        violations.push({ ruleId: rule.id, side, path: root, bytes, reason: rule.reason })
      }
    }
  }
  return violations.sort((a, b) => b.bytes - a.bytes)
}

/* ---------------------------------------------------------------------------
 * 产物布局探测与基线对比
 * ------------------------------------------------------------------------- */

/**
 * 探测产物布局，返回产物根（体积统计口径）与 resources 目录。
 * @returns {{ productRoot: string, resourcesDir: string }}
 */
export function locateProduct(productDir) {
  const dir = resolve(productDir)
  if (!existsSync(dir)) throw new Error(`产物目录不存在: ${dir}`)

  const candidates = [
    { productRoot: dir, resourcesDir: join(dir, 'resources') },
    { productRoot: dir, resourcesDir: join(dir, 'Contents', 'Resources') },
    { productRoot: dir, resourcesDir: dir }
  ]
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.app')) {
      candidates.push({
        productRoot: join(dir, entry),
        resourcesDir: join(dir, entry, 'Contents', 'Resources')
      })
    }
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate.resourcesDir, 'app.asar'))) return candidate
  }
  throw new Error(
    `在 ${dir} 下未找到 app.asar（已尝试 resources/、Contents/Resources/、*.app/）。` +
      '若为本地 dist 中断残留（只有 Electron 运行时、无 resources/），请重新完整打包。'
  )
}

/** 依据布局与顶层文件推断平台（用于基线对比的适用性判断）。 */
export function detectPlatform(productRoot, resourcesDir) {
  if (resourcesDir.split(sep).join('/').endsWith('Contents/Resources')) return 'darwin'
  for (const entry of readdirSync(productRoot)) {
    if (entry.toLowerCase().endsWith('.exe')) return 'win32'
  }
  return 'linux'
}

/**
 * 与基线对比总体积。
 * @returns {{ status: 'ok' | 'exceeded' | 'skipped', message: string }}
 */
export function compareBaseline(totalBytes, baseline, platform) {
  if (!baseline || typeof baseline.totalUnpackedBytes !== 'number') {
    return { status: 'skipped', message: '无基线数据，跳过总体积对比' }
  }
  if (baseline.platform !== platform) {
    return {
      status: 'skipped',
      message: `基线平台 ${baseline.platform} 与产物平台 ${platform} 不一致，跳过总体积对比`
    }
  }
  const limit = Math.round(baseline.totalUnpackedBytes * (1 + BASELINE_DRIFT_RATIO))
  const delta = totalBytes - baseline.totalUnpackedBytes
  const deltaPct = ((delta / baseline.totalUnpackedBytes) * 100).toFixed(1)
  const detail =
    `总体积 ${formatBytes(totalBytes)}，基线 ${formatBytes(baseline.totalUnpackedBytes)}` +
    `（${delta >= 0 ? '+' : ''}${deltaPct}%，阈值 +${BASELINE_DRIFT_RATIO * 100}%）`
  if (totalBytes > limit) {
    return { status: 'exceeded', message: `超出基线阈值：${detail}` }
  }
  return { status: 'ok', message: detail }
}

export function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024)
  return `${bytes.toLocaleString('en-US')} B (${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB)`
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

/* ---------------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------------- */

function printTopEntries(rows, limit = 30) {
  console.log(`\n—— resources 体积 TOP${limit}（[asar] 为归档内逻辑量，[unpacked]/[resources] 为实体文件量）——`)
  for (const row of rows.slice(0, limit)) {
    const mb = (row.bytes / (1024 * 1024)).toFixed(1).padStart(8)
    console.log(`${mb} MB  [${row.side}] ${row.path}`)
  }
}

function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('用法: node scripts/audit-bundle.mjs <产物目录>（如 dist/linux-unpacked、dist/mac、win-unpacked）')
    process.exit(2)
  }

  let product
  try {
    product = locateProduct(target)
  } catch (error) {
    console.error(`✗ ${error.message}`)
    process.exit(2)
  }
  const { productRoot, resourcesDir } = product
  const platform = detectPlatform(productRoot, resourcesDir)
  const asarPath = join(resourcesDir, 'app.asar')

  console.log(`产物根: ${productRoot}`)
  console.log(`resources: ${resourcesDir}（平台推断: ${platform}）`)

  // 1. 体积总账（apparent bytes，与基线口径一致）
  const productEntries = walkFileEntries(productRoot)
  const totalBytes = productEntries.reduce((sum, entry) => sum + entry.size, 0)
  const asarBytes = lstatSync(asarPath).size

  // 2. 双侧条目：asar 内逻辑量 + unpacked 实体量
  const asarEntries = collectAsarEntries(readAsarHeader(asarPath))
  const unpackedDir = join(resourcesDir, 'app.asar.unpacked')
  const unpackedEntries = existsSync(unpackedDir) ? walkFileEntries(unpackedDir) : []

  const asarPackages = aggregatePackages(asarEntries)
  const unpackedPackages = aggregatePackages(unpackedEntries)

  // 3. TOP 表：resources 直接子项 + 双侧包根，合并降序
  const rows = []
  for (const entry of readdirSync(resourcesDir)) {
    const abs = join(resourcesDir, entry)
    const stat = lstatSync(abs)
    const bytes = stat.isDirectory()
      ? walkFileEntries(abs).reduce((sum, e) => sum + e.size, 0)
      : stat.size
    rows.push({ side: 'resources', path: entry, bytes })
  }
  for (const [root, { bytes }] of asarPackages) rows.push({ side: 'asar', path: root, bytes })
  for (const [root, { bytes }] of unpackedPackages) rows.push({ side: 'unpacked', path: root, bytes })
  rows.sort((a, b) => b.bytes - a.bytes)
  printTopEntries(rows)

  console.log(`\napp.asar: ${formatBytes(asarBytes)}`)
  console.log(`产物总体积: ${formatBytes(totalBytes)}`)

  // 4. 黑名单断言（双侧）
  const violations = [
    ...evaluateBlacklist(asarPackages, 'asar'),
    ...evaluateBlacklist(unpackedPackages, 'unpacked')
  ]

  // 5. 基线对比
  const baselineResult = compareBaseline(totalBytes, loadBaseline(), platform)
  console.log(`基线对比: ${baselineResult.message}`)

  if (violations.length > 0 || baselineResult.status === 'exceeded') {
    if (violations.length > 0) {
      console.error(`\n✗ 黑名单断言失败（${violations.length} 项）:`)
      for (const v of violations) {
        console.error(`  [${v.side}] ${v.path} — ${formatBytes(v.bytes)}`)
        console.error(`    规则 ${v.ruleId}: ${v.reason}`)
      }
    }
    if (baselineResult.status === 'exceeded') {
      console.error(`\n✗ ${baselineResult.message}`)
    }
    process.exit(1)
  }

  console.log('\n✓ audit-bundle 通过：黑名单无命中，总体积在基线阈值内')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
