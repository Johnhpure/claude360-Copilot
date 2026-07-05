import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  Notification,
  powerSaveBlocker,
  Tray,
  type ContextMenuParams,
  type MenuItemConstructorOptions
} from 'electron'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  JsonSettingsStore,
  devServerHintUrl
} from './settings-store'
import claude360LogoPng from '../asset/img/claude360.png?url'
import claude360MacLogoPng from '../asset/img/claude360_mac.png?url'
import claude360TrayPng from '../asset/img/claude360_tray.png?url'
import { createAppIcon, pickTrayIcon, prepareTrayIcon } from './app-icon'
import { buildTrayMenuTemplate, parseTrayThreads, type TrayThreadSummary } from './tray-session-menu'
import { configureLinuxWaylandImeSwitches } from './app-command-line'
import { configureAppIdentity, AUTO_IMPORT_LEGACY_DATA, APP_PRODUCT_NAME } from './app-identity'
import { shouldStartHidden, syncLoginItemSettings } from './desktop-behavior'
import { resolveLogDirectory, resolvePreloadPath } from './main-paths'
import { runLegacyKunDataMigration } from './legacy-data-migration'
import {
  applyKunRuntimePatch,
  kunSettingsEnvelope,
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  getModelProviderProfile,
  mergeKunRuntimeSettings,
  mergeClawSettings,
  mergeWorkflowSettings,
  mergeAppBehaviorSettings,
  mergeModelProviderSettings,
  mergeScheduleSettings,
  mergeWriteSettings,
  mergeTerminalSettings,
  mergeClaude360Settings,
  DEFAULT_CLAUDE360_BASE_URL,
  MIN_KUN_LOCAL_PORT,
  normalizeAppSettings,
  normalizeAppBehaviorSettings,
  normalizeCheckpointCleanupSettings,
  normalizeKeyboardShortcuts,
  resolveKunRuntimeSettings,
  resolveTerminalColorMode,
  type AppBehaviorConfigV1,
  type AppSettingsPatch,
  type AppSettingsV1,
  type WindowCloseAction
} from '../shared/app-settings'
import { Claude360ApiClient } from './services/claude360-api-client'
import { Claude360AuthService } from './services/claude360-auth-service'
import { Claude360TokenService } from './services/claude360-token-service'
import { Claude360ModelService } from './services/claude360-model-service'
import { Claude360BillingService } from './services/claude360-billing-service'
import { Claude360MusicService } from './services/claude360-music-service'
import { Claude360CanvasService } from './services/claude360-canvas-service'
import { Claude360ChatService } from './services/claude360-chat-service'
import { registerClaude360ChatStreamIpc } from './claude360-chat-stream-ipc'
import { createClaude360SecretStore, claude360ApiKeyRef } from './services/claude360-secret-store'
import { parseRuntimeErrorBody, runtimeErrorToError, type RuntimeErrorCode } from '../shared/runtime-error'
import type { GuiUpdateState } from '../shared/gui-update'
import type { TrayActionPayload } from '../shared/kun-gui-api'
import { isAllowedDevPreviewUrl } from '../shared/dev-preview-url'
import { isAuthorizedPrototypeFileUrl } from './services/prototype-embed-registry'
import { fetchUpstreamModelIds } from './upstream-models'
import {
  kunRuntimeAdapter,
  getRuntimeBaseUrlForSettings,
  runtimeAuthHeaders,
  runtimeRequestViaHost
} from './runtime/kun-adapter'
import { waitForRuntimeTurnsIdle } from './runtime/managed-runtime-idle'
import {
  resolveKunDataDir,
  setClaude360KeyResolver,
  setKunUnexpectedExitHandler,
  waitForKunStartupSettled,
  type KunUnexpectedExitInfo
} from './kun-process'
import { RestartBudget, type KunRuntimeStatus } from './kun-runtime-supervisor'
import { configureLogger, logError, logWarn, pruneOnStartup } from './logger'
import { cleanupUnusedGitCheckpointsIfDue } from './services/git-checkpoint-service'
import { createClawRuntime, type ClawRuntime } from './claw-runtime'
import { createScheduleRuntime, type ScheduleRuntime } from './schedule-runtime'
import { createWorkflowRuntime, type WorkflowRuntime } from './workflow-runtime'
import { runClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'
import {
  clawScheduleMcpSettingsChanged,
  resolveKunMcpJsonPath,
  syncClawScheduleMcpConfig,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { registerAppIpcHandlers } from './ipc/register-app-ipc-handlers'
import {
  configureManagedWeixinBridgeUrlResolver,
  pollFeishuInstall,
  pollWeixinInstall,
  startFeishuInstallQrcode,
  startWeixinInstallQrcode
} from './claw-platform-install'
import { registerRuntimeSseIpc } from './runtime-sse-ipc'
import { registerTerminalPtyIpc } from './terminal/terminal-pty-ipc'
import {
  configureWeixinBridgeRuntimeContextProvider,
  ensureWeixinBridgeRpcUrl,
  getWeixinBridgeAccountUserId,
  sendWeixinBridgeMessage,
  stopWeixinBridgeRuntime
} from './weixin-bridge-runtime'
import { webhookUrl } from './claw-runtime-helpers'
import { createTelegramRuntime, type TelegramRuntime, verifyTelegramBotToken } from './telegram-runtime'
import { isKunHealthResponseBody } from './kun-health'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Windows 通知 / 任务栏分组使用新的 Claude360 Copilot 应用身份。
// 该值必须和 electron-builder 的 appId 保持一致。
const APP_USER_MODEL_ID = 'xyz.claude360.copilot'
const startupTraceEnabled =
  process.env.KUN_STARTUP_TRACE === '1' || process.env.DEEPSEEK_GUI_STARTUP_TRACE === '1'
const startupTraceStart = Date.now()

function traceStartup(label: string, detail?: unknown): void {
  if (!startupTraceEnabled) return
  const elapsed = String(Date.now() - startupTraceStart).padStart(6, ' ')
  if (detail === undefined) {
    console.info(`[startup +${elapsed}ms] ${label}`)
  } else {
    console.info(`[startup +${elapsed}ms] ${label}`, detail)
  }
}

function shouldStartWeixinBridgeRuntime(settings: AppSettingsV1): boolean {
  return settings.claw.enabled &&
    settings.claw.im.enabled &&
    settings.claw.channels.some((channel) => channel.enabled && channel.provider === 'weixin')
}

function syncWeixinBridgeRuntime(settings: AppSettingsV1): void {
  if (!shouldStartWeixinBridgeRuntime(settings)) return
  void ensureWeixinBridgeRpcUrl().catch((error) => {
    logWarn('weixin-bridge', 'Failed to start managed WeChat bridge.', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

const runningClawScheduleMcpServer =
  process.argv.includes('--gui-schedule-mcp-server') || process.argv.includes('--claw-schedule-mcp-server')

function getClawScheduleMcpLaunchConfig(): ClawScheduleMcpLaunchConfig {
  return {
    appPath: app.getAppPath(),
    execPath: process.execPath,
    isPackaged: app.isPackaged
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runtimeFailure(code: string, message: string, status = 0, details?: unknown) {
  return {
    ok: false as const,
    status,
    body: JSON.stringify({ code, message, ...(details !== undefined ? { details } : {}) })
  }
}

function resolveConfiguredApiKey(settings: AppSettingsV1): string {
  const fromSettings = getActiveAgentApiKey(settings)
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
  return fromSettings || fromEnv
}

// #329 保护的「配置了可用 Key」判定：分组模式下 provider 的 Key 以 apiKeyRef
// 存 secret-store、明文 apiKey 恒空，判定必须同时认 ref；否则该保护在
// Claude360 分组模式下恒判「无 Key」而失效/误判。
function settingsHaveResolvableApiKey(settings: AppSettingsV1): boolean {
  if (resolveConfiguredApiKey(settings)) return true
  const providerId = getKunRuntimeSettings(settings).providerId?.trim()
  if (!providerId) return false
  return Boolean(getModelProviderProfile(settings, providerId).apiKeyRef?.trim())
}

function runtimeJsonError(code: string, message: string): Error {
  return runtimeErrorToError({ code: code as RuntimeErrorCode, message })
}

traceStartup('main module evaluated')

if (runningClawScheduleMcpServer && process.platform === 'darwin') {
  app.dock.hide()
}

// 在最早的阶段把 app 名称、AppUserModelId 都设好。
// Windows 任务栏 / 系统托盘 / 通知中心看到的应用名都来自这里;
// 设得太晚的话 BrowserWindow title、托盘、IPC 启动时拿到的还是旧的。
// 抽到 app-identity.ts 是为了让测试可以直接 import,不被 main 的
// whenReady 副作用污染。
configureAppIdentity()

// 数据目录策略:Claude360 Copilot 换了全新 appId,被视为全新应用,userData 目录
// 由 productName 派生成全新目录。第一阶段默认不自动导入旧品牌数据
// (AUTO_IMPORT_LEGACY_DATA=false):既不搬旧目录,也不清理旧目录,旧数据原地保留,
// 后续如需可显式触发。legacy-data-migration 函数完整保留(隐藏≠删除),仅默认
// 关闭启动期自动触发。
//
// 迁移必须发生在 requestSingleInstanceLock() 之前:单实例锁文件放在 userData 里,
// 得先把目录定下来。rename 失败(典型场景:老版本还在运行)时退回旧目录,下次再迁。
if (AUTO_IMPORT_LEGACY_DATA) {
  const legacyMigration = runLegacyKunDataMigration({
    userDataPath: app.getPath('userData'),
    homeDir: homedir(),
    log: (message, detail) => console.warn(`[kun-gui] ${message}`, detail ?? '')
  })
  if (legacyMigration.userData.usedLegacyFallback) {
    app.setPath('userData', legacyMigration.userData.userDataPath)
  }
  traceStartup('legacy data migration checked', {
    userDataPath: legacyMigration.userData.userDataPath,
    migratedUserData: legacyMigration.userData.migrated,
    usedLegacyFallback: legacyMigration.userData.usedLegacyFallback,
    settingsRewritten: legacyMigration.settingsRewritten
  })
} else {
  traceStartup('legacy data migration skipped (fresh app policy)', {
    userDataPath: app.getPath('userData'),
    autoImportLegacyData: AUTO_IMPORT_LEGACY_DATA
  })
}

configureLinuxWaylandImeSwitches()

if (!runningClawScheduleMcpServer && process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

let mainWindow: BrowserWindow | null = null
let store: JsonSettingsStore
let logDir = ''
let clawRuntime: ClawRuntime | null = null
let scheduleRuntime: ScheduleRuntime | null = null
let telegramRuntime: TelegramRuntime | null = null
let workflowRuntime: WorkflowRuntime | null = null
let managedRuntimesStoppedForQuit = false
let managedRuntimesStopPromise: Promise<void> | null = null
let appBehavior: AppBehaviorConfigV1 = normalizeAppBehaviorSettings()
let tray: Tray | null = null
let trayMenu: Menu | null = null
let trayMenuOpenPromise: Promise<void> | null = null
let isQuitting = false
let closeWindowPromptOpen = false
let checkpointCleanupTimer: ReturnType<typeof setInterval> | null = null

type GuiUpdaterModule = typeof import('./gui-updater')

let guiUpdaterModulePromise: Promise<GuiUpdaterModule> | null = null
let guiUpdaterInitialized = false

function emitClawChannelActivity(payload: { channelId: string; threadId: string }): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('claw:channel-activity', payload)
}

function stopCheckpointCleanupTimer(): void {
  if (checkpointCleanupTimer) {
    clearInterval(checkpointCleanupTimer)
    checkpointCleanupTimer = null
  }
}

async function runCheckpointCleanupIfDue(settings: AppSettingsV1): Promise<void> {
  if (!settings.checkpointCleanup.enabled) return
  const runtime = resolveKunRuntimeSettings(settings)
  const dataDir = resolveKunDataDir(runtime)
  const intervalDays = settings.checkpointCleanup.intervalDays
  try {
    const cleanup = await cleanupUnusedGitCheckpointsIfDue({ dataDir, intervalDays })
    if (!cleanup.due) return
    const { result } = cleanup
    console.info(
      `[kun-gui] git checkpoint cleanup scanned=${result.scanned} deleted=${result.deleted} kept=${result.kept} failed=${result.failed}`
    )
    if (result.failed > 0) {
      logWarn('git-checkpoint-cleanup', 'failed to delete some unused checkpoints', {
        failed: result.failed,
        failedIds: result.failedIds
      })
    }
  } catch (error) {
    logWarn('git-checkpoint-cleanup', 'failed to clean unused checkpoints', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function syncCheckpointCleanupTimer(settings: AppSettingsV1): void {
  stopCheckpointCleanupTimer()
  if (!settings.checkpointCleanup.enabled) return
  const intervalMs = settings.checkpointCleanup.intervalDays * 24 * 60 * 60 * 1_000
  const run = (): void => {
    void runCheckpointCleanupIfDue(settings)
  }
  run()
  checkpointCleanupTimer = setInterval(run, intervalMs)
  checkpointCleanupTimer.unref?.()
}

async function stopManagedRuntimesForQuit(): Promise<void> {
  if (managedRuntimesStoppedForQuit) return
  await stopManagedRuntimes()
  managedRuntimesStoppedForQuit = true
}

async function stopManagedRuntimes(): Promise<void> {
  if (!managedRuntimesStopPromise) {
    managedRuntimesStopPromise = (async () => {
      scheduleRuntime?.stop()
      workflowRuntime?.stop()
      clawRuntime?.stop()
      telegramRuntime?.stop()
      stopWeixinBridgeRuntime()
      await kunRuntimeAdapter.stopAndWait()
    })().finally(() => {
      managedRuntimesStopPromise = null
    })
  }
  return managedRuntimesStopPromise
}

async function loadGuiUpdaterModule(): Promise<GuiUpdaterModule> {
  if (!guiUpdaterModulePromise) {
    guiUpdaterModulePromise = import('./gui-updater')
      .then((module) => {
        if (!guiUpdaterInitialized) {
          module.initializeGuiUpdater(
            () => mainWindow,
            async () => (await store.load()).guiUpdate.channel,
            stopManagedRuntimesForQuit,
            async () => (await store.load()).locale
          )
          guiUpdaterInitialized = true
        }
        return module
      })
      .catch((error) => {
        guiUpdaterModulePromise = null
        throw error
      })
  }
  return guiUpdaterModulePromise
}

async function readGuiUpdateState(): Promise<GuiUpdateState> {
  if (!guiUpdaterModulePromise) return { status: 'idle' }
  try {
    const module = await loadGuiUpdaterModule()
    return module.getGuiUpdateState()
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      code: 'unknown'
    }
  }
}


function installDevPreviewWebviewGuards(): void {
  app.on('web-contents-created', (_, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : ''
      // Prototype embeds are file:// pages the renderer authorized through
      // write:authorize-prototype right before attaching.
      if (!isAllowedDevPreviewUrl(src) && !isAuthorizedPrototypeFileUrl(src)) {
        event.preventDefault()
        return
      }

      delete webPreferences.preload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
    })

    contents.on('will-navigate', (event, navigationUrl) => {
      if (contents.getType() !== 'webview') return
      if (!isAllowedDevPreviewUrl(navigationUrl)) event.preventDefault()
    })

    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() !== 'webview') return { action: 'allow' }
      return isAllowedDevPreviewUrl(url) ? { action: 'allow' } : { action: 'deny' }
    })
  })
}


const appIconSource = process.platform === 'win32' ? claude360MacLogoPng : claude360LogoPng
const appIcon = createAppIcon(appIconSource)
const trayIcon = createAppIcon(claude360TrayPng)
traceStartup('app icon loaded', { source: appIconSource.startsWith('data:') ? 'data-url' : 'path' })
const gotSingleInstanceLock = runningClawScheduleMcpServer || app.requestSingleInstanceLock()
traceStartup('single instance lock checked', {
  gotSingleInstanceLock,
  skippedForClawScheduleMcpServer: runningClawScheduleMcpServer
})

function windowCloseLabels(locale: AppSettingsV1['locale']): {
  title: string
  message: string
  detail: string
  minimizeToTray: string
  quit: string
  cancel: string
  remember: string
} {
  if (locale === 'zh') {
    return {
      title: '关闭窗口',
      message: '关闭窗口时要怎么处理？',
      detail: `选择最小化到托盘时，${APP_PRODUCT_NAME} 会继续在后台运行；选择退出应用会结束后台服务。`,
      minimizeToTray: '最小化到托盘',
      quit: '退出应用',
      cancel: '取消',
      remember: '记住我的选择，不再询问'
    }
  }
  return {
    title: 'Close window',
    message: `What should ${APP_PRODUCT_NAME} do when this window closes?`,
    detail: `Minimize to tray keeps ${APP_PRODUCT_NAME} running in the background. Quit app stops the background service.`,
    minimizeToTray: 'Minimize to tray',
    quit: 'Quit app',
    cancel: 'Cancel',
    remember: 'Remember my choice and do not ask again'
  }
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function dispatchTrayAction(action: TrayActionPayload): void {
  revealMainWindow()
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  const send = (): void => {
    if (!window.isDestroyed()) window.webContents.send('tray:action', action)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function showRendererContextMenu(window: BrowserWindow, params: ContextMenuParams): void {
  const template: MenuItemConstructorOptions[] = []
  const hasSelection = params.selectionText.trim().length > 0
  if (params.isEditable) {
    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy || hasSelection },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
  } else if (hasSelection) {
    template.push(
      { role: 'copy', enabled: true },
      { type: 'separator' },
      { role: 'selectAll' }
    )
  }
  if (!app.isPackaged) {
    if (template.length > 0) template.push({ type: 'separator' })
    template.push({
      label: 'Inspect Element',
      click: () => window.webContents.inspectElement(params.x, params.y)
    })
  }
  if (template.length === 0) return
  Menu.buildFromTemplate(template).popup({ window, x: params.x, y: params.y })
}

function quitFromTray(): void {
  isQuitting = true
  app.quit()
}

function createTrayMenu(settings: AppSettingsV1, threads: TrayThreadSummary[]): Menu {
  return Menu.buildFromTemplate(buildTrayMenuTemplate({
    locale: settings.locale,
    threads,
    actions: {
      openThread: (threadId) => dispatchTrayAction({ type: 'open-thread', threadId }),
      newChat: () => dispatchTrayAction({ type: 'new-chat' }),
      openApp: revealMainWindow,
      quit: quitFromTray
    }
  }))
}

async function loadTrayThreads(settings: AppSettingsV1): Promise<TrayThreadSummary[]> {
  try {
    const response = await fetch(`${getRuntimeBaseUrlForSettings(settings)}/v1/threads?limit=20`, {
      headers: runtimeAuthHeaders(settings),
      signal: AbortSignal.timeout(1_000)
    })
    return response.ok ? parseTrayThreads(await response.text()) : []
  } catch (error) {
    logWarn('tray', 'Failed to load tray sessions.', {
      message: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

function showTrayMenu(): void {
  if (!tray || trayMenuOpenPromise) return
  const currentTray = tray
  trayMenuOpenPromise = (async () => {
    const settings = await store.load()
    const threads = await loadTrayThreads(settings)
    if (currentTray.isDestroyed()) return
    trayMenu = createTrayMenu(settings, threads)
    currentTray.popUpContextMenu(trayMenu)
  })().finally(() => {
    trayMenuOpenPromise = null
  })
}

function syncTray(settings: AppSettingsV1): void {
  appBehavior = settings.appBehavior
  if (appBehavior.closeAction === 'quit') {
    if (tray) {
      tray.destroy()
      tray = null
      trayMenu = null
    }
    return
  }

  if (!tray) {
    // Tray 优先用专门的托盘图(在 16x16/24x24 任务栏尺寸下更清晰的剪影);
    // 托盘图加载失败时回退到主应用图,这样不会看到 electron 默认占位。
    const traySource = prepareTrayIcon(pickTrayIcon(trayIcon, appIcon))
    tray = new Tray(traySource.isEmpty() ? nativeImage.createEmpty() : traySource)
    tray.on('click', showTrayMenu)
    tray.on('double-click', revealMainWindow)
    tray.on('right-click', showTrayMenu)
  }

  tray.setToolTip(APP_PRODUCT_NAME)
  trayMenu = createTrayMenu(settings, [])
  tray.setContextMenu(null)
}

async function saveWindowCloseActionPreference(closeAction: WindowCloseAction): Promise<void> {
  const saved = await store.patch({ appBehavior: { closeAction } })
  syncLoginItemSettings(saved)
  syncTray(saved)
}

async function promptWindowCloseAction(window: BrowserWindow): Promise<void> {
  if (closeWindowPromptOpen || window.isDestroyed()) return
  closeWindowPromptOpen = true
  try {
    const settings = await store.load()
    const labels = windowCloseLabels(settings.locale)
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      title: labels.title,
      message: labels.message,
      detail: labels.detail,
      buttons: [labels.minimizeToTray, labels.quit, labels.cancel],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: labels.remember,
      checkboxChecked: false
    })
    if (result.response === 0) {
      if (result.checkboxChecked) {
        await saveWindowCloseActionPreference('tray')
      }
      window.hide()
      return
    }
    if (result.response === 1) {
      if (result.checkboxChecked) {
        await saveWindowCloseActionPreference('quit')
      }
      isQuitting = true
      app.quit()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[kun-gui] failed to handle close-window prompt:', error)
    logWarn('desktop-behavior', 'Failed to handle close-window prompt.', { message })
  } finally {
    closeWindowPromptOpen = false
  }
}

function handleMainWindowClose(window: BrowserWindow, event: Electron.Event): void {
  if (isQuitting) return
  if (appBehavior.closeAction === 'quit') return

  event.preventDefault()
  if (appBehavior.closeAction === 'tray') {
    window.hide()
    return
  }
  void promptWindowCloseAction(window)
}

function normalizeNotificationText(raw: string | undefined, fallback: string, maxLength: number): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

type TurnCompleteNotificationPayload = {
  threadId?: string
  title?: string
  body?: string
}

async function showTurnCompleteNotification(
  payload: TurnCompleteNotificationPayload
): Promise<{ ok: true; shown: boolean; reason?: string } | { ok: false; message: string }> {
  const settings = await store.load()
  if (!settings.notifications.turnComplete) {
    return { ok: true, shown: false, reason: 'disabled' }
  }
  if (!Notification.isSupported()) {
    return { ok: true, shown: false, reason: 'unsupported' }
  }

  const title = normalizeNotificationText(payload.title, APP_PRODUCT_NAME, 80)
  const body = normalizeNotificationText(payload.body, 'Conversation complete.', 180)

  try {
    const notification = new Notification({
      title,
      body,
      icon: appIcon.isEmpty() ? undefined : appIcon
    })
    notification.on('click', () => {
      revealMainWindow()
    })
    notification.show()
    return { ok: true, shown: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('notification', 'Failed to show turn completion notification', {
      message,
      threadId: payload.threadId
    })
    return { ok: false, message }
  }
}

async function probeThreadApi(settings: AppSettingsV1): Promise<
  | { ok: true }
  | { ok: false; error: string; message: string }
> {
  const base = getRuntimeBaseUrlForSettings(settings)
  const headers = runtimeAuthHeaders(settings)
  headers.set('Accept', 'application/json')

  try {
    const res = await fetch(`${base}/v1/threads?limit=1`, {
      headers,
      signal: AbortSignal.timeout(2_000)
    })
    if (res.ok) return { ok: true }
    const info = parseRuntimeErrorBody(
      await res.text(),
      'The local runtime returned an unexpected error.'
    )
    if (res.status === 401 && /bearer token required/i.test(info.message)) {
      return {
        ok: false,
        error: 'runtime_auth_required',
        message: 'The local runtime requires a bearer token for thread APIs.'
      }
    }
    return {
      ok: false,
      error: info.code === 'unknown' ? 'runtime_request_failed' : info.code,
      message: info.message
    }
  } catch (e) {
    return {
      ok: false,
      error: 'fetch_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

async function waitForKunHealth(settings: AppSettingsV1, timeoutMs: number): Promise<boolean> {
  const base = getRuntimeBaseUrlForSettings(settings)
  const deadline = Date.now() + timeoutMs
  let lastError = ''

  while (Date.now() <= deadline) {
    const remaining = Math.max(1, deadline - Date.now())
    const result = await probeKunHealthOnce(settings, base, remaining)
    if (result.healthy) return true
    if (result.error !== lastError) {
      lastError = result.error
      logWarn('health-probe', `${base}/health: ${result.error}`)
    }
    await sleep(150)
  }

  logWarn('health-probe', `gave up after ${timeoutMs}ms, last error: ${lastError}`)
  return false
}

type KunHealthProbeResult = { healthy: boolean; error: string }
const kunHealthProbeInFlight = new Map<string, Promise<KunHealthProbeResult>>()

function probeKunHealthOnce(
  settings: AppSettingsV1,
  base: string,
  remainingMs: number
): Promise<KunHealthProbeResult> {
  const existing = kunHealthProbeInFlight.get(base)
  if (existing) return existing

  let task: Promise<KunHealthProbeResult>
  task = (async () => {
    try {
      const res = await fetch(`${base}/health`, {
        headers: runtimeAuthHeaders(settings),
        signal: AbortSignal.timeout(Math.max(250, Math.min(1_000, remainingMs)))
      })
      const healthy = res.ok && isKunHealthResponseBody(await res.text())
      return { healthy, error: healthy ? '' : `unexpected status ${res.status}` }
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })().finally(() => {
    if (kunHealthProbeInFlight.get(base) === task) kunHealthProbeInFlight.delete(base)
  })
  kunHealthProbeInFlight.set(base, task)
  return task
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

let runtimeEnsurePromise: Promise<AppSettingsV1> | null = null
let runtimeEnsureFingerprint: string | null = null
let runtimeRestartPromise: Promise<void> | null = null
let runtimeSettingsApplyPromise: Promise<void> | null = null
let lastAppliedSettings: AppSettingsV1 | null = null

const RUNTIME_WATCHDOG_INTERVAL_MS = 30_000
const RUNTIME_WATCHDOG_FAILURE_THRESHOLD = 3
/**
 * How long a managed child that failed the initial health probe gets to prove
 * it is merely busy (e.g. a long synchronous step) rather than hung, before the
 * ensure path force-restarts it in place. Generous on purpose: killing a
 * slow-but-alive runtime would cost the user their in-flight turn (#621).
 */
const RUNTIME_HUNG_CONFIRM_MS = 10_000
const runtimeRestartBudget = new RestartBudget({ windowMs: 60_000, maxRestarts: 3 })
let lastRuntimeStatus: KunRuntimeStatus | null = null
let supervisedRestartInFlight = false
let runtimeWatchdogTimer: NodeJS.Timeout | null = null
let runtimeWatchdogFailures = 0
let runtimeWatchdogTickInFlight = false

function publishRuntimeStatus(status: Omit<KunRuntimeStatus, 'at'>): void {
  const full: KunRuntimeStatus = { ...status, at: new Date().toISOString() }
  lastRuntimeStatus = full
  logWarn('runtime-status', `${full.state} (${full.source})${full.message ? `: ${full.message}` : ''}`)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('runtime:status', full)
  }
}

/** Record a healthy runtime: reset the crash budget and watchdog, announce recovery. */
function noteRuntimeHealthy(source: string): void {
  runtimeRestartBudget.reset()
  runtimeWatchdogFailures = 0
  startRuntimeWatchdog()
  if (lastRuntimeStatus && lastRuntimeStatus.state !== 'running') {
    publishRuntimeStatus({ state: 'running', source })
  }
}

function handleUnexpectedKunExit(info: KunUnexpectedExitInfo): void {
  void superviseKunCrash(info).catch((error: unknown) => {
    logError('kun-supervisor', 'supervised restart crashed', {
      message: error instanceof Error ? error.message : String(error)
    })
  })
}

async function superviseKunCrash(info: KunUnexpectedExitInfo): Promise<void> {
  if (managedRuntimesStoppedForQuit || isQuitting) return
  const exitLabel = info.signal ? `signal ${info.signal}` : `code ${info.code ?? 'unknown'}`
  publishRuntimeStatus({
    state: 'crashed',
    source: 'supervisor',
    message: `Kun exited unexpectedly (${exitLabel}).`,
    stderrTail: info.stderrTail
  })
  if (supervisedRestartInFlight) return
  supervisedRestartInFlight = true
  try {
    const settings = await store.load()
    const runtime = getKunRuntimeSettings(settings)
    if (!runtime.autoStart) {
      publishRuntimeStatus({
        state: 'stopped',
        source: 'supervisor',
        message: 'Kun exited and automatic restart is unavailable (auto-start disabled).'
      })
      return
    }
    let lastError = ''
    for (;;) {
      if (managedRuntimesStoppedForQuit || isQuitting) return
      const verdict = runtimeRestartBudget.note()
      if (!verdict.allowed) {
        publishRuntimeStatus({
          state: 'failed',
          source: 'supervisor',
          message: lastError
            ? `Kun keeps crashing; automatic restarts are paused. Last error: ${lastError}`
            : 'Kun keeps crashing; automatic restarts are paused. Check the runtime logs, then retry.',
          stderrTail: info.stderrTail
        })
        return
      }
      publishRuntimeStatus({
        state: 'restarting',
        source: 'supervisor',
        attempt: verdict.attempt,
        maxAttempts: 3,
        message: `Restarting Kun automatically (attempt ${verdict.attempt}/3).`
      })
      await new Promise((resolve) => setTimeout(resolve, verdict.delayMs))
      try {
        await ensureRuntime(await store.load())
        noteRuntimeHealthy('supervisor')
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        logWarn('kun-supervisor', `automatic restart attempt ${verdict.attempt} failed: ${lastError}`)
      }
    }
  } finally {
    supervisedRestartInFlight = false
  }
}

function startRuntimeWatchdog(): void {
  if (runtimeWatchdogTimer) return
  const timer = setInterval(() => {
    void runtimeWatchdogTick().catch((error: unknown) => {
      logWarn('kun-watchdog', 'watchdog tick failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
  }, RUNTIME_WATCHDOG_INTERVAL_MS)
  timer.unref()
  runtimeWatchdogTimer = timer
}

function stopRuntimeWatchdog(): void {
  if (runtimeWatchdogTimer) {
    clearInterval(runtimeWatchdogTimer)
    runtimeWatchdogTimer = null
  }
}

/**
 * Post-startup liveness check for the GUI-managed kun child: the boot
 * probe only covers launch, so a runtime that hangs later (blocked
 * event loop, sqlite lock) would otherwise stay dead until the user
 * restarts the app.
 */
async function runtimeWatchdogTick(): Promise<void> {
  if (runtimeWatchdogTickInFlight) return
  if (managedRuntimesStoppedForQuit || isQuitting) return
  if (
    supervisedRestartInFlight ||
    runtimeRestartPromise ||
    runtimeSettingsApplyPromise ||
    runtimeEnsurePromise
  ) {
    return
  }
  if (!kunRuntimeAdapter.isChildRunning()) return
  runtimeWatchdogTickInFlight = true
  try {
    const settings = await store.load()
    const healthy = await waitForKunHealth(settings, 5_000)
    if (healthy) {
      runtimeWatchdogFailures = 0
      return
    }
    runtimeWatchdogFailures += 1
    logWarn(
      'kun-watchdog',
      `health probe failed (${runtimeWatchdogFailures}/${RUNTIME_WATCHDOG_FAILURE_THRESHOLD})`
    )
    if (runtimeWatchdogFailures < RUNTIME_WATCHDOG_FAILURE_THRESHOLD) return
    runtimeWatchdogFailures = 0
    publishRuntimeStatus({
      state: 'restarting',
      source: 'watchdog',
      message: 'Kun stopped responding to health checks; restarting it.'
    })
    try {
      await restartRuntime(settings)
      noteRuntimeHealthy('watchdog')
    } catch (error) {
      publishRuntimeStatus({
        state: 'failed',
        source: 'watchdog',
        message: `Kun is unresponsive and the automatic restart failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    }
  } finally {
    runtimeWatchdogTickInFlight = false
  }
}

function queueRuntimeSettingsApply(prev: AppSettingsV1, next: AppSettingsV1): void {
  // Always update the prev/next anchor so a later task diffs against
  // the settings that were actually applied last, not against the
  // original `prev` captured when this call was queued.
  const anchor = lastAppliedSettings ?? prev
  lastAppliedSettings = next
  const startupConfigChanged = runtimeStartupConfigChanged(anchor, next)
  if (!startupConfigChanged) return

  const previousTask = runtimeSettingsApplyPromise ?? Promise.resolve()
  const task = previousTask
    .catch(() => undefined)
    .then(async () => {
      const current = lastAppliedSettings ?? next
      await restartManagedRuntimeForSettingsChange(anchor, current)
    })
    .catch((error: unknown) => {
      logWarn('settings-apply', 'Failed to apply Kun runtime settings in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      if (runtimeSettingsApplyPromise === task) {
        runtimeSettingsApplyPromise = null
      }
    })

  runtimeSettingsApplyPromise = task
}

function queueRuntimeMcpConfigApply(settings: AppSettingsV1): void {
  lastAppliedSettings = settings

  const previousTask = runtimeSettingsApplyPromise ?? Promise.resolve()
  const task = previousTask
    .catch(() => undefined)
    .then(async () => {
      const current = lastAppliedSettings ?? settings
      await restartManagedRuntimeForMcpConfigChange(current)
    })
    .catch((error: unknown) => {
      logWarn('mcp-config', 'Failed to apply Kun MCP config change in background', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      if (runtimeSettingsApplyPromise === task) {
        runtimeSettingsApplyPromise = null
      }
    })

  runtimeSettingsApplyPromise = task
}

async function waitForQueuedRuntimeSettingsApply(): Promise<void> {
  if (!runtimeSettingsApplyPromise) return
  await runtimeSettingsApplyPromise
}

/**
 * Build a stable fingerprint of the settings that affect the
 * Kun runtime so that `ensureRuntime` can debounce on real
 * state instead of on a single in-flight promise. Without this,
 * a fresh call that arrives while a failing ensure is still pending
 * would re-throw the old error.
 */
function runtimeFingerprint(settings: AppSettingsV1): string {
  return stableSettingsStringify(resolveKunRuntimeSettings(settings))
}

async function ensureRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const restart = runtimeRestartPromise
  if (restart) {
    try {
      await restart
      return store.load()
    } catch {
      /* fall through to a normal ensure so callers see the latest state */
    }
  }
  const fingerprint = runtimeFingerprint(settings)
  const pending = runtimeEnsurePromise
  const pendingFingerprint = runtimeEnsureFingerprint
  if (pending) {
    // Wait for the in-flight ensure, then re-evaluate against the
    // fingerprint so callers don't inherit a stale result.
    try {
      const ensuredSettings = await pending
      if (pendingFingerprint === fingerprint) return ensuredSettings
    } catch {
      /* fall through to retry with the current settings */
    }
  }
  const task = ensureRuntimeOnce(settings)
  let trackedTask: Promise<AppSettingsV1>
  trackedTask = task.finally(() => {
    if (runtimeEnsurePromise === trackedTask) {
      runtimeEnsurePromise = null
      runtimeEnsureFingerprint = null
    }
  })
  runtimeEnsurePromise = trackedTask
  runtimeEnsureFingerprint = fingerprint
  try {
    return await trackedTask
  } finally {
    /* cleanup runs via the .finally above */
  }
}

async function ensureRuntimeOnce(settings: AppSettingsV1): Promise<AppSettingsV1> {
  await waitForQueuedRuntimeSettingsApply()
  return ensureKunRuntime(settings)
}

async function resolveManagedKunLaunchSettings(
  settings: AppSettingsV1,
  source: string
): Promise<AppSettingsV1> {
  const runtime = getKunRuntimeSettings(settings)
  const resolved = await kunRuntimeAdapter.resolveAvailablePort(runtime.port)
  if (!resolved.changed) return settings

  const next = await store.patch({ agents: { kun: { port: resolved.port } } })
  lastAppliedSettings = next
  logWarn(source, `Kun port ${runtime.port} is unavailable; using ${resolved.port} for the managed runtime`, {
    previousPort: runtime.port,
    port: resolved.port,
    message: resolved.message
  })
  return next
}

async function ensureKunRuntime(settings: AppSettingsV1): Promise<AppSettingsV1> {
  const runtime = getKunRuntimeSettings(settings)

  // [perf:runtime] 分阶段耗时：诊断首次对话慢（07-05）。健康探测→spawn→就绪逐段打点。
  const perfStartedAt = Date.now()
  let perfLastAt = perfStartedAt
  const perfMark = (stage: string): void => {
    const at = Date.now()
    console.info(`[perf:runtime] ${stage} +${at - perfLastAt}ms (total ${at - perfStartedAt}ms)`)
    perfLastAt = at
  }

  const healthy = await waitForKunHealth(settings, 2_000)
  perfMark(healthy ? 'health-probe:healthy' : 'health-probe:offline')
  if (healthy) {
    const threadApi = await probeThreadApi(settings)
    if (threadApi.ok) {
      noteRuntimeHealthy('ensure')
      return settings
    }
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }

  // 分组模式：运行时启动不再依赖「全局默认 API Key」。Key 在执行任务时按所选分组
  // 动态解析/创建；运行时只需起 HTTP/SSE 服务，故无 Key 也应正常启动。
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  // A managed child that is alive but failed the probe is hung (blocked event
  // loop) or merely busy — not absent. The launch path below cannot recover it
  // on its own: resolveAvailablePort skips our own child when reclaiming the
  // port (isCurrentKunChildPid) and startKunChild early-returns while
  // isChildRunning() stays true, so it would pick a fresh port, never spawn,
  // and fail every request until the ~90s watchdog finally force-restarts
  // (KunAgent/Kun#621). Stop the hung child here so the relaunch spawns a fresh
  // process on the SAME port instead.
  if (kunRuntimeAdapter.isChildRunning()) {
    // Never tear down a child still inside its (deliberately generous) startup
    // window — interrupting a slow-but-healthy boot is the #544 restart storm.
    await waitForKunStartupSettled()
    if (kunRuntimeAdapter.isChildRunning()) {
      // Give a merely-busy runtime a real chance to answer before judging it
      // hung, so one long synchronous step does not cost the user their turn.
      const recovered = await waitForKunHealth(settings, RUNTIME_HUNG_CONFIRM_MS)
      if (recovered) {
        const threadApi = await probeThreadApi(settings)
        if (threadApi.ok) {
          noteRuntimeHealthy('ensure')
          return settings
        }
        throw runtimeJsonError(threadApi.error, threadApi.message)
      }
      logWarn(
        'runtime-start',
        `managed Kun child stopped responding on port ${runtime.port}; restarting it in place`
      )
      await kunRuntimeAdapter.stopAndWait()
    }
  }

  const launchSettings = await resolveManagedKunLaunchSettings(settings, 'runtime-start')
  const adapter = kunRuntimeAdapter
  try {
    await adapter.ensureRunning(launchSettings)
  } catch (e) {
    console.error('[kun-gui] failed to start kun:', e)
    throw e
  }
  perfMark('spawn:done')
  const started = await waitForKunHealth(launchSettings, 20_000)
  perfMark(started ? 'launch-health:ready' : 'launch-health:timeout')
  if (!started) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after launch.'
    )
  }

  const threadApi = await probeThreadApi(launchSettings)
  if (!threadApi.ok) {
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }
  perfMark('thread-api:ready')
  noteRuntimeHealthy('ensure')
  return launchSettings
}

async function restartRuntime(settings: AppSettingsV1): Promise<void> {
  if (runtimeRestartPromise) return runtimeRestartPromise
  const task = restartRuntimeOnce(settings)
    .finally(() => {
      if (runtimeRestartPromise === task) {
        runtimeRestartPromise = null
      }
    })
  runtimeRestartPromise = task
  runtimeEnsurePromise = null
  runtimeEnsureFingerprint = null
  return task
}

async function restartRuntimeOnce(settings: AppSettingsV1): Promise<void> {
  await waitForQueuedRuntimeSettingsApply()
  // Don't tear down a child that is still completing its startup; wait for it
  // to settle so a restart trigger that races a boot doesn't reset the clock
  // (#544). Resolves immediately when nothing is launching.
  await waitForKunStartupSettled()
  const runtime = getKunRuntimeSettings(settings)

  // 分组模式：无「全局默认 API Key」也允许重启运行时（见 ensureKunRuntime）。
  if (!runtime.autoStart) {
    throw runtimeJsonError(
      'runtime_offline',
      'Kun is offline. Enable automatic startup in Settings, or start `kun serve` manually.'
    )
  }

  const adapter = kunRuntimeAdapter
  await adapter.stopAndWait()
  const launchSettings = await resolveManagedKunLaunchSettings(settings, 'runtime-restart')

  try {
    await adapter.ensureRunning(launchSettings)
  } catch (e) {
    console.error('[kun-gui] failed to restart kun:', e)
    throw e
  }

  const healthy = await waitForKunHealth(launchSettings, 20_000)
  if (!healthy) {
    throw runtimeJsonError(
      'runtime_unhealthy',
      'Kun did not become healthy after restart.'
    )
  }

  const threadApi = await probeThreadApi(launchSettings)
  if (!threadApi.ok) {
    throw runtimeJsonError(threadApi.error, threadApi.message)
  }
  noteRuntimeHealthy('restart')
}

function createWindow(options: { suppressInitialShow?: boolean } = {}): void {
  traceStartup('createWindow:start')
  const preloadPath = resolvePreloadPath(__dirname)
  const usesDesktopTitleBar = process.platform === 'win32' || process.platform === 'linux'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : usesDesktopTitleBar ? 'hidden' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 31, y: 22 } : undefined,
    autoHideMenuBar: usesDesktopTitleBar,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      // Pass the home dir to the sandboxed preload (it can't require node:os).
      additionalArguments: [`--kun-home-dir=${homedir()}`]
    }
  })
  if (usesDesktopTitleBar) {
    mainWindow.setMenu(null)
    mainWindow.setMenuBarVisibility(false)
  }
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[kun-gui] failed to load preload ${preloadPath}:`, error)
    logError('preload', 'Failed to load preload script', { preloadPath, message })
  })
  mainWindow.webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    showRendererContextMenu(window, params)
  })
  const showWindow = (): void => {
    if (options.suppressInitialShow) return
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    mainWindow.show()
  }
  mainWindow.on('close', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    handleMainWindowClose(mainWindow, event)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  const devUrl = devServerHintUrl()
  traceStartup('createWindow:load', { devUrl: devUrl ?? 'file' })
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.once('ready-to-show', () => {
    traceStartup('window:ready-to-show')
    showWindow()
  })
  mainWindow.webContents.once('did-finish-load', () => {
    traceStartup('window:did-finish-load')
    if (lastRuntimeStatus && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runtime:status', lastRuntimeStatus)
    }
    showWindow()
  })
  setTimeout(() => {
    traceStartup('window:fallback-show-timeout')
    showWindow()
  }, 1500)
}

/**
 * Stable equality for the Kun runtime settings. Most fields are flat,
 * but GUI-managed capability options can be nested, so compare values
 * structurally while still surviving future field additions.
 */
function kunRuntimeConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  const a = resolveKunRuntimeSettings(prev)
  const b = resolveKunRuntimeSettings(next)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof typeof a>)
  for (const key of keys) {
    if (!stableSettingsValueEqual(a[key], b[key])) return true
  }
  return false
}

function stableSettingsValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return stableSettingsStringify(a) === stableSettingsStringify(b)
}

function stableSettingsStringify(value: unknown): string {
  return JSON.stringify(canonicalSettingsValue(value))
}

function canonicalSettingsValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSettingsValue)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalSettingsValue((value as Record<string, unknown>)[key])
  }
  return out
}

function runtimeStartupConfigChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return kunRuntimeConfigChanged(prev, next) || clawScheduleMcpSettingsChanged(prev, next)
}

/**
 * Reject runtime-affecting values that would persist a config kun can
 * never boot with. Runs before the settings patch is written to disk.
 */
function validateRuntimeSettingsForApply(next: AppSettingsV1): string | null {
  const runtime = resolveKunRuntimeSettings(next)
  if (!Number.isInteger(runtime.port) || runtime.port < MIN_KUN_LOCAL_PORT || runtime.port > 65_535) {
    return `Kun port must be an integer between ${MIN_KUN_LOCAL_PORT} and 65535 (got ${String(runtime.port)})`
  }
  const baseUrl = (runtime.baseUrl ?? '').trim()
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `model base URL must use http(s): ${baseUrl}`
      }
    } catch {
      return `model base URL is not a valid URL: ${baseUrl}`
    }
  }
  return null
}

async function restartManagedRuntimeForSettingsChange(
  prev: AppSettingsV1,
  next: AppSettingsV1
): Promise<void> {
  if (!runtimeStartupConfigChanged(prev, next)) return

  // Let any in-flight boot launch finish (or fail) before we read liveness
  // and stop the child. Killing a kun that is still inside its startup window
  // throws away the boot's progress and restarts the clock — the #544 restart
  // storm. Once it settles, the child is either healthy (graceful restart
  // below) or already gone (`wasRunning` is false and we return).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(next)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return

  // Decide BEFORE stopping the child. Stranding a healthy runtime is exactly
  // issue #329: a partial/transient save (e.g. the active providerId moved to
  // a profile whose key lives elsewhere) can momentarily resolve to "no API
  // key" even though the user clearly has one configured. If the runtime we
  // are about to restart was healthy and the previous settings had a usable
  // key, don't kill it on the strength of a key check the new settings fail —
  // leave it running on its current config; the next save with a resolvable
  // key restarts cleanly.
  const nextHasApiKey = settingsHaveResolvableApiKey(next)
  if (!nextHasApiKey && settingsHaveResolvableApiKey(prev)) {
    logWarn(
      'settings-apply',
      'Skipping Kun restart: the new settings resolve to no API key but the running runtime had one — leaving the healthy runtime in place.'
    )
    return
  }

  await waitForManagedRuntimeReadyBeforeStop(prev, 'settings-apply')
  await adapter.stopAndWait()
  if (!runtime.autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      message: 'Kun was stopped: auto-start is disabled.'
    })
    return
  }

  publishRuntimeStatus({ state: 'restarting', source: 'settings-apply' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(next, 'settings-apply')
    await adapter.ensureRunning(launchSettings)
    const healthy = await waitForKunHealth(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the settings change')
    }
    noteRuntimeHealthy('settings-apply')
    publishRuntimeStatus({ state: 'running', source: 'settings-apply' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('settings-apply', `Kun restart failed after settings change: ${message}`)
    await rollbackRuntimeSettingsAfterFailedApply(prev, message)
  }
}

/**
 * A settings change took the runtime down and the new config cannot
 * boot. Restore the previous runtime/provider settings on disk (so the
 * next app launch is not bricked either) and bring kun back up on the
 * last-known-good configuration.
 */
async function rollbackRuntimeSettingsAfterFailedApply(
  prev: AppSettingsV1,
  failureMessage: string
): Promise<void> {
  const adapter = kunRuntimeAdapter
  let base: AppSettingsV1 = prev
  try {
    base = await store.patch({
      agents: { kun: getKunRuntimeSettings(prev) },
      provider: prev.provider
    })
    lastAppliedSettings = base
  } catch (error) {
    logWarn('settings-apply', 'failed to restore previous runtime settings on disk', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
  if (!getKunRuntimeSettings(base).autoStart) {
    publishRuntimeStatus({
      state: 'stopped',
      source: 'settings-apply',
      rolledBack: true,
      message: `The new settings failed to apply (${failureMessage}); previous settings were restored but auto-start is unavailable.`
    })
    return
  }
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(base, 'settings-apply-rollback')
    await adapter.ensureRunning(launchSettings)
    const healthy = await waitForKunHealth(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('previous configuration did not become healthy')
    }
    noteRuntimeHealthy('settings-apply-rollback')
    publishRuntimeStatus({
      state: 'running',
      source: 'settings-apply',
      rolledBack: true,
      message: `The new settings failed to apply (${failureMessage}); Kun is running on the previous settings again.`
    })
  } catch (error) {
    publishRuntimeStatus({
      state: 'failed',
      source: 'settings-apply',
      rolledBack: true,
      message: `The new settings failed to apply (${failureMessage}) and restoring the previous settings also failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    })
  }
}

async function restartManagedRuntimeForMcpConfigChange(settings: AppSettingsV1): Promise<void> {
  // See restartManagedRuntimeForSettingsChange: never interrupt an in-flight
  // boot launch (#544 restart storm).
  await waitForKunStartupSettled()

  const runtime = resolveKunRuntimeSettings(settings)
  const adapter = kunRuntimeAdapter
  const wasRunning = adapter.isChildRunning()

  if (!wasRunning) return
  await waitForManagedRuntimeReadyBeforeStop(settings, 'mcp-config')
  await adapter.stopAndWait()
  if (!runtime.autoStart) return

  publishRuntimeStatus({ state: 'restarting', source: 'mcp-config' })
  try {
    const launchSettings = await resolveManagedKunLaunchSettings(settings, 'mcp-config')
    await adapter.ensureRunning(launchSettings)
    const healthy = await waitForKunHealth(launchSettings, 20_000)
    if (!healthy) {
      throw new Error('Kun did not become healthy after the MCP config change')
    }
    noteRuntimeHealthy('mcp-config')
    publishRuntimeStatus({ state: 'running', source: 'mcp-config' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logWarn('mcp-config', `Kun restart failed after MCP config change: ${message}`)
    publishRuntimeStatus({
      state: 'failed',
      source: 'mcp-config',
      message: `Kun failed to restart after the MCP config change: ${message}. Check the MCP config file, then retry.`
    })
  }
}

async function waitForManagedRuntimeReadyBeforeStop(
  settings: AppSettingsV1,
  source: string
): Promise<void> {
  const healthy = await waitForKunHealth(settings, 20_000)
  if (!healthy) {
    logWarn(source, 'Kun did not become healthy before a managed restart; stopping it anyway')
    return
  }
  const idle = await waitForRuntimeTurnsIdle({ settings })
  if (idle === 'timeout') {
    logWarn(source, 'Kun still has running turns after waiting; stopping it anyway')
  } else if (idle === 'unavailable') {
    logWarn(source, 'Could not verify Kun turn idleness before a managed restart; stopping it anyway')
  }
}

async function runtimeRequest(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    return await runtimeRequestViaHost(settings, pathAndQuery, init, ensureRuntime)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError('runtime-request', `HTTP request to ${pathAndQuery} failed`, { message })
    const parsed = parseRuntimeErrorBody(message, message)
    if (parsed.code !== 'unknown' || parsed.message !== message) {
      return runtimeFailure(parsed.code, parsed.message, 0, parsed.details)
    }
    return runtimeFailure('fetch_failed', message)
  }
}

if (runningClawScheduleMcpServer) {
  void runClawScheduleMcpServerFromArgv(process.argv).catch((error) => {
    console.error('[claw-schedule-mcp] server failed:', error)
    process.exit(1)
  })
} else {
app.whenReady().then(async () => {
  traceStartup('app.whenReady:start')
  if (!gotSingleInstanceLock) return

  traceStartup('install webview guards:start')
  installDevPreviewWebviewGuards()
  traceStartup('install webview guards:done')

  if (process.platform === 'darwin') {
    const macDockIcon = createAppIcon(claude360MacLogoPng)
    app.dock.setIcon(macDockIcon.isEmpty() ? appIcon : macDockIcon)
  }

  store = new JsonSettingsStore(app.getPath('userData'))
  traceStartup('settings load:start')
  const initial = await store.load()
  traceStartup('settings load:done')
  setKunUnexpectedExitHandler(handleUnexpectedKunExit)
  appBehavior = initial.appBehavior
  syncLoginItemSettings(initial)
  syncTray(initial)
  await syncClawScheduleMcpConfig(initial, getClawScheduleMcpLaunchConfig()).catch((error) => {
    console.error('[claw-schedule-mcp] failed to sync config on startup:', error)
  })

  logDir = resolveLogDirectory(app)
  configureLogger({
    dir: logDir,
    enabled: initial.log.enabled,
    retentionDays: initial.log.retentionDays
  })
  traceStartup('logger configured')
  syncCheckpointCleanupTimer(initial)
  scheduleRuntime = createScheduleRuntime({ store, runtimeRequest, logError, powerSaveBlocker })
  scheduleRuntime.sync(initial)
  workflowRuntime = createWorkflowRuntime({ store, runtimeRequest, logError, powerSaveBlocker })
  workflowRuntime.sync(initial)
  // Telegram runtime is created first so ClawRuntime can reference it via deps.
  // The onInbound callback closes over the module-level clawRuntime, which is
  // assigned on the next line — by the time an update arrives the reference is set.
  telegramRuntime = createTelegramRuntime({
    store,
    logError,
    onInbound: (payload) => clawRuntime?.handleTelegramUpdate(payload)
  })
  clawRuntime = createClawRuntime({
    store,
    runtimeRequest,
    logError,
    notifyChannelActivity: emitClawChannelActivity,
    sendWeixinBridgeMessage,
    resolveWeixinAccountUserId: getWeixinBridgeAccountUserId,
    telegramRuntime,
    createScheduledTaskFromText: (text, options) =>
      scheduleRuntime?.createScheduledTaskFromText(text, options) ?? Promise.resolve({ kind: 'noop' })
  })
  clawRuntime.sync(initial)
  // ClawRuntime.sync delegates Telegram reconciliation to telegramRuntime.sync,
  // so the long-poll loops start as part of the call above. The explicit sync
  // here is a no-op when settings are unchanged, kept for clarity.
  telegramRuntime.sync(initial)
  configureWeixinBridgeRuntimeContextProvider(async () => {
    const settings = await store.load()
    const channel = settings.claw.channels.find((item) => item.enabled && item.provider === 'weixin')
    return {
      webhookUrl: webhookUrl(settings),
      webhookSecret: settings.claw.im.secret,
      channelId: channel?.id ?? ''
    }
  })
  configureManagedWeixinBridgeUrlResolver(ensureWeixinBridgeRpcUrl)
  syncWeixinBridgeRuntime(initial)

  traceStartup('ipc registration:start')
  const applySettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    const prev = await store.load()
    const { agents: agentsPatch, provider: providerPatch, ...restPatch } = partial
    const next = normalizeAppSettings({
      ...applyKunRuntimePatch(prev, agentsPatch?.kun),
      ...restPatch,
      provider: mergeModelProviderSettings(prev.provider, providerPatch),
      log: { ...prev.log, ...(partial.log ?? {}) },
      checkpointCleanup: normalizeCheckpointCleanupSettings({
        ...prev.checkpointCleanup,
        ...(partial.checkpointCleanup ?? {})
      }),
      notifications: { ...prev.notifications, ...(partial.notifications ?? {}) },
      appBehavior: mergeAppBehaviorSettings(prev.appBehavior, partial.appBehavior),
      keyboardShortcuts: normalizeKeyboardShortcuts({
        bindings: {
          ...prev.keyboardShortcuts.bindings,
          ...(partial.keyboardShortcuts?.bindings ?? {})
        }
      }),
      write: mergeWriteSettings(prev.write, partial.write),
      claw: mergeClawSettings(prev.claw, partial.claw),
      schedule: mergeScheduleSettings(prev.schedule, partial.schedule),
      workflow: mergeWorkflowSettings(prev.workflow, partial.workflow),
      terminal: mergeTerminalSettings(prev.terminal, partial.terminal),
      claude360: mergeClaude360Settings(prev.claude360, partial.claude360),
      guiUpdate: { ...prev.guiUpdate, ...(partial.guiUpdate ?? {}) }
    })
    if (prev.log.enabled !== next.log.enabled || prev.log.retentionDays !== next.log.retentionDays) {
      configureLogger({ enabled: next.log.enabled, retentionDays: next.log.retentionDays })
    }
    const runtimeValidationError = validateRuntimeSettingsForApply(next)
    if (runtimeValidationError) {
      throw new Error(`Invalid runtime settings: ${runtimeValidationError}`)
    }
    const saved = await store.patch(partial)
    await syncClawScheduleMcpConfig(saved, getClawScheduleMcpLaunchConfig()).catch((error) => {
      console.error('[claw-schedule-mcp] failed to sync config after settings change:', error)
    })
    if (prev.guiUpdate.channel !== saved.guiUpdate.channel && guiUpdaterModulePromise) {
      void guiUpdaterModulePromise.then((module) => module.setGuiUpdateChannel(saved.guiUpdate.channel))
    }
    queueRuntimeSettingsApply(prev, saved)
    try {
      scheduleRuntime?.sync(saved)
      workflowRuntime?.sync(saved)
      clawRuntime?.sync(saved)
    } catch (error) {
      logError('settings-apply', 'failed to sync schedule/claw runtimes after settings change', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
    syncWeixinBridgeRuntime(saved)
    syncLoginItemSettings(saved)
    syncTray(saved)
    syncCheckpointCleanupTimer(saved)
    return saved
  }

  const fetchModels = async () => {
    const settings = await store.load()
    return fetchUpstreamModelIds(settings)
  }

  const saveSettingsPatch = async (partial: AppSettingsPatch): Promise<AppSettingsV1> => {
    return store.patch(partial)
  }

  // Claude360 服务层（plan-02/03）。共享 apiClient + 加密 secret store + settings 端口。
  // baseUrl 默认指向 claude360.xyz；第一阶段无修改入口（供应商配置隐藏）。
  const claude360ApiClient = new Claude360ApiClient({ baseUrl: DEFAULT_CLAUDE360_BASE_URL })
  const claude360SecretStore = createClaude360SecretStore({
    filePath: join(app.getPath('userData'), 'claude360-secrets.json'),
    safeStorage
  })
  // 让 kun 运行时（子进程，拿不到 secretStore）能在 spawn/写子进程 config 前，
  // 把 provider.apiKeyRef 解出真 Key 注入运行时。明文只在 main 侧解析，绝不落 settings。
  setClaude360KeyResolver((ref) => claude360SecretStore.loadSecret(ref))
  const readClaude360Settings = async (): Promise<Awaited<ReturnType<typeof store.load>>['claude360']> =>
    (await store.load()).claude360
  const writeClaude360Settings = async (patch: Parameters<typeof mergeClaude360Settings>[1]): Promise<void> => {
    await store.patch({ claude360: patch })
  }
  const claude360AuthService = new Claude360AuthService({
    apiClient: claude360ApiClient,
    secretStore: claude360SecretStore,
    readClaude360: readClaude360Settings,
    writeClaude360: writeClaude360Settings
  })
  const claude360TokenService = new Claude360TokenService({
    apiClient: claude360ApiClient,
    secretStore: claude360SecretStore,
    readClaude360: readClaude360Settings,
    writeClaude360: writeClaude360Settings
  })
  const claude360BillingService = new Claude360BillingService({
    apiClient: claude360ApiClient,
    secretStore: claude360SecretStore
  })
  const claude360ModelService = new Claude360ModelService({
    apiClient: claude360ApiClient,
    secretStore: claude360SecretStore
  })
  const claude360MusicService = new Claude360MusicService({
    apiClient: claude360ApiClient,
    secretStore: claude360SecretStore,
    readClaude360: readClaude360Settings,
    ensureGroupKey: async (group, purpose) => {
      const ref = await claude360TokenService.ensureGroupToken(group, purpose)
      return (await claude360SecretStore.loadSecret(claude360ApiKeyRef(ref.tokenId))) ?? ''
    }
  })
  const claude360CanvasService = new Claude360CanvasService({
    apiClient: claude360ApiClient,
    secretStore: claude360SecretStore,
    readClaude360: readClaude360Settings,
    ensureGroupKey: async (group, purpose) => {
      const ref = await claude360TokenService.ensureGroupToken(group, purpose)
      return (await claude360SecretStore.loadSecret(claude360ApiKeyRef(ref.tokenId))) ?? ''
    }
  })
  const claude360ChatService = new Claude360ChatService({
    readClaude360: readClaude360Settings,
    ensureGroupKey: async (group, purpose) => {
      const ref = await claude360TokenService.ensureGroupToken(group, purpose)
      return (await claude360SecretStore.loadSecret(claude360ApiKeyRef(ref.tokenId))) ?? ''
    }
  })

  registerAppIpcHandlers({
    store,
    getMainWindow: () => mainWindow,
    applySettingsPatch,
    saveSettingsPatch,
    runtimeRequest: async (path, method, body) => {
      const settings = await store.load()
      return runtimeRequest(settings, path, { method, body })
    },
    restartRuntime: async () => {
      const settings = await store.load()
      await restartRuntime(settings)
    },
    fetchUpstreamModels: fetchModels,
    getClawRuntime: () => clawRuntime,
    getScheduleRuntime: () => scheduleRuntime,
    getWorkflowRuntime: () => workflowRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    resolveKunConfigPath: resolveKunMcpJsonPath,
    onKunMcpConfigWritten: async () => {
      const settings = await store.load()
      queueRuntimeMcpConfigApply(settings)
    },
    showTurnCompleteNotification,
    getAppVersion: () => app.getVersion(),
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory: () => resolveLogDirectory(app),
    logError,
    claude360AuthService,
    claude360TokenService,
    claude360ModelService,
    claude360BillingService,
    claude360MusicService,
    claude360CanvasService
  })

  void loadGuiUpdaterModule().catch((error) => {
    console.warn('[kun-gui updater] failed to initialize on startup:', error)
  })

  registerRuntimeSseIpc({ ipcMain, store, ensureRuntime, logError })
  registerClaude360ChatStreamIpc({ ipcMain, chatService: claude360ChatService, logError })
  registerTerminalPtyIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    logError,
    getTerminalColorMode: async () => resolveTerminalColorMode(await store.load())
  })
  traceStartup('ipc registration:done')

  createWindow({ suppressInitialShow: shouldStartHidden(initial) })
  traceStartup('createWindow:returned')
  void loadGuiUpdaterModule()
    .then((module) => module.showPostUpdateReleaseNotes())
    .catch((error) => {
      console.warn('[kun-gui updater] failed to show post-update release notes:', error)
    })

  void pruneOnStartup().catch((err) => {
    console.warn('[kun-gui] prune logs:', err)
  })

  // 分组模式：无「全局默认 API Key」也预热运行时，让首次调用更快。
  // 先解析二进制路径，随后直接后台预启动 Kun 子进程（07-05 首次对话慢修复）：
  // 否则子进程 spawn + 最多 20s 的就绪等待会全部落在用户第一条消息上。
  // fire-and-forget：失败仅告警，首次真实请求仍会走 ensureRuntime 的正常报错路径。
  setTimeout(() => {
    void kunRuntimeAdapter
      .resolveExecutable(initial)
      .then(() => {
        console.info('[perf:runtime] prewarm:start')
        return ensureRuntime(initial).then(() => {
          console.info('[perf:runtime] prewarm:ready')
        })
      })
      .catch((err) => {
        console.warn('[kun-gui] prewarm Kun runtime:', err)
      })
  }, 1500)

  app.on('second-instance', () => {
    revealMainWindow()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else revealMainWindow()
  })
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[kun-gui] startup failed:', error)
  dialog.showErrorBox(`${APP_PRODUCT_NAME} failed to start`, message)
  app.quit()
})
}

app.on('window-all-closed', () => {
  void stopManagedRuntimes().catch((error) => {
    console.warn('[kun-gui] failed to stop Kun runtime:', error)
  })
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  isQuitting = true
  stopRuntimeWatchdog()
  stopCheckpointCleanupTimer()
  if (managedRuntimesStoppedForQuit) return
  event.preventDefault()
  void stopManagedRuntimesForQuit()
    .catch((error) => {
      console.warn('[kun-gui] failed to stop Kun runtime:', error)
      managedRuntimesStoppedForQuit = true
    })
    .finally(() => {
      app.quit()
    })
})
