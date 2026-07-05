import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
