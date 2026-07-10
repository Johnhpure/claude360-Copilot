import { app, autoUpdater as nativeAutoUpdater, BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import electronUpdater from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateFailureCode,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from '../shared/gui-update'
import { nextGuiUpdateCheckDelay } from '../shared/gui-update-schedule'
import { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel } from '../shared/gui-update'

// 应用内更新走 GitHub Releases(公开仓库,electron-updater 原生 github provider)。
// KUN_UPDATE_URL* env 仍可覆盖为 generic 源,作为内部逃生舱保留。
const GITHUB_UPDATE_OWNER = 'Johnhpure'
const GITHUB_UPDATE_REPO = 'claude360-Copilot'
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases`
const { autoUpdater } = electronUpdater

function envWithLegacyFallback(kunName: string, legacyName: string): string {
  return process.env[kunName]?.trim() || process.env[legacyName]?.trim() || ''
}

let initialized = false
let getMainWindow: (() => BrowserWindow | null) | null = null
let lastInfo: Extract<GuiUpdateInfo, { ok: true }> | null = null
let lastState: GuiUpdateState = { status: 'idle' }
let downloaded = false
let downloadPromise: Promise<string[]> | null = null
let configuredChannel: GuiUpdateChannel = normalizeGuiUpdateChannel(
  envWithLegacyFallback('KUN_UPDATE_CHANNEL', 'DEEPSEEK_GUI_UPDATE_CHANNEL') || undefined
)
let configuredFeedUrl = ''
let getSelectedChannel: (() => GuiUpdateChannel | Promise<GuiUpdateChannel>) | null = null
let getSelectedLocale: (() => 'en' | 'zh' | Promise<'en' | 'zh'>) | null = null
let beforeInstallUpdate: (() => void | Promise<void>) | null = null
let beforeInstallUpdatePromise: Promise<void> | null = null
let pendingVersionStateWrite: Promise<void> | null = null
let backgroundCheckTimer: NodeJS.Timeout | null = null
let backgroundCheckPromise: Promise<void> | null = null
// 每次进程启动只自动检查一次（不落盘）：置位后本进程不再调度自动检查。
let startupAutoCheckDone = false

const GUI_VERSION_STATE_FILE = 'gui-version-state.json'
const DEFAULT_CHANGELOG_URL = GITHUB_RELEASES_URL

type GuiVersionState = {
  lastSeenVersion?: string
  dismissedUpdateVersion?: string
  pendingUpdate?: {
    version: string
    releaseNotes?: string
  }
}

function envUpdateUrl(channel: GuiUpdateChannel): string {
  const channelSpecific = envWithLegacyFallback(
    `KUN_UPDATE_URL_${channel.toUpperCase()}`,
    `DEEPSEEK_GUI_UPDATE_URL_${channel.toUpperCase()}`
  )
  const direct = channelSpecific || envWithLegacyFallback('KUN_UPDATE_URL', 'DEEPSEEK_GUI_UPDATE_URL')
  return direct ? direct.replace(/\{channel\}/g, channel).replace(/\/?$/, '/') : ''
}

function updateFeedManifestUrl(feedUrl: string): string {
  return `${feedUrl}${platformManifestName()}`
}

function guiVersionStatePath(): string {
  return join(app.getPath('userData'), GUI_VERSION_STATE_FILE)
}

async function readGuiVersionState(): Promise<GuiVersionState> {
  try {
    const raw = await readFile(guiVersionStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as GuiVersionState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeGuiVersionState(state: GuiVersionState): Promise<void> {
  const path = guiVersionStatePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8')
}

function changelogUrl(): string {
  return envWithLegacyFallback('KUN_CHANGELOG_URL', 'DEEPSEEK_GUI_CHANGELOG_URL') || DEFAULT_CHANGELOG_URL
}

function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!Array.isArray(value)) return undefined
  const notes = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !('note' in entry)) return ''
      return typeof entry.note === 'string' ? entry.note.trim() : ''
    })
    .filter(Boolean)
  return notes.length > 0 ? notes.join('\n\n') : undefined
}

function normalizeUpdateVersion(value: string): string {
  return value.trim().replace(/^v/i, '')
}

async function recordPendingUpdate(updateInfo: UpdateInfo): Promise<void> {
  const state = await readGuiVersionState()
  await writeGuiVersionState({
    ...state,
    pendingUpdate: {
      version: updateInfo.version.trim(),
      releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes)
    }
  })
}

async function selectedLocale(): Promise<'en' | 'zh'> {
  try {
    return (await getSelectedLocale?.()) === 'zh' ? 'zh' : 'en'
  } catch {
    return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
  }
}

function normalizeGithubOwnerRepo(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('github:')) s = s.slice('github:'.length).trim()
  const ssh = s.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/i)
  if (ssh?.[1]) return ssh[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  const https = s.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:$|[#/])/i)
  if (https?.[1]) return https[1].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s
  return null
}

function packageJsonPath(): string {
  return join(app.getAppPath(), 'package.json')
}

function readPackageJson(): Record<string, unknown> | null {
  try {
    const path = packageJsonPath()
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveGithubReleaseUrl(): string | null {
  const envRepo = normalizeGithubOwnerRepo(process.env.DEEPSEEK_GUI_GITHUB_REPO?.trim() ?? '')
  if (envRepo) return `https://github.com/${envRepo}/releases`

  const pkg = readPackageJson()
  const repository = pkg?.repository
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository
        ? String((repository as { url?: unknown }).url ?? '')
        : ''
  const repo = normalizeGithubOwnerRepo(raw)
  return repo ? `https://github.com/${repo}/releases` : null
}

function downloadPageUrl(): string {
  const direct = envWithLegacyFallback('KUN_DOWNLOAD_URL', 'DEEPSEEK_GUI_DOWNLOAD_URL')
  if (direct) return direct

  const pkg = readPackageJson()
  const homepage = typeof pkg?.homepage === 'string' ? pkg.homepage.trim() : ''
  if (homepage) return homepage

  return resolveGithubReleaseUrl() ?? GITHUB_RELEASES_URL
}

function releaseUrlForVersion(version: string): string {
  // KUN_DOWNLOAD_URL env 覆盖仍然优先(内部逃生舱)。
  const direct = envWithLegacyFallback('KUN_DOWNLOAD_URL', 'DEEPSEEK_GUI_DOWNLOAD_URL')
  if (direct) return direct

  // 更新源是 GitHub Releases,版本链接直接指向对应 Release tag 页,
  // 不走 downloadPageUrl()(homepage 是仓库根,拼不出 tag 页)。
  const page = resolveGithubReleaseUrl() ?? GITHUB_RELEASES_URL
  return `${page.replace(/\/+$/, '')}/tag/v${version.replace(/^v/i, '')}`
}

function parseVersionParts(v: string): number[] {
  const cleaned = v.trim().replace(/^v/i, '').replace(/-.*$/, '')
  return cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

function parsePrereleaseParts(v: string): string[] {
  const match = v.trim().replace(/^v/i, '').match(/-(.+)$/)
  return match ? match[1].split('.') : []
}

// 遵循 semver 优先级:主版本逐段比较;主版本相同时正式版 > 预发布版
// (0.1.4 > 0.1.4-test.3),预发布标识逐段比较(数字段按数值,0.1.3-test.12 > 0.1.3-test.11)。
function isVersionGreater(latest: string, current: string): boolean {
  const a = parseVersionParts(latest)
  const b = parseVersionParts(current)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }

  const ap = parsePrereleaseParts(latest)
  const bp = parsePrereleaseParts(current)
  if (ap.length === 0) return bp.length > 0
  if (bp.length === 0) return false
  const plen = Math.max(ap.length, bp.length)
  for (let i = 0; i < plen; i += 1) {
    const ai = ap[i]
    const bi = bp[i]
    if (ai === undefined) return false
    if (bi === undefined) return true
    const aNumeric = /^\d+$/.test(ai)
    const bNumeric = /^\d+$/.test(bi)
    if (aNumeric && bNumeric) {
      const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10)
      if (diff !== 0) return diff > 0
      continue
    }
    if (aNumeric !== bNumeric) return bNumeric
    if (ai !== bi) return ai > bi
  }
  return false
}

function platformManifestName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

// ── Windows 安装包架构守卫 ────────────────────────────────────────────────
// electron-updater 的 findFile（providers/Provider.js）按 `process.arch` 子串
// 匹配 files[] 里的安装包文件名，未命中时会静默 fallback 到第一个 exe ——
// ia32 客户端会因此误下并安装 x64 包。这里复刻其选择逻辑，在进入下载前断言
// 选中的文件与当前架构一致；不一致则按「未找到适用于当前架构的安装包」处理。

/** 复刻 electron-updater findFile 的 Windows exe 选择：优先含 arch 子串，否则第一个 exe。 */
export function selectWindowsInstallerUrl(fileUrls: string[], arch: string): string | null {
  const exeUrls = fileUrls.filter((url) => url.toLowerCase().endsWith('.exe'))
  if (exeUrls.length === 0) return null
  return exeUrls.find((url) => url.includes(arch)) ?? exeUrls[0]
}

/** 选中的安装包是否与当前架构一致：ia32 必须含 'ia32'，非 ia32 不得误取 ia32 包。 */
export function windowsInstallerMatchesArch(fileUrls: string[], arch: string): boolean {
  const selected = selectWindowsInstallerUrl(fileUrls, arch)
  if (!selected) return false
  return arch === 'ia32' ? selected.includes('ia32') : !selected.includes('ia32')
}

function updateInfoFileUrls(updateInfo: UpdateInfo): string[] {
  const files: unknown = updateInfo.files
  if (!Array.isArray(files)) return []
  return files
    .map((file) => {
      const url = (file as { url?: unknown } | null)?.url
      return typeof url === 'string' ? url : ''
    })
    .filter(Boolean)
}

/** 仅在 win32 生效；mac/linux 与既有行为完全一致。mismatch 时输出 arch + files 日志。 */
function windowsUpdateArchMismatch(updateInfo: UpdateInfo): boolean {
  if (process.platform !== 'win32') return false
  const fileUrls = updateInfoFileUrls(updateInfo)
  if (windowsInstallerMatchesArch(fileUrls, process.arch)) return false
  console.error(
    `[kun-gui updater] no installer in the update feed matches this architecture (arch=${process.arch}); refusing to download. files=${JSON.stringify(fileUrls)}`
  )
  return true
}

async function archMismatchMessage(): Promise<string> {
  const locale = await selectedLocale()
  return locale === 'zh'
    ? `未找到适用于当前架构（${process.arch}）的安装包。`
    : `No installer is available for this system architecture (${process.arch}).`
}

async function archMismatchInfo(
  channel: GuiUpdateChannel
): Promise<Extract<GuiUpdateInfo, { ok: false }>> {
  return {
    ok: false,
    currentVersion: app.getVersion(),
    message: await archMismatchMessage(),
    code: 'arch_mismatch',
    releaseUrl: downloadPageUrl(),
    channel
  }
}

function emitArchMismatchError(channel: GuiUpdateChannel): void {
  void archMismatchInfo(channel)
    .then((info) => {
      emitGuiUpdateState({ status: 'error', info, message: info.message, code: 'arch_mismatch' })
    })
    .catch(() => undefined)
}

function parseYamlScalar(source: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`^${escaped}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm'))
  return match?.[1]?.trim() ?? ''
}

function macAutoUpdateAllowed(): boolean {
  if (process.platform !== 'darwin') return true
  if (process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES === '1') return true

  const pkg = readPackageJson()
  const hints = pkg?.buildHints
  if (!hints || typeof hints !== 'object') return false
  const values = hints as { macSigningEnabled?: unknown; notarizationEnabled?: unknown }
  return values.macSigningEnabled === true && values.notarizationEnabled === true
}

function unsupportedMessage(): string {
  if (process.platform === 'darwin') {
    return 'Automatic updates require a signed and notarized macOS build. Use the download page for this build.'
  }
  return 'Automatic updates are not supported for this build. Use the download page instead.'
}

function extractHttpStatus(raw: string): number | null {
  const match = raw.match(/\b(\d{3})\b/)
  if (!match) return null
  const status = Number.parseInt(match[1], 10)
  return Number.isFinite(status) ? status : null
}

function sanitizeUpdaterError(raw: string, channel: GuiUpdateChannel): string {
  const message = raw.trim()
  if (!message) {
    return `Could not read GUI update metadata for the ${channel} channel. Open the download page instead.`
  }

  if (/Invalid release object path\./i.test(message)) {
    return `The ${channel} update feed is not published correctly yet. Open the download page instead.`
  }

  if (/Object not found\./i.test(message)) {
    return `The ${channel} update feed is missing release metadata right now. Open the download page instead.`
  }

  const status = extractHttpStatus(message)
  if (status === 400 || status === 404) {
    return `The ${channel} update feed is not available right now. Open the download page instead.`
  }
  if (status === 403) {
    return `The ${channel} update feed denied this request. Open the download page instead.`
  }
  if (status === 429) {
    return `The ${channel} update feed is rate limited right now. Please try again later.`
  }
  if (status && status >= 500) {
    return `The ${channel} update feed is temporarily unavailable. Please try again later.`
  }

  return message.split(/\n(?:Headers:|Data:)/, 1)[0].trim() || message
}

function toGuiInfo(updateInfo: UpdateInfo, hasUpdate: boolean, manualOnly = false): Extract<GuiUpdateInfo, { ok: true }> {
  const latestVersion = updateInfo.version.trim()
  return {
    ok: true,
    currentVersion: app.getVersion(),
    latestVersion,
    hasUpdate,
    releaseUrl: releaseUrlForVersion(latestVersion),
    releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes),
    releaseDate: updateInfo.releaseDate,
    channel: configuredChannel,
    manualOnly,
    downloaded
  }
}

function emitGuiUpdateState(state: GuiUpdateState): void {
  lastState = state
  const win = getMainWindow?.()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send('gui:update-state', state)
}

function runBeforeInstallUpdate(): Promise<void> {
  if (!beforeInstallUpdate) return Promise.resolve()
  if (!beforeInstallUpdatePromise) {
    beforeInstallUpdatePromise = Promise.resolve()
      .then(() => beforeInstallUpdate?.())
      .then(() => undefined)
      .finally(() => {
        beforeInstallUpdatePromise = null
      })
  }
  return beforeInstallUpdatePromise
}

function clearBackgroundCheckTimer(): void {
  if (backgroundCheckTimer) {
    clearTimeout(backgroundCheckTimer)
    backgroundCheckTimer = null
  }
}

function shouldSkipScheduledCheck(): boolean {
  return (
    lastState.status === 'checking' ||
    lastState.status === 'downloading' ||
    lastState.status === 'downloaded' ||
    lastState.status === 'installing'
  )
}

// 启动自动检查：每次进程启动后延迟固定 4 秒检查一次（见 gui-update-schedule.ts），
// 本进程生命周期内不再自动检查；设置页/顶栏手动检查不受此调度限制。
function scheduleNextBackgroundCheck(): void {
  clearBackgroundCheckTimer()
  const delay = nextGuiUpdateCheckDelay(startupAutoCheckDone)
  if (delay === null) return
  backgroundCheckTimer = setTimeout(() => {
    void runScheduledGuiUpdateCheck()
  }, delay)
}

async function runScheduledGuiUpdateCheck(): Promise<void> {
  if (backgroundCheckPromise) return backgroundCheckPromise
  backgroundCheckPromise = (async () => {
    try {
      // 无论本次结果如何都视为已消耗本进程的自动检查额度（每次启动最多一次）。
      startupAutoCheckDone = true
      if (shouldSkipScheduledCheck()) return
      console.info('[kun-gui updater] running startup GUI update check (once per launch)')
      const info = await checkGuiUpdate()
      if (!info.ok) {
        // 自动检查失败只静默记日志，不打扰用户；手动检查才显式报错。
        console.warn('[kun-gui updater] startup GUI update check failed:', info.message)
      }
    } catch (error) {
      console.warn('[kun-gui updater] scheduled GUI update check failed:', error)
    } finally {
      backgroundCheckPromise = null
      // startupAutoCheckDone 已置位，nextGuiUpdateCheckDelay 返回 null → 不再调度。
      scheduleNextBackgroundCheck()
    }
  })()
  return backgroundCheckPromise
}

async function resolveUpdateChannel(requested?: GuiUpdateChannel): Promise<GuiUpdateChannel> {
  if (requested) return normalizeGuiUpdateChannel(requested)
  if (getSelectedChannel) {
    return normalizeGuiUpdateChannel(await getSelectedChannel())
  }
  return DEFAULT_GUI_UPDATE_CHANNEL
}

// env 逃生舱优先(保留 KUN_UPDATE_URL* 语义):设了就走 generic 源;
// 否则一律 GitHub provider,通道差异只体现在 allowPrerelease 上
// (stable 只看正式 Release,frontier 连 0.1.3-test.N 这类 prerelease 一起看)。
function configureUpdaterChannel(channel: GuiUpdateChannel): void {
  const normalized = normalizeGuiUpdateChannel(channel)
  const direct = envUpdateUrl(normalized)
  const feedUrl = direct || `github:${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}`
  const changed = normalized !== configuredChannel || feedUrl !== configuredFeedUrl
  configuredChannel = normalized
  configuredFeedUrl = feedUrl
  autoUpdater.allowPrerelease = normalized === 'frontier'
  if (direct) {
    autoUpdater.setFeedURL({ provider: 'generic', url: direct })
  } else {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: GITHUB_UPDATE_OWNER,
      repo: GITHUB_UPDATE_REPO
    })
  }
  if (!changed) return
  downloaded = false
  downloadPromise = null
  lastInfo = null
  emitGuiUpdateState({ status: 'idle' })
}

export function setGuiUpdateChannel(channel: GuiUpdateChannel): void {
  configureUpdaterChannel(channel)
}

type ManualUpdateMetadata = {
  latestVersion: string
  releaseDate?: string
  releaseUrl?: string
  releaseNotes?: string
}

// 手动检查(如未签名 mac 构建)不经过 electron-updater:
// env 覆盖源读 generic manifest,默认源读 GitHub Releases API。
async function fetchManualUpdateMetadata(channel: GuiUpdateChannel): Promise<ManualUpdateMetadata> {
  const direct = envUpdateUrl(channel)
  if (direct) {
    const res = await fetch(updateFeedManifestUrl(direct), {
      headers: {
        Accept: 'application/x-yaml,text/yaml,text/plain,*/*',
        'User-Agent': `kun/${app.getVersion()}`
      }
    })
    if (!res.ok) throw new Error(`Update metadata returned ${res.status}.`)
    const text = await res.text()
    return {
      latestVersion: parseYamlScalar(text, 'version'),
      releaseDate: parseYamlScalar(text, 'releaseDate')
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases?per_page=30`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `kun/${app.getVersion()}`
      }
    }
  )
  if (!res.ok) throw new Error(`GitHub releases metadata returned ${res.status}.`)
  const releases = (await res.json()) as Array<{
    tag_name?: string
    draft?: boolean
    prerelease?: boolean
    published_at?: string
    html_url?: string
    body?: string
  }>
  if (!Array.isArray(releases)) return { latestVersion: '' }
  const allowPrerelease = channel === 'frontier'
  const latest = releases.find(
    (release) => Boolean(release?.tag_name) && !release.draft && (allowPrerelease || !release.prerelease)
  )
  if (!latest?.tag_name) return { latestVersion: '' }
  return {
    latestVersion: latest.tag_name.trim().replace(/^v/i, ''),
    releaseDate: latest.published_at,
    releaseUrl: latest.html_url,
    releaseNotes: normalizeReleaseNotes(latest.body)
  }
}

async function checkManualUpdate(
  channel: GuiUpdateChannel,
  code: GuiUpdateFailureCode = 'unsupported'
): Promise<GuiUpdateInfo> {
  const currentVersion = app.getVersion()
  try {
    const metadata = await fetchManualUpdateMetadata(channel)
    const latestVersion = metadata.latestVersion
    if (!latestVersion) {
      return {
        ok: false,
        currentVersion,
        code,
        message: `${unsupportedMessage()} Update metadata is missing a version.`,
        releaseUrl: downloadPageUrl(),
        channel
      }
    }
    const info: Extract<GuiUpdateInfo, { ok: true }> = {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isVersionGreater(latestVersion, currentVersion),
      releaseUrl: metadata.releaseUrl || releaseUrlForVersion(latestVersion),
      releaseNotes: metadata.releaseNotes,
      releaseDate: metadata.releaseDate ?? '',
      channel,
      manualOnly: true,
      downloaded: false
    }
    lastInfo = info
    emitGuiUpdateState(info.hasUpdate ? { status: 'available', info } : { status: 'not_available', info })
    return info
  } catch (e) {
    return {
      ok: false,
      currentVersion,
      code,
      message: `${unsupportedMessage()} ${e instanceof Error ? e.message : String(e)}`,
      releaseUrl: downloadPageUrl(),
      channel
    }
  }
}

export function initializeGuiUpdater(
  windowGetter: () => BrowserWindow | null,
  channelGetter?: () => GuiUpdateChannel | Promise<GuiUpdateChannel>,
  beforeInstall?: () => void | Promise<void>,
  localeGetter?: () => 'en' | 'zh' | Promise<'en' | 'zh'>
): void {
  getMainWindow = windowGetter
  getSelectedChannel = channelGetter ?? null
  beforeInstallUpdate = beforeInstall ?? null
  getSelectedLocale = localeGetter ?? null
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  configureUpdaterChannel(configuredChannel)
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.logger = {
    info: (message?: unknown) => console.info('[kun-gui updater]', message),
    warn: (message?: unknown) => console.warn('[kun-gui updater]', message),
    error: (message?: unknown) => console.error('[kun-gui updater]', message)
  }

  autoUpdater.on('checking-for-update', () => {
    emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  })

  autoUpdater.on('update-available', (updateInfo: UpdateInfo) => {
    downloaded = false
    if (windowsUpdateArchMismatch(updateInfo)) {
      // 架构不匹配：不进入 available（不弹更新窗）、不缓存为可下载版本，
      // 避免 electron-updater findFile fallback 静默下载错误架构的安装包。
      lastInfo = null
      emitArchMismatchError(configuredChannel)
      return
    }
    const info = toGuiInfo(updateInfo, true)
    lastInfo = info
    emitGuiUpdateState({ status: 'available', info })
  })

  autoUpdater.on('update-not-available', (updateInfo: UpdateInfo) => {
    downloaded = false
    const info = toGuiInfo(updateInfo, false)
    lastInfo = info
    emitGuiUpdateState({ status: 'not_available', info })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    emitGuiUpdateState({ status: 'downloading', info: lastInfo ?? undefined, progress })
  })

  autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    downloaded = true
    const info = toGuiInfo(event, true)
    lastInfo = info
    pendingVersionStateWrite = recordPendingUpdate(event)
      .catch((error) => {
        console.warn('[kun-gui updater] failed to save release notes:', error)
      })
      .finally(() => {
        pendingVersionStateWrite = null
      })
    emitGuiUpdateState({ status: 'downloaded', info })
  })

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'unknown' })
  })

  nativeAutoUpdater?.on?.('before-quit-for-update', () => {
    void runBeforeInstallUpdate().catch((error) => {
      console.warn('[kun-gui updater] failed to stop runtimes before update quit:', error)
    })
  })

  scheduleNextBackgroundCheck()
}

export async function showPostUpdateReleaseNotes(): Promise<void> {
  const currentVersion = app.getVersion().trim()
  const state = await readGuiVersionState()
  if (!state.lastSeenVersion) {
    await writeGuiVersionState({ ...state, lastSeenVersion: currentVersion })
    return
  }
  if (state.lastSeenVersion === currentVersion) return

  const pendingUpdate =
    state.pendingUpdate?.version === currentVersion ? state.pendingUpdate : undefined
  const locale = await selectedLocale()
  const releaseNotes =
    pendingUpdate?.releaseNotes ??
    (locale === 'zh'
      ? '此版本的完整更新内容可在 Claude360 Copilot 更新日志中查看。'
      : 'See the Claude360 Copilot changelog for the complete release notes.')
  let channel = configuredChannel
  try {
    channel = await resolveUpdateChannel()
  } catch {
    channel = configuredChannel
  }
  await writeGuiVersionState({ lastSeenVersion: currentVersion })
  emitGuiUpdateState({
    status: 'updated',
    info: {
      currentVersion,
      releaseUrl: changelogUrl(),
      releaseNotes,
      channel
    }
  })
}

export function getGuiUpdateState(): GuiUpdateState {
  return lastState
}

export async function getDismissedGuiUpdateVersion(): Promise<string | undefined> {
  const state = await readGuiVersionState()
  const version = typeof state.dismissedUpdateVersion === 'string' ? normalizeUpdateVersion(state.dismissedUpdateVersion) : ''
  return version || undefined
}

export async function dismissGuiUpdateVersion(version: string): Promise<void> {
  const normalized = normalizeUpdateVersion(version)
  if (!normalized) return
  const state = await readGuiVersionState()
  await writeGuiVersionState({
    ...state,
    dismissedUpdateVersion: normalized
  })
}

export async function checkGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateInfo> {
  const selectedChannel = await resolveUpdateChannel(channel)
  configureUpdaterChannel(selectedChannel)

  if (!macAutoUpdateAllowed()) {
    return checkManualUpdate(selectedChannel, 'unsupported')
  }

  emitGuiUpdateState({ status: 'checking', info: lastInfo ?? undefined })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return checkManualUpdate(selectedChannel, 'not_configured')
    }
    if (result.isUpdateAvailable && windowsUpdateArchMismatch(result.updateInfo)) {
      // 有新版本但 feed 中没有当前架构的安装包（如 latest.yml 缺 ia32 条目）：
      // 显式报错并阻断下载，绝不 fallback 到其他架构的 exe。
      lastInfo = null
      const info = await archMismatchInfo(selectedChannel)
      emitGuiUpdateState({ status: 'error', info, message: info.message, code: 'arch_mismatch' })
      return info
    }
    const info = toGuiInfo(result.updateInfo, result.isUpdateAvailable)
    lastInfo = info
    emitGuiUpdateState(info.hasUpdate ? { status: 'available', info } : { status: 'not_available', info })
    return info
  } catch (e) {
    const message = sanitizeUpdaterError(e instanceof Error ? e.message : String(e), selectedChannel)
    const info: GuiUpdateInfo = {
      ok: false,
      currentVersion: app.getVersion(),
      message,
      code: 'unknown',
      releaseUrl: downloadPageUrl(),
      channel: selectedChannel
    }
    emitGuiUpdateState({ status: 'error', info, message, code: 'unknown' })
    return info
  }
}

export async function downloadGuiUpdate(channel?: GuiUpdateChannel): Promise<GuiUpdateDownloadResult> {
  const selectedChannel = await resolveUpdateChannel(channel)
  configureUpdaterChannel(selectedChannel)

  if (!macAutoUpdateAllowed()) {
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'unsupported',
      message: unsupportedMessage()
    }
  }

  try {
    if (!lastInfo?.hasUpdate || lastInfo.channel !== selectedChannel) {
      const checked = await checkGuiUpdate(selectedChannel)
      if (!checked.ok) return checked
      if (!checked.hasUpdate || checked.manualOnly) {
        return {
          ok: false,
          currentVersion: app.getVersion(),
          code: checked.manualOnly ? 'unsupported' : 'unknown',
          message: checked.manualOnly
            ? unsupportedMessage()
            : 'No downloadable GUI update is available.'
        }
      }
    }

    if (!downloadPromise) {
      downloadPromise = autoUpdater.downloadUpdate().finally(() => {
        downloadPromise = null
      })
    }
    const paths = await downloadPromise
    return { ok: true, paths }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'download_failed' })
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'download_failed',
      message
    }
  }
}

export async function installGuiUpdate(): Promise<GuiUpdateInstallResult> {
  try {
    if (!downloaded) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        code: 'install_failed',
        message: 'The update has not finished downloading yet.'
      }
    }
    emitGuiUpdateState({ status: 'installing', info: lastInfo ?? undefined })
    await Promise.all([pendingVersionStateWrite, runBeforeInstallUpdate()])
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    emitGuiUpdateState({ status: 'error', info: lastInfo ?? undefined, message, code: 'install_failed' })
    return {
      ok: false,
      currentVersion: app.getVersion(),
      code: 'install_failed',
      message
    }
  }
}
