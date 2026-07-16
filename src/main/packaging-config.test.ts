import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const afterPack = require('../../scripts/after-pack.cjs')
const beforePack = require('../../scripts/before-pack.cjs')
const macNotarize = require('../../scripts/mac-notarize.cjs')
const rootPackageJson = require('../../package.json')

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ds-gui-packaging-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '{}\n', 'utf8')
}

function preloadSourceFiles(dir = join(process.cwd(), 'src/preload')): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return preloadSourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : []
  })
}

function forbiddenPreloadImports(source: string): string[] {
  const builtins = new Set(builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')))
  const imports = source.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)
  return [...imports]
    .map((match) => match[1])
    .filter((specifier) => {
      const moduleName = specifier.replace(/^node:/, '')
      return specifier.startsWith('node:') ||
        builtins.has(moduleName) ||
        builtins.has(moduleName.split('/')[0] ?? moduleName)
    })
}

function loadBuilderConfigWithEnv(env: Record<string, string | undefined>): typeof builderConfig {
  const configPath = require.resolve('../../electron-builder.config.cjs')
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  delete require.cache[configPath]
  try {
    return require(configPath)
  } finally {
    delete require.cache[configPath]
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    require(configPath)
  }
}

function createMacPackContext(root: string): {
  appOutDir: string
  electronPlatformName: string
  packager: { appInfo: { productFilename: string } }
} {
  return {
    appOutDir: join(root, 'mac-arm64'),
    electronPlatformName: 'darwin',
    packager: {
      appInfo: {
        productFilename: 'Kun'
      }
    }
  }
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('electron-builder Claude360 Copilot packaging', () => {
  it('uses the Claude360 Copilot brand identity across builder config', () => {
    // 品牌基础断言:productName / appId / 产物名 / NSIS 快捷方式与卸载名。
    // appId 已按 Claude360 决策换新(视为新应用),不再沿用旧 deepseekgui id。
    expect(builderConfig.productName).toBe('Claude360 Copilot')
    expect(builderConfig.appId).toBe('xyz.claude360.copilot')
    expect(builderConfig.artifactName.startsWith('Claude360-Copilot-')).toBe(true)
    expect(builderConfig.nsis.shortcutName).toBe('Claude360 Copilot')
    expect(builderConfig.nsis.uninstallDisplayName).toBe('Claude360 Copilot')
    // macOS 麦克风等 usage 文案不应再出现旧品牌 Kun。
    const micUsage = builderConfig.mac.extendInfo.NSMicrophoneUsageDescription
    expect(micUsage).not.toMatch(/Kun/)
    expect(micUsage).toMatch(/Claude360 Copilot/)
  })

  it('trims Electron locales to the shipped UI languages', () => {
    // 只保留简中/繁中/英文,裁掉其余 ~50 种 locale pak(~38M)。
    // 三平台通用:linux/win 过滤 locales/*.pak,mac 过滤 *.lproj。
    expect(builderConfig.electronLanguages).toEqual(['zh-CN', 'zh-TW', 'en-US', 'en-GB'])
  })

  it('builds per-arch Windows NSIS installers for x64 and ia32 in one invocation', () => {
    // ia32 客户端应用内更新依赖 latest.yml files[] 同时含 -win-x64.exe 与
    // -win-ia32.exe：两个 arch 必须在同一次 electron-builder 调用里构建才会
    // 合并进同一份 latest.yml（分次构建会互相覆盖，另一 arch 触发 findFile
    // fallback 拿错包）。
    expect(builderConfig.win.target).toEqual([
      { target: 'nsis', arch: ['x64', 'ia32'] },
      { target: 'zip', arch: ['x64'] }
    ])
    // 多 arch 下 electron-builder 默认打 universal 单包（文件名无 arch 子串，
    // electron-updater 无法按架构匹配），必须显式关闭。
    expect(builderConfig.nsis.buildUniversalInstaller).toBe(false)
    // dist:win 不得再用 CLI 限定 target/arch（如 `--win nsis zip --x64`）——
    // CLI 会覆盖 config 的双 arch target，导致 latest.yml 只剩单 arch 条目。
    expect(rootPackageJson.scripts['dist:win']).toBe('npm run dist -- --win')
  })

  it('maps electron-builder arch enum values including ia32 for the Whisper hooks', () => {
    // electron-builder Arch 枚举：ia32=0（falsy！）、x64=1、armv7l=2、arm64=3。
    expect(beforePack._internals.normalizeArch(0)).toBe('ia32')
    expect(beforePack._internals.normalizeArch('ia32')).toBe('ia32')
    expect(beforePack._internals.normalizeArch(1)).toBe('x64')
    expect(beforePack._internals.normalizeArch('x64')).toBe('x64')
    expect(beforePack._internals.normalizeArch(3)).toBe('arm64')
    expect(() => beforePack._internals.normalizeArch(2)).toThrow(/Unsupported Whisper runner arch/)
  })

  it('keeps the win32-x64 Whisper baseline while ia32 packaging degrades voice-to-text', () => {
    // 仓库基线：win32-x64 runner 在库、win32-ia32 无二进制。beforePack 对
    // ia32 必须跳过 Whisper prepare/prune（不 throw），否则 prune 的
    // keep=win32-ia32 会把 win32-x64 基线物理删除（dist 删基线事故的变体）。
    expect(existsSync(beforePack._internals.whisperRunnerPath('win32', 'x64'))).toBe(true)
    expect(existsSync(beforePack._internals.whisperRunnerPath('win32', 'ia32'))).toBe(false)
  })

  it('保持 jimp 不在应用直接依赖中（Step 3 源头守护）', () => {
    // jimp 会经 @computer-use/nut-js（0.22 截图，npm 可能提升到顶层）与 kun（1.6 自有
    // 依赖）合法留在产物树，无法在产物层黑名单（会误报，见 CI #29）。改守护源头：应用
    // 自身 dependencies 不得重新声明 Step 3 已移除的直接 jimp@1.6.1。
    expect(rootPackageJson.dependencies).not.toHaveProperty('jimp')
  })

  it('points every platform icon at the Claude360 assets', () => {
    // 图标引用改指向 claude360 命名资源(当前为占位副本,待后续替换真实设计)。
    expect(builderConfig.win.icon).toBe('./build/icon-claude360.ico')
    expect(builderConfig.mac.icon).toBe('./src/asset/img/claude360_mac.png')
    expect(builderConfig.linux.icon).toBe('./src/asset/img/claude360.png')
  })

  it('includes Kun runtime dependencies in the packaged app', () => {
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      'kun/dist/**/*',
      'kun/package.json',
      'kun/package-lock.json',
      'kun/node_modules/**/*'
    ]))
    expect(builderConfig.asarUnpack).toEqual(expect.arrayContaining([
      '**/kun/dist/**/*',
      '**/kun/package*.json',
      '**/kun/node_modules/**/*'
    ]))
    expect(builderConfig.asarUnpack).not.toEqual(expect.arrayContaining([
      '**/node_modules/node-bin-darwin-*/*',
      '**/node_modules/node-bin-linux-*/*',
      '**/node_modules/node-bin-win-*/*',
      '**/node_modules/openclaw/**/*',
      '**/node_modules/@tencent-weixin/openclaw-weixin/**/*'
    ]))
    // The openclaw shim (vendor/openclaw-shim) must ship: the WeChat bridge
    // imports the bundled plugin's dist at runtime to send media, and that
    // import chain resolves openclaw/plugin-sdk/*.
    expect(builderConfig.files).not.toEqual(expect.arrayContaining([
      '!**/node_modules/openclaw/**/*'
    ]))
    // @napi-rs/canvas (pdfjs-dist's optional Node-side renderer) is excluded
    // wholesale: the main process only does PDF text extraction, which does not
    // touch canvas. Unlike kun-side packages, main app node_modules are not
    // reinstalled by afterPack's npm prune, so the files exclusion is sufficient.
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      '!node_modules/@napi-rs/**'
    ]))
    expect(builderConfig.files).toEqual(expect.arrayContaining([
      '!kun/node_modules/@anthropic-ai/claude-agent-sdk-*/**'
    ]))
  })

  it('validates the unpacked Kun runtime before release artifacts are created', () => {
    const root = tempRoot()
    const context = createMacPackContext(root)
    const unpackedRoot = afterPack._internals.unpackedAppRoot(context)

    for (const relativePath of afterPack.KUN_RUNTIME_REQUIRED_PATHS) {
      touch(join(unpackedRoot, relativePath))
    }
    touch(join(unpackedRoot, 'node_modules/better-sqlite3/package.json'))

    expect(() => afterPack._internals.validateBundledKunRuntime(context)).not.toThrow()

    rmSync(join(unpackedRoot, 'kun/node_modules/zod'), { recursive: true, force: true })

    expect(() => afterPack._internals.validateBundledKunRuntime(context)).toThrow(
      /kun\/node_modules\/zod\/package\.json/
    )
  })

  it('runs npm through cmd.exe during Windows afterPack hooks', () => {
    expect(afterPack._internals.npmCommand(['prune'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', 'prune']
    })
    expect(afterPack._internals.npmCommand(['prune'], 'darwin')).toEqual({
      command: 'npm',
      args: ['prune']
    })
  })

  it('strips agent-sdk platform binaries that npm prune reinstalls into the unpacked kun', () => {
    // `npm prune` reifies the kun lockfile, re-installing the platform-matched
    // @anthropic-ai/claude-agent-sdk-* optional binary (~230MB) that the
    // builder `files` exclusion already kept out. afterPack must strip every
    // platform flavor again while keeping the pure-JS SDK packages.
    const root = tempRoot()
    const kunDir = join(root, 'kun')
    const scopeDir = join(kunDir, 'node_modules/@anthropic-ai')
    for (const packageName of [
      'claude-agent-sdk',
      'claude-agent-sdk-linux-x64',
      'claude-agent-sdk-linux-x64-musl',
      'claude-agent-sdk-win32-x64',
      'claude-agent-sdk-darwin-arm64',
      'sdk'
    ]) {
      touch(join(scopeDir, packageName, 'package.json'))
    }

    afterPack._internals.removeOnDemandAgentSdkBinaries(kunDir)

    expect(readdirSync(scopeDir).sort()).toEqual(['claude-agent-sdk', 'sdk'])
    // Missing @anthropic-ai scope must stay a no-op instead of throwing.
    expect(() =>
      afterPack._internals.removeOnDemandAgentSdkBinaries(join(root, 'missing-kun'))
    ).not.toThrow()
  })

  it('uses the rounded Claude360 icon for Windows installers and shortcuts', () => {
    // Windows ships a multi-size .ico (16/24/32/48/64/72/96/128/256) generated
    // from the rounded claude360_mac.png so Explorer/desktop render crisp small
    // icons instead of downscaling a single 1024px PNG (#222). 当前为占位副本,
    // 待后续替换真实设计资源。
    expect(builderConfig.win.icon).toBe('./build/icon-claude360.ico')
  })

  it('uses a process-tree shutdown guard for Windows overwrite installs', () => {
    const installerScript = readFileSync(join(process.cwd(), 'build/installer.nsh'), 'utf8')

    expect(builderConfig.nsis.include).toBe('build/installer.nsh')
    expect(installerScript).toContain('customCheckAppRunning')
    expect(installerScript).toContain('customUnInstallCheck')
    expect(installerScript).toContain('customUnInstallCheckCurrentUser')
    expect(installerScript).toContain('kunContinueAfterOldUninstallerFailure')
    expect(installerScript).toContain('KUN_INSTALLER_UNINSTALL_EXE')
    expect(installerScript).toContain('${UNINSTALL_FILENAME}')
    expect(installerScript).toContain('old-uninstaller.exe')
    expect(installerScript).toContain('$$_.ExecutablePath')
    expect(installerScript).toContain("$$r=[IO.Path]::GetFullPath")
    expect(installerScript).toContain('taskkill.exe /PID $$_.ProcessId /T /F')
    expect(installerScript).toContain('RMDir /r "$INSTDIR"')
    expect(installerScript).toContain('!ifdef BUILD_UNINSTALLER')
    expect(installerScript).toContain('${ifNot} ${isUpdated}')
    expect(installerScript).toContain('MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)"')
    expect(installerScript).not.toContain('Stop-Process -Id')
  })

  it('keeps sandboxed preload free of Node builtin imports', () => {
    for (const sourcePath of preloadSourceFiles()) {
      expect(forbiddenPreloadImports(readFileSync(sourcePath, 'utf8'))).toEqual([])
    }
  })

  it('requires Apple secure timestamps when Developer ID signing is enabled', () => {
    const signedConfig = loadBuilderConfigWithEnv({
      MAC_SIGN: '1'
    })

    expect(signedConfig.mac.identity).toBeUndefined()
    expect(signedConfig.mac.hardenedRuntime).toBe(true)
    expect(signedConfig.mac.forceCodeSigning).toBe(true)
    expect(signedConfig.mac.timestamp).toBe('http://timestamp.apple.com/ts01')
  })

  it('checks timestamp candidates across nested macOS signed code', () => {
    const root = tempRoot()
    const appBundle = join(root, 'Kun.app')
    const mainExecutable = join(appBundle, 'Contents/MacOS/Kun')
    const framework = join(appBundle, 'Contents/Frameworks/Electron Framework.framework')
    const nativeAddon = join(
      appBundle,
      'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    )
    const resourceScript = join(appBundle, 'Contents/Resources/postinstall.sh')

    touch(mainExecutable)
    touch(join(framework, 'Versions/A/Electron Framework'))
    touch(nativeAddon)
    touch(resourceScript)
    chmodSync(mainExecutable, 0o755)
    chmodSync(resourceScript, 0o755)

    expect(macNotarize._internals.collectSignedCodeCandidates(appBundle)).toEqual([
      appBundle,
      framework,
      mainExecutable,
      nativeAddon
    ])
  })
})
