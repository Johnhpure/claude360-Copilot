import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderConfig = require('../../electron-builder.config.cjs')
const afterPack = require('../../scripts/after-pack.cjs')
const macNotarize = require('../../scripts/mac-notarize.cjs')

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
