import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUI_UPDATE_STARTUP_CHECK_DELAY_MS } from '../shared/gui-update-schedule'

type MockUpdater = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  forceDevUpdateConfig: boolean
  logger: unknown
  setFeedURL: ReturnType<typeof vi.fn>
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}

let updater: MockUpdater
let nativeUpdater: EventEmitter
let originalEnv: NodeJS.ProcessEnv
let appVersion: string
let mockedFiles: Map<string, string>
let showMessageBox: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>

function createUpdater(): MockUpdater {
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    forceDevUpdateConfig: false,
    logger: null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  })
}

// Windows 架构守卫测试需要伪装 process.platform / process.arch。
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const originalArchDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')

function stubProcessPlatformArch(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
}

function restoreProcessPlatformArch(): void {
  if (originalPlatformDescriptor) Object.defineProperty(process, 'platform', originalPlatformDescriptor)
  if (originalArchDescriptor) Object.defineProperty(process, 'arch', originalArchDescriptor)
}

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

beforeEach(() => {
  originalEnv = { ...process.env }
  vi.useFakeTimers()
  vi.resetModules()
  updater = createUpdater()
  nativeUpdater = new EventEmitter()
  appVersion = '0.1.0'
  mockedFiles = new Map()
  showMessageBox = vi.fn().mockResolvedValue({ response: 1 })
  openExternal = vi.fn().mockResolvedValue(undefined)
  vi.doMock('node:fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(async (path: string) => {
      const value = mockedFiles.get(String(path))
      if (value === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      return value
    }),
    writeFile: vi.fn(async (path: string, value: string) => {
      mockedFiles.set(String(path), String(value))
    })
  }))
  vi.doMock('electron', () => ({
    app: {
      isPackaged: true,
      getAppPath: () => '/tmp/deepseek-gui-updater-test-app',
      getPath: () => '/tmp/deepseek-gui-updater-test-user-data',
      getVersion: () => appVersion,
      getLocale: () => 'en-US'
    },
    autoUpdater: nativeUpdater,
    BrowserWindow: class {},
    dialog: { showMessageBox },
    shell: { openExternal }
  }))
  vi.doMock('electron-updater', () => ({
    default: { autoUpdater: updater },
    autoUpdater: updater
  }))
})

afterEach(() => {
  process.env = originalEnv
  restoreProcessPlatformArch()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.doUnmock('electron')
  vi.doUnmock('electron-updater')
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
})

function platformManifestName(): string {
  if (process.platform === 'darwin') return 'latest-mac.yml'
  if (process.platform === 'linux') return 'latest-linux.yml'
  return 'latest.yml'
}

describe('checkGuiUpdate feed configuration', () => {
  it('uses the GitHub provider for the stable channel without prereleases', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '0.2.0',
        releaseDate: '2026-06-06T00:00:00.000Z',
        releaseNotes: '修复更新流程并改进启动体验。'
      },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true,
      releaseNotes: '修复更新流程并改进启动体验。'
    })
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'github',
      owner: 'Johnhpure',
      repo: 'claude360-Copilot'
    })
  })

  it('enables prereleases on the frontier channel', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.1.3-test.12', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'frontier')

    await expect(module.checkGuiUpdate('frontier')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.1.3-test.12',
      hasUpdate: true
    })
    expect(updater.allowPrerelease).toBe(true)
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'github',
      owner: 'Johnhpure',
      repo: 'claude360-Copilot'
    })
  })

  it('honors the KUN_UPDATE_URL escape hatch with a generic feed', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    process.env.KUN_UPDATE_URL = 'https://updates.example.com/{channel}'
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(updater.setFeedURL).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: 'https://updates.example.com/stable/'
    })
  })
})

describe('checkGuiUpdate manual fallback', () => {
  // checkForUpdates 返回 null 时走 checkManualUpdate 分支,
  // 跨平台复现未签名 mac 构建的 manualOnly 检查路径。
  it('reads the generic manifest when KUN_UPDATE_URL is set', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    process.env.KUN_UPDATE_URL = 'https://updates.example.com/{channel}'
    updater.checkForUpdates.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'version: 0.3.0\nreleaseDate: 2026-07-01T00:00:00.000Z\n'
    })
    vi.stubGlobal('fetch', fetchMock)

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.3.0',
      hasUpdate: true,
      manualOnly: true
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://updates.example.com/stable/${platformManifestName()}`,
      expect.anything()
    )
  })

  it('reads GitHub releases metadata when no env override is set', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    updater.checkForUpdates.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: 'v0.4.0-test.2', prerelease: true, draft: false, published_at: '2026-07-02T00:00:00.000Z' },
        {
          tag_name: 'v0.3.0',
          prerelease: false,
          draft: false,
          published_at: '2026-07-01T00:00:00.000Z',
          html_url: 'https://github.com/Johnhpure/claude360-Copilot/releases/tag/v0.3.0',
          body: '正式版 v0.3.0：\n- 新增应用内更新提醒'
        }
      ]
    })
    vi.stubGlobal('fetch', fetchMock)

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    // stable 通道跳过 prerelease,取第一条正式 Release。
    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.3.0',
      hasUpdate: true,
      manualOnly: true,
      releaseUrl: 'https://github.com/Johnhpure/claude360-Copilot/releases/tag/v0.3.0',
      releaseNotes: '正式版 v0.3.0：\n- 新增应用内更新提醒'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/Johnhpure/claude360-Copilot/releases?per_page=30',
      expect.anything()
    )
  })

  it('picks prereleases for the frontier channel and compares prerelease semver', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    appVersion = '0.4.0-test.1'
    updater.checkForUpdates.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: 'v0.4.0-test.2', prerelease: true, draft: false, published_at: '2026-07-02T00:00:00.000Z' },
        { tag_name: 'v0.3.0', prerelease: false, draft: false, published_at: '2026-07-01T00:00:00.000Z' }
      ]
    })
    vi.stubGlobal('fetch', fetchMock)

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'frontier')

    await expect(module.checkGuiUpdate('frontier')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.4.0-test.2',
      hasUpdate: true,
      manualOnly: true
    })
  })

  it('treats a formal release as newer than the old claude360 prerelease line with the same base version', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    appVersion = '0.1.0-claude360.20260705.3'
    updater.checkForUpdates.mockResolvedValue(null)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          tag_name: 'v0.1.0',
          prerelease: false,
          draft: false,
          published_at: '2026-07-05T00:00:00.000Z',
          html_url: 'https://github.com/Johnhpure/claude360-Copilot/releases/tag/v0.1.0'
        }
      ]
    })
    vi.stubGlobal('fetch', fetchMock)

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      currentVersion: '0.1.0-claude360.20260705.3',
      latestVersion: '0.1.0',
      hasUpdate: true,
      manualOnly: true
    })
  })
})

describe('installGuiUpdate', () => {
  it('waits for managed runtime cleanup before asking the updater to quit and install', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('reuses the same cleanup when the native updater emits before-quit-for-update', async () => {
    const module = await import('./gui-updater')
    let finishCleanup = (): void => {
      throw new Error('cleanup resolver was not set')
    }
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve
    }))

    module.initializeGuiUpdater(() => null, () => 'stable', beforeInstall)
    updater.emit('update-downloaded', { version: '0.2.0', releaseDate: '2026-06-06T00:00:00.000Z' })

    nativeUpdater.emit('before-quit-for-update')
    const installing = module.installGuiUpdate()
    await Promise.resolve()

    expect(beforeInstall).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    finishCleanup()
    await expect(installing).resolves.toEqual({ ok: true })
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})

describe('dismissed GUI update version', () => {
  const versionStatePath = join(
    '/tmp/deepseek-gui-updater-test-user-data',
    'gui-version-state.json'
  )

  it('persists the ignored update version without dropping existing version state', async () => {
    mockedFiles.set(
      versionStatePath,
      JSON.stringify({
        lastSeenVersion: '0.1.0',
        pendingUpdate: {
          version: '0.2.0',
          releaseNotes: '历史更新内容'
        }
      })
    )
    const module = await import('./gui-updater')

    await module.dismissGuiUpdateVersion('v0.2.0')

    await expect(module.getDismissedGuiUpdateVersion()).resolves.toBe('0.2.0')
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.1.0',
      pendingUpdate: {
        version: '0.2.0',
        releaseNotes: '历史更新内容'
      },
      dismissedUpdateVersion: '0.2.0'
    })
  })
})

describe('showPostUpdateReleaseNotes', () => {
  const versionStatePath = join(
    '/tmp/deepseek-gui-updater-test-user-data',
    'gui-version-state.json'
  )

  it('records the first launched version without showing a notice', async () => {
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await module.showPostUpdateReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.1.0'
    })
  })

  it('emits a themed updated prompt once after the version changes', async () => {
    appVersion = '0.2.0'
    mockedFiles.set(
      versionStatePath,
      JSON.stringify({
        lastSeenVersion: '0.1.0',
        pendingUpdate: {
          version: '0.2.0',
          releaseNotes: '<p>更新内容：</p><ul><li>修复更新流程</li><li>改进启动体验</li></ul>'
        }
      })
    )
    const send = vi.fn()
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(
      () => ({
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send
        }
      }) as never,
      () => 'stable',
      undefined,
      () => 'zh'
    )

    await module.showPostUpdateReleaseNotes()
    await module.showPostUpdateReleaseNotes()

    expect(showMessageBox).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
    const updatedCalls = send.mock.calls.filter(
      ([channel, payload]) => channel === 'gui:update-state' && payload?.status === 'updated'
    )
    expect(updatedCalls).toHaveLength(1)
    expect(updatedCalls[0]).toEqual([
      'gui:update-state',
      expect.objectContaining({
        status: 'updated',
        info: expect.objectContaining({
          currentVersion: '0.2.0',
          releaseUrl: 'https://github.com/Johnhpure/claude360-Copilot/releases',
          releaseNotes: '<p>更新内容：</p><ul><li>修复更新流程</li><li>改进启动体验</li></ul>',
          channel: 'stable'
        })
      })
    ])
    expect(JSON.parse(mockedFiles.get(versionStatePath) ?? '{}')).toEqual({
      lastSeenVersion: '0.2.0'
    })
  })
})

describe('windows installer arch guard (AC8)', () => {
  const DUAL_ARCH_FILES = [
    { url: 'Claude360-Copilot-0.2.0-win-x64.exe' },
    { url: 'Claude360-Copilot-0.2.0-win-ia32.exe' },
    { url: 'Claude360-Copilot-0.2.0-win-x64.zip' }
  ]

  it('replicates electron-updater findFile selection and validates the arch strictly', async () => {
    const module = await import('./gui-updater')
    const dual = DUAL_ARCH_FILES.map((file) => file.url)

    expect(module.selectWindowsInstallerUrl(dual, 'ia32')).toBe('Claude360-Copilot-0.2.0-win-ia32.exe')
    expect(module.selectWindowsInstallerUrl(dual, 'x64')).toBe('Claude360-Copilot-0.2.0-win-x64.exe')
    expect(module.windowsInstallerMatchesArch(dual, 'ia32')).toBe(true)
    expect(module.windowsInstallerMatchesArch(dual, 'x64')).toBe(true)

    // findFile 的 fallback 陷阱：feed 缺当前 arch 条目时会静默取第一个 exe。
    const x64Only = ['Claude360-Copilot-0.2.0-win-x64.exe']
    expect(module.selectWindowsInstallerUrl(x64Only, 'ia32')).toBe('Claude360-Copilot-0.2.0-win-x64.exe')
    expect(module.windowsInstallerMatchesArch(x64Only, 'ia32')).toBe(false)

    const ia32Only = ['Claude360-Copilot-0.2.0-win-ia32.exe']
    expect(module.windowsInstallerMatchesArch(ia32Only, 'x64')).toBe(false)

    // 没有任何 exe（如坏 feed）按不匹配处理，宁可拒绝下载。
    expect(module.windowsInstallerMatchesArch([], 'ia32')).toBe(false)
  })

  it('keeps the available flow when the feed contains the matching ia32 installer', async () => {
    stubProcessPlatformArch('win32', 'ia32')
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '0.2.0',
        releaseDate: '2026-06-06T00:00:00.000Z',
        files: DUAL_ARCH_FILES
      },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    await expect(module.checkGuiUpdate('stable')).resolves.toMatchObject({
      ok: true,
      latestVersion: '0.2.0',
      hasUpdate: true
    })
    expect(module.getGuiUpdateState()).toMatchObject({ status: 'available' })
  })

  it('refuses the ia32 client when the feed only lists the x64 installer', async () => {
    stubProcessPlatformArch('win32', 'ia32')
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '0.2.0',
        releaseDate: '2026-06-06T00:00:00.000Z',
        files: [{ url: 'Claude360-Copilot-0.2.0-win-x64.exe' }]
      },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable', undefined, () => 'zh')

    const info = await module.checkGuiUpdate('stable')
    expect(info.ok).toBe(false)
    if (info.ok) throw new Error('expected the arch mismatch failure result')
    expect(info.code).toBe('arch_mismatch')
    expect(info.message).toContain('未找到适用于当前架构')
    expect(info.message).toContain('ia32')
    // 进入 error 而非 available：全局更新弹窗不弹、版本不缓存为可下载。
    expect(module.getGuiUpdateState()).toMatchObject({ status: 'error', code: 'arch_mismatch' })

    // 下载链路被阻断：重新检查仍是 mismatch，绝不调用 downloadUpdate。
    const download = await module.downloadGuiUpdate('stable')
    expect(download.ok).toBe(false)
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('blocks the x64 client from the findFile fallback onto an ia32-only feed', async () => {
    stubProcessPlatformArch('win32', 'x64')
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '0.2.0',
        releaseDate: '2026-06-06T00:00:00.000Z',
        files: [{ url: 'Claude360-Copilot-0.2.0-win-ia32.exe' }]
      },
      isUpdateAvailable: true
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    const info = await module.checkGuiUpdate('stable')
    expect(info.ok).toBe(false)
    if (info.ok) throw new Error('expected the arch mismatch failure result')
    expect(info.code).toBe('arch_mismatch')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('drops a mismatched update-available event instead of caching it as downloadable', async () => {
    stubProcessPlatformArch('win32', 'ia32')
    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable', undefined, () => 'zh')

    updater.emit('update-available', {
      version: '0.2.0',
      releaseDate: '2026-06-06T00:00:00.000Z',
      files: [{ url: 'Claude360-Copilot-0.2.0-win-x64.exe' }]
    })
    await flushMicrotasks()

    expect(module.getGuiUpdateState()).toMatchObject({ status: 'error', code: 'arch_mismatch' })

    // 匹配的事件照常进入 available。
    updater.emit('update-available', {
      version: '0.2.0',
      releaseDate: '2026-06-06T00:00:00.000Z',
      files: DUAL_ARCH_FILES
    })
    await flushMicrotasks()

    expect(module.getGuiUpdateState()).toMatchObject({ status: 'available' })
  })
})

describe('startup automatic update check (AC6)', () => {
  it('checks once per launch after the fixed 3-5s delay and never reschedules', async () => {
    process.env.DEEPSEEK_GUI_ALLOW_UNSIGNED_UPDATES = '1'
    updater.checkForUpdates.mockResolvedValue({
      updateInfo: { version: '0.1.0', releaseDate: '2026-06-06T00:00:00.000Z' },
      isUpdateAvailable: false
    })

    const module = await import('./gui-updater')
    module.initializeGuiUpdater(() => null, () => 'stable')

    // 初始化本身不检查（不阻塞启动），到达固定延迟后才自动检查一次。
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(GUI_UPDATE_STARTUP_CHECK_DELAY_MS - 1)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    // 同一进程内不再自动检查：推进 24 小时也没有第二次（取代旧 24h 节流语义）。
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    // 手动检查不受启动调度限制。
    await module.checkGuiUpdate('stable')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})
