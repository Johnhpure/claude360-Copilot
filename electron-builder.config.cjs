const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

// 品牌升级后构建环境变量改用 CLAUDE360_* 前缀；旧前缀仍兼容读取，
// 避免 CI / 本地发布脚本一刀切失效。
function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

function loadLocalReleaseEnv() {
  const candidates = [
    envFirst('CLAUDE360_RELEASE_ENV', 'KUN_RELEASE_ENV', 'DEEPSEEK_GUI_RELEASE_ENV'),
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

// 应用内更新走 GitHub Releases:下方 publish 配置会写入产物的
// resources/app-update.yml,electron-updater 据此从公开仓库拉取 latest.yml。
// frontier 通道版本号为 semver prerelease(如 0.1.3-test.N),发布时标记 prerelease。
const githubUpdateOwner = 'Johnhpure'
const githubUpdateRepo = 'claude360-Copilot'
const updateChannel = normalizeUpdateChannel(
  envFirst('CLAUDE360_UPDATE_CHANNEL', 'KUN_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || 'stable'
)
const releaseAppVersion = (
  envFirst('CLAUDE360_APP_VERSION', 'KUN_APP_VERSION', 'DEEPSEEK_GUI_APP_VERSION') || ''
).trim()
const releaseArtifactVersion = (
  envFirst('CLAUDE360_ARTIFACT_VERSION', 'KUN_ARTIFACT_VERSION', 'DEEPSEEK_GUI_ARTIFACT_VERSION') || ''
).trim()
const artifactVersion = releaseArtifactVersion || releaseAppVersion || '${version}'
const semverVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const artifactVersionPattern = /^[0-9A-Za-z][0-9A-Za-z._-]*$/

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`CLAUDE360_UPDATE_CHANNEL must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !semverVersionPattern.test(releaseAppVersion)) {
  throw new Error(
    `CLAUDE360_APP_VERSION must be a valid semver for electron-updater, got: ${releaseAppVersion}`
  )
}

if (releaseArtifactVersion && !artifactVersionPattern.test(releaseArtifactVersion)) {
  throw new Error(
    `CLAUDE360_ARTIFACT_VERSION must use only letters, numbers, dots, dashes, and underscores, got: ${releaseArtifactVersion}`
  )
}

// PPT Master 的 skill 载荷不进 git(12917 个文件),由
// scripts/prepare-ppt-master-package.mjs 从上游 checkout 铺进 packages/。
// 缺失时不阻断构建——产物仍可用,只是 PPT 助手会退回 npm 下载通道——
// 但必须响亮地警告,否则会悄无声息地发出一个没有 PPT 能力的包。
// 设 CLAUDE360_REQUIRE_PPT_MASTER=1 可把它升级为硬失败(建议 release CI 打开)。
function pptMasterExtraResources() {
  const from = join(__dirname, 'packages', 'ppt-master-skill')
  if (existsSync(join(from, 'ppt-master', 'SKILL.md'))) {
    return [{ from, to: 'ppt-master-skill', filter: ['ppt-master/**/*'] }]
  }
  const message =
    'PPT Master skill payload not found at packages/ppt-master-skill/ppt-master. ' +
    'Run: node scripts/prepare-ppt-master-package.mjs --from <ppt-master checkout>'
  if (envFirst('CLAUDE360_REQUIRE_PPT_MASTER') === '1') throw new Error(message)
  console.warn(`\n[electron-builder] WARNING: ${message}\n`)
  return []
}

module.exports = {
  // appId 已按 Claude360 决策换成全新 id(xyz.claude360.copilot)。
  // 系统会把它当作新应用：macOS 更新、TCC 权限、通知授权，以及 Windows
  // NSIS 卸载 GUID 都基于这个新 id 独立管理。
  appId: 'xyz.claude360.copilot',
  productName: 'Claude360 Copilot',
  asar: true,
  // Electron 默认打包 54 种语言的 locale pak(~38M)。本应用 UI 以中文为主
  // + i18next,只需简中/繁中/英文;裁掉其余 locale。此字段对三平台通用:
  // linux/win 过滤 locales/*.pak,mac 过滤 *.lproj。
  electronLanguages: ['zh-CN', 'zh-TW', 'en-US', 'en-GB'],
  asarUnpack: [
    '**/kun/dist/**/*',
    '**/kun/package*.json',
    '**/kun/node_modules/**/*',
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/node-pty/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*',
    // Computer-use native automation (@computer-use/nut-js + its libnut
    // binding + node-mac-permissions) ships prebuilt .node files that must
    // live outside the asar archive to load.
    '**/node_modules/@computer-use/**/*'
  ],
  npmRebuild: true,
  directories: {
    output: envFirst('CLAUDE360_DIST_DIR', 'KUN_DIST_DIR', 'DEEPSEEK_GUI_DIST_DIR') || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    'kun/dist/**/*',
    'kun/package.json',
    'kun/package-lock.json',
    'kun/node_modules/**/*',
    // The Agent SDK ships a ~230MB per-platform Claude Code binary as an optional
    // dep; do NOT bundle it into the installer. It's downloaded on demand into the
    // user-data dir (see src/main/agent-sdk-installer.ts). The small SDK JS stays.
    // NOTE: this exclusion filters the single file set electron-builder feeds to
    // BOTH app.asar and app.asar.unpacked, so the copy phase is clean on both
    // sides. The binary sneaks back in later: afterPack's `npm prune` reifies the
    // kun lockfile and re-installs the platform-matched optional binary into
    // app.asar.unpacked; scripts/after-pack.cjs strips it again right after
    // pruning (removeOnDemandAgentSdkBinaries).
    '!kun/node_modules/@anthropic-ai/claude-agent-sdk-*/**',
    // @napi-rs/canvas is pdfjs-dist's optionalDependency for Node-side bitmap
    // rendering (~61MB across gnu+musl variants). The main process only does PDF
    // *text extraction* (getTextContent, see src/main/services/write-pdf-text-service.ts),
    // which does not touch canvas — verified by running that service's tests with
    // @napi-rs removed. Exclude the whole scope; the electron-builder auto-unpack
    // for .node files would otherwise copy both libc variants into app.asar.unpacked.
    '!node_modules/@napi-rs/**',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*'
    // node_modules/openclaw (the vendor/openclaw-shim file: dep) must ship:
    // the WeChat bridge imports @tencent-weixin/openclaw-weixin/dist at
    // runtime to send media, and that chain resolves openclaw/plugin-sdk/*.
  ],
  extraResources: [
    {
      from: 'resources/whisper',
      to: 'whisper',
      filter: ['**/*']
    },
    // The PPT Master skill (~13k files). Kept out of asar entirely: its own
    // SKILL.md shells out to scripts/*.py, which cannot run from inside an
    // archive. `to` must stay in sync with PPT_MASTER_BUNDLE_DIR_NAME, and the
    // resulting <resources>/ppt-master-skill is the scan root handed to Kun.
    // Populated by scripts/prepare-ppt-master-package.mjs — see below.
    ...pptMasterExtraResources()
  ],
  artifactName: `Claude360-Copilot-${artifactVersion}-\${os}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'github',
      owner: githubUpdateOwner,
      repo: githubUpdateRepo,
      releaseType: updateChannel === 'frontier' ? 'prerelease' : 'release'
    }
  ],
  beforePack: './scripts/before-pack.cjs',
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      // 语音输入：渲染进程通过 getUserMedia 录音做语音转文字。
      NSMicrophoneUsageDescription: 'Claude360 Copilot uses the microphone for voice-to-text input.'
    },
    // macOS 不会自动套圆角遮罩,图标文件本身需要是「圆角方块 + 透明边距」。
    // claude360_mac.png 由 Claude360 Copilot 官方 Logo 生成。
    icon: './src/asset/img/claude360_mac.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity
  },
  win: {
    // Windows does not mask app icons for us; use the rounded asset so
    // desktop/start-menu/taskbar shortcuts do not show a hard square edge.
    // Ship a multi-size .ico so Explorer and the desktop render crisp icons at
    // small sizes. It is generated from the Claude360 Copilot official Logo.
    icon: './build/icon-claude360.ico',
    // nsis 安装包（双击安装）按 x64 + ia32 分架构各出一个 exe：
    // 应用内更新（electron-updater findFile）按文件名里的 arch 子串匹配，
    // latest.yml 的 files[] 必须同时含 -win-x64.exe 与 -win-ia32.exe 条目
    // （两架构必须在同一次 electron-builder 调用里构建，latest.yml 才会合并）。
    // zip 便携包（免安装，解压后运行内含的 "Claude360 Copilot.exe"）仅 x64。
    target: [
      { target: 'nsis', arch: ['x64', 'ia32'] },
      { target: 'zip', arch: ['x64'] }
    ]
  },
  nsis: {
    // 多 arch 时 electron-builder 默认会打一个 universal 单包（文件名无 arch
    // 子串，electron-updater 无法按架构匹配）。关掉它，坚持分 arch 独立安装包。
    buildUniversalInstaller: false,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    include: 'build/installer.nsh',
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'Claude360 Copilot',
    uninstallDisplayName: 'Claude360 Copilot',
    deleteAppDataOnUninstall: false
  },
  linux: {
    category: 'Development',
    // Linux AppImage icon uses the Claude360 Copilot official Logo.
    icon: './src/asset/img/claude360.png',
    target: [{ target: 'AppImage', arch: ['x64'] }]
  },
  extraMetadata: {
    ...(releaseAppVersion ? { version: releaseAppVersion } : {}),
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    }
  }
}
