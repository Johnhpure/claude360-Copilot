import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// audit-bundle.mjs 是零依赖 ESM 脚本；Node >= 22.12 支持 require(esm)，
// 与 packaging-config.test.ts 加载仓库根脚本的先例保持一致。
const require = createRequire(import.meta.url)
const audit = require('../../scripts/audit-bundle.mjs')

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'audit-bundle-'))
  tempRoots.push(root)
  return root
}

/** 写一个指定字节数的占位文件（自动建父目录）。 */
function writeSized(path: string, bytes: number): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 0x61))
}

/** 构造最小合法 asar 头（[u32=4][u32][u32][u32 jsonLen][JSON]），与脚本解析布局对应。 */
function asarHeaderBuffer(header: object): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const buf = Buffer.alloc(16 + json.length)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(json.length + 8, 4)
  buf.writeUInt32LE(json.length + 4, 8)
  buf.writeUInt32LE(json.length, 12)
  json.copy(buf, 16)
  return buf
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('audit-bundle asar 头部解析', () => {
  it('round-trip 解析构造的 asar 头', () => {
    const header = { files: { 'a.js': { size: 3, offset: '0' } } }
    expect(audit.parseAsarHeader(asarHeaderBuffer(header))).toEqual(header)
  })

  it('拒绝魔数异常的缓冲', () => {
    const buf = asarHeaderBuffer({ files: {} })
    buf.writeUInt32LE(7, 0)
    expect(() => audit.parseAsarHeader(buf)).toThrow(/魔数/)
  })

  it('collectAsarEntries 只收归档内文件，跳过 unpacked 与 symlink', () => {
    const header = {
      files: {
        out: { files: { 'main.js': { size: 10, offset: '0' } } },
        node_modules: {
          files: {
            'better-sqlite3': { files: { 'index.node': { size: 999, unpacked: true } } },
            react: { files: { 'index.js': { size: 5, offset: '10' }, link: { link: 'index.js' } } }
          }
        }
      }
    }
    expect(audit.collectAsarEntries(header)).toEqual([
      { path: 'out/main.js', size: 10 },
      { path: 'node_modules/react/index.js', size: 5 }
    ])
  })
})

describe('audit-bundle 包归集与黑名单', () => {
  const MB = 1024 * 1024

  it('嵌套 node_modules 的包体积同时计入外层与内层包根', () => {
    const packages = audit.aggregatePackages([
      { path: 'kun/node_modules/foo/node_modules/typescript/lib/tsc.js', size: 2 * MB },
      { path: 'kun/node_modules/foo/index.js', size: 1 }
    ])
    expect(packages.get('kun/node_modules/foo')).toEqual({ name: 'foo', bytes: 2 * MB + 1 })
    expect(packages.get('kun/node_modules/foo/node_modules/typescript')).toEqual({
      name: 'typescript',
      bytes: 2 * MB
    })
  })

  it('scoped 包以 scope/name 作为包名归集', () => {
    const packages = audit.aggregatePackages([
      { path: 'node_modules/@napi-rs/canvas-linux-x64-musl/canvas.node', size: 3 * MB }
    ])
    expect(packages.get('node_modules/@napi-rs/canvas-linux-x64-musl')).toEqual({
      name: '@napi-rs/canvas-linux-x64-musl',
      bytes: 3 * MB
    })
  })

  it('命中：超过 1MB 的黑名单实体（agent-sdk 三平台 / canvas 变体 / 构建工具 / @rolldown binding）', () => {
    const packages = audit.aggregatePackages([
      { path: 'kun/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/cli', size: 200 * MB },
      { path: 'kun/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/cli.exe', size: 200 * MB },
      { path: 'kun/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/cli', size: 200 * MB },
      { path: 'node_modules/@napi-rs/canvas-linux-x64-gnu/canvas.node', size: 32 * MB },
      { path: 'node_modules/@napi-rs/canvas-linux-x64-musl/canvas.node', size: 28 * MB },
      { path: 'node_modules/typescript/lib/typescript.js', size: 8 * MB },
      { path: 'node_modules/vite/dist/node/index.js', size: 2 * MB },
      { path: 'node_modules/vitest/dist/index.js', size: 2 * MB },
      { path: 'node_modules/@rolldown/binding-linux-x64-gnu/rolldown.node', size: 30 * MB }
    ])
    const violations = audit.evaluateBlacklist(packages, 'unpacked')
    expect(violations.map((v: { ruleId: string }) => v.ruleId).sort()).toEqual([
      'agent-sdk-platform-binary',
      'agent-sdk-platform-binary',
      'agent-sdk-platform-binary',
      'build-tool-rolldown',
      'build-tool-typescript',
      'build-tool-vite',
      'build-tool-vitest',
      'napi-rs-canvas',
      'napi-rs-canvas'
    ])
    expect(violations[0]).toMatchObject({ side: 'unpacked', bytes: 200 * MB })
  })

  it('未命中：1MB 以下空壳、canvas 元包桩、jimp 系（@computer-use/kun 合法依赖）与正常依赖不报', () => {
    const packages = audit.aggregatePackages([
      // files 排除规则掏空后的 typescript 空壳（design.md §1 实测 asar 内为 0-64K）
      { path: 'kun/node_modules/typescript/package.json', size: 3000 },
      // @napi-rs/canvas 元包本体仅 ~150K，低于阈值不报（真正体积在平台变体里）
      { path: 'node_modules/@napi-rs/canvas/index.js', size: 150 * 1024 },
      // 正常依赖不在黑名单
      { path: 'node_modules/react/cjs/react.production.js', size: 5 * MB },
      // agent-sdk 的纯 JS 小包（非平台二进制）应保留
      { path: 'kun/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs', size: 3 * MB },
      // jimp 系是 @computer-use（截图）与 kun 的合法依赖：npm 可能把 @computer-use 的
      // jimp@0.22 提升到顶层（CI #29 实测），产物层面无法与「直接依赖」区分，故不黑名单。
      // 下面两条正是 CI #29 曾误报的场景，须验证不再命中。源头守护改由
      // package.json「dependencies 不含 jimp」断言承担（见 packaging-config.test.ts）。
      { path: 'node_modules/jimp/dist/index.js', size: 6 * MB },
      { path: 'node_modules/@computer-use/nut-js/node_modules/jimp/dist/index.js', size: 6 * MB },
      { path: 'kun/node_modules/@jimp/custom/index.js', size: 2 * MB }
    ])
    expect(audit.evaluateBlacklist(packages, 'asar')).toEqual([])
  })

  it('命中：renderer-only 大库误入产物（Step 4 重分类回归守护）', () => {
    const packages = audit.aggregatePackages([
      { path: 'node_modules/lucide-react/dist/index.js', size: 40 * MB },
      { path: 'node_modules/@xyflow/react/dist/index.js', size: 5 * MB },
      { path: 'node_modules/shiki/dist/index.js', size: 3.5 * MB },
      { path: 'node_modules/streamdown/dist/index.js', size: 2 * MB },
      { path: 'node_modules/zustand/index.js', size: 2 * MB },
      { path: 'node_modules/@codemirror/view/dist/index.js', size: 2 * MB },
      { path: 'node_modules/@tiptap/core/dist/index.js', size: 2 * MB },
      { path: 'node_modules/@xterm/xterm/lib/xterm.js', size: 2 * MB }
    ])
    const violations = audit.evaluateBlacklist(packages, 'asar')
    expect(violations.every((v: { ruleId: string }) => v.ruleId === 'renderer-only-dependency')).toBe(
      true
    )
    expect(violations.map((v: { path: string }) => v.path).sort()).toEqual([
      'node_modules/@codemirror/view',
      'node_modules/@tiptap/core',
      'node_modules/@xterm/xterm',
      'node_modules/@xyflow/react',
      'node_modules/lucide-react',
      'node_modules/shiki',
      'node_modules/streamdown',
      'node_modules/zustand'
    ])
  })

  it('未命中：mermaid/katex/es-toolkit（streamdown 传递依赖）不进 renderer-only 名单，避免保留依赖传递引入时误报', () => {
    const packages = audit.aggregatePackages([
      { path: 'node_modules/mermaid/dist/mermaid.js', size: 20 * MB },
      { path: 'node_modules/katex/dist/katex.js', size: 4 * MB },
      { path: 'node_modules/es-toolkit/dist/index.js', size: 8 * MB }
    ])
    expect(audit.evaluateBlacklist(packages, 'asar')).toEqual([])
  })
})

describe('audit-bundle 产物布局与基线', () => {
  it('locateProduct 兼容 linux/win unpacked、mac .app 直传与 mac 输出目录', () => {
    const linuxDir = tempRoot()
    writeSized(join(linuxDir, 'resources/app.asar'), 16)
    expect(audit.locateProduct(linuxDir)).toEqual({
      productRoot: linuxDir,
      resourcesDir: join(linuxDir, 'resources')
    })

    const appDir = tempRoot()
    writeSized(join(appDir, 'Contents/Resources/app.asar'), 16)
    expect(audit.locateProduct(appDir).resourcesDir).toBe(join(appDir, 'Contents', 'Resources'))

    const macOutDir = tempRoot()
    writeSized(join(macOutDir, 'Claude360 Copilot.app/Contents/Resources/app.asar'), 16)
    expect(audit.locateProduct(macOutDir)).toEqual({
      productRoot: join(macOutDir, 'Claude360 Copilot.app'),
      resourcesDir: join(macOutDir, 'Claude360 Copilot.app', 'Contents', 'Resources')
    })
  })

  it('locateProduct 对中断残留（无 app.asar）给出明确错误', () => {
    const brokenDir = tempRoot()
    writeSized(join(brokenDir, 'electron'), 8)
    expect(() => audit.locateProduct(brokenDir)).toThrow(/未找到 app\.asar/)
  })

  it('detectPlatform 依据布局与 exe 推断平台', () => {
    const winDir = tempRoot()
    writeSized(join(winDir, 'Claude360 Copilot.exe'), 8)
    writeSized(join(winDir, 'resources/app.asar'), 16)
    expect(audit.detectPlatform(winDir, join(winDir, 'resources'))).toBe('win32')

    const macDir = tempRoot()
    writeSized(join(macDir, 'Contents/Resources/app.asar'), 16)
    expect(audit.detectPlatform(macDir, join(macDir, 'Contents', 'Resources'))).toBe('darwin')

    const linuxDir = tempRoot()
    writeSized(join(linuxDir, 'resources/app.asar'), 16)
    expect(audit.detectPlatform(linuxDir, join(linuxDir, 'resources'))).toBe('linux')
  })

  it('compareBaseline 阈值内通过、超 10% 报错、平台不匹配跳过', () => {
    const baseline = { platform: 'linux', totalUnpackedBytes: 1000 }
    expect(audit.compareBaseline(1100, baseline, 'linux').status).toBe('ok')
    expect(audit.compareBaseline(1101, baseline, 'linux').status).toBe('exceeded')
    expect(audit.compareBaseline(1101, baseline, 'win32').status).toBe('skipped')
    expect(audit.compareBaseline(500, null, 'linux').status).toBe('skipped')
  })

  it('walkFileEntries 统计常规文件、不跟符号链接', () => {
    const root = tempRoot()
    writeSized(join(root, 'a/b.bin'), 10)
    writeSized(join(root, 'c.bin'), 5)
    symlinkSync(join(root, 'a'), join(root, 'a-link'))
    const entries = audit.walkFileEntries(root)
    expect(entries.sort((x: { path: string }, y: { path: string }) => x.path.localeCompare(y.path))).toEqual([
      { path: 'a/b.bin', size: 10 },
      { path: 'c.bin', size: 5 }
    ])
  })
})
