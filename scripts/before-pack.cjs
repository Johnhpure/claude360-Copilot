const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const WHISPER_RESOURCES_DIR = join(__dirname, '..', 'resources', 'whisper')

function normalizePlatform(platform) {
  if (platform === 'mac') return 'darwin'
  if (platform === 'win') return 'win32'
  return platform
}

// electron-builder Arch 枚举：ia32=0, x64=1, armv7l=2, arm64=3。
// 注意 ia32 的枚举值 0 是 falsy，判断必须用严格相等。
function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  if (arch === 'ia32' || arch === 0) return 'ia32'
  throw new Error(`[before-pack] Unsupported Whisper runner arch: ${arch}`)
}

function whisperRunnerPath(platform, arch) {
  return join(
    WHISPER_RESOURCES_DIR,
    `${platform}-${arch}`,
    platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  )
}

function pruneWhisperResources(platform, arch) {
  if (!existsSync(WHISPER_RESOURCES_DIR)) return

  const keep = `${platform}-${arch}`
  for (const entry of readdirSync(WHISPER_RESOURCES_DIR)) {
    if (entry === keep || entry === 'LICENSE.whisper.cpp') continue

    rmSync(join(WHISPER_RESOURCES_DIR, entry), { recursive: true, force: true })
    console.log(`[before-pack] Removed non-target Whisper resource: ${entry}`)
  }
}

async function beforePack(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  if (process.env.KUN_SKIP_WHISPER_RUNNER === '1') {
    console.warn(`[before-pack] Skipping bundled Whisper runner for ${platform}-${arch}.`)
    return
  }
  // ia32 明确降级：仓库无 win32-ia32 Whisper 基线，whisper.cpp 也不支持从
  // x64 runner 交叉编译 ia32。直接跳过准备与裁剪（ia32 客户端语音转文字不可
  // 用），并且绝不能带 keep=<platform>-ia32 去 pruneWhisperResources ——
  // 那会把 win32-x64 基线一并物理删除（双 arch 同次构建时 x64 包会因此丢失
  // Whisper，见 .trellis spec bundle-audit / dist 删基线事故）。
  if (arch === 'ia32' && !existsSync(whisperRunnerPath(platform, arch))) {
    console.warn(
      `[before-pack] No bundled Whisper runner for ${platform}-${arch}; skipping Whisper prepare/prune (voice-to-text stays unavailable on this arch).`
    )
    return
  }
  execFileSync(
    process.execPath,
    [
      join(__dirname, 'prepare-whisper-runner.cjs'),
      '--platform',
      platform,
      '--arch',
      arch
    ],
    {
      cwd: join(__dirname, '..'),
      stdio: 'inherit'
    }
  )
  pruneWhisperResources(platform, arch)
}

exports._internals = {
  normalizePlatform,
  normalizeArch,
  pruneWhisperResources,
  whisperRunnerPath
}
exports.default = beforePack
