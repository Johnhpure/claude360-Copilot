import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  KunGuiApi,
  WindowMaterialAppliedPayload,
  WindowMaximizedChangedPayload,
  WorkspaceOpenRequestPayload
} from '../shared/kun-gui-api'
import { createReplayedChannelSubscriber } from '../shared/replayed-ipc-channel'

// 07-14-perf-baseline：R4 preload 初始化耗时。模块求值首/末各记一次 epoch ms，
// 随 renderer 启动标记上报 main 换算到统一时间轴（本文件无异步初始化，预期 ~0-5ms）。
const preloadStartedAtEpochMs = Date.now()

// The preload runs sandboxed (webPreferences.sandbox = true), so it cannot
// require node built-ins like node:os. The home dir is passed in from the main
// process via additionalArguments and read off process.argv instead.
const HOME_DIR_ARG = '--kun-home-dir='
const homeDirFromArgs =
  process.argv.find((arg) => arg.startsWith(HOME_DIR_ARG))?.slice(HOME_DIR_ARG.length) ?? ''

// —— Windows 原生体验（07-14-windows-native-polish）——
// main 的这三条推送会在页面加载早期发出（冷启动 workspace:open-request 与
// window:material-applied 在 did-finish-load，恢复最大化的 maximized-changed 在
// ready-to-show 附近），而 renderer 的订阅要等 React mount + boot() 的多个 await
// 之后才注册——先发后订必丢事件。preload 求值先于页面加载，这里在求值期就挂
// 常驻缓存监听，订阅时重放最近载荷（状态通道 'latest'，命令通道 'once'）。
const subscribeWindowMaximizedChanged =
  createReplayedChannelSubscriber<WindowMaximizedChangedPayload>(
    ipcRenderer,
    'window:maximized-changed',
    'latest'
  )
const subscribeWorkspaceOpenRequest = createReplayedChannelSubscriber<WorkspaceOpenRequestPayload>(
  ipcRenderer,
  'workspace:open-request',
  'once'
)
const subscribeWindowMaterialApplied =
  createReplayedChannelSubscriber<WindowMaterialAppliedPayload>(
    ipcRenderer,
    'window:material-applied',
    'latest'
  )

const api = {
  platform: process.platform,
  homeDir: homeDirFromArgs,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  claudeSubscriptionStatus: () => ipcRenderer.invoke('claude-subscription:status'),
  claudeSubscriptionLogin: () => ipcRenderer.invoke('claude-subscription:login'),
  claudeSubscriptionModels: (token) => ipcRenderer.invoke('claude-subscription:models', token),
  claudeSubscriptionSdkStatus: () => ipcRenderer.invoke('claude-subscription:sdk-status'),
  claudeSubscriptionSdkInstall: () => ipcRenderer.invoke('claude-subscription:sdk-install'),
  onClaudeSubscriptionSdkProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claude-subscription:sdk-progress', wrapped)
    return () => ipcRenderer.removeListener('claude-subscription:sdk-progress', wrapped)
  },
  setSettings: (partial) =>
    ipcRenderer.invoke('settings:set', partial),
  saveSettingsSilent: (partial) =>
    ipcRenderer.invoke('settings:save-silent', partial),
  runtimeRequest: (path, method, body) =>
    ipcRenderer.invoke('runtime:request', { path, method, body }),
  restartRuntime: () => ipcRenderer.invoke('runtime:restart'),
  fetchUpstreamModels: () => ipcRenderer.invoke('upstream:models'),
  getClawStatus: () => ipcRenderer.invoke('claw:status'),
  runClawTask: (taskId) =>
    ipcRenderer.invoke('claw:task:run', taskId),
  getScheduleStatus: () => ipcRenderer.invoke('schedule:status'),
  runScheduleTask: (taskId) =>
    ipcRenderer.invoke('schedule:task:run', taskId),
  getWorkflowStatus: () => ipcRenderer.invoke('workflow:status'),
  runWorkflow: (workflowId, input) => ipcRenderer.invoke('workflow:run', workflowId, input),
  stopWorkflow: (workflowId) => ipcRenderer.invoke('workflow:stop', workflowId),
  runWorkflowNode: (workflowId, nodeId) =>
    ipcRenderer.invoke('workflow:node:run', { workflowId, nodeId }),
  testWorkflowNode: (workflowId, nodeId, mockJson) =>
    ipcRenderer.invoke('workflow:node:test', { workflowId, nodeId, mockJson }),
  resolveWorkflowApproval: (token, decision) =>
    ipcRenderer.invoke('workflow:approval:resolve', { token, decision }),
  checkWorkflowCode: (language, code) => ipcRenderer.invoke('workflow:code:check', { language, code }),
  startClawImInstallQr: (provider, options) =>
    ipcRenderer.invoke('claw:im-install:qrcode', { provider, isLark: options?.isLark }),
  pollClawImInstall: (provider, deviceCode) =>
    ipcRenderer.invoke('claw:im-install:poll', { provider, deviceCode }),
  connectTelegramBot: (botToken, allowedChatIds) =>
    ipcRenderer.invoke('claw:im-install:telegram-token', { botToken, allowedChatIds }),
  pickWorkspaceDirectory: (defaultPath) =>
    ipcRenderer.invoke('workspace:pick-directory', defaultPath),
  pickLocalFiles: (defaultPath) =>
    ipcRenderer.invoke('file:pick-local-files', defaultPath),
  createConversationWorkspace: (root) =>
    ipcRenderer.invoke('conversation:create-workspace', { root }),
  confirmDialog: (options) =>
    ipcRenderer.invoke('dialog:confirm', options),
  detectLegacySessions: () =>
    ipcRenderer.invoke('kun:sessions:detect-legacy'),
  importLegacySessions: (sourceDir) =>
    ipcRenderer.invoke('kun:sessions:import-legacy', { sourceDir }),
  pickLegacySessionDir: () =>
    ipcRenderer.invoke('kun:sessions:pick-source-dir'),
  listSkills: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list', { workspaceRoot }),
  listSkillRoots: (workspaceRoot) =>
    ipcRenderer.invoke('skill:list-roots', { workspaceRoot }),
  saveSkillFile: (rootPath, skillName, content, manifestContent) =>
    ipcRenderer.invoke('skill:save-file', { rootPath, skillName, content, manifestContent }),
  importSkillsFromGitHub: (rootPath, url) =>
    ipcRenderer.invoke('skill:import-github', { rootPath, url }),
  openSkillRoot: (rootPath) =>
    ipcRenderer.invoke('skill:open-root', rootPath),
  claude360Session: () => ipcRenderer.invoke('claude360:session'),
  claude360StartDeviceAuth: () => ipcRenderer.invoke('claude360:auth:start-device'),
  claude360PollDeviceAuth: (deviceCode) =>
    ipcRenderer.invoke('claude360:auth:poll-device', { deviceCode }),
  claude360PasswordLogin: (payload) =>
    ipcRenderer.invoke('claude360:auth:password-login', payload),
  claude360PasswordLogin2FA: (payload) =>
    ipcRenderer.invoke('claude360:auth:password-login-2fa', payload),
  claude360Logout: () => ipcRenderer.invoke('claude360:auth:logout'),
  claude360SyncAccount: () => ipcRenderer.invoke('claude360:sync-account'),
  claude360TokensList: () => ipcRenderer.invoke('claude360:tokens:list'),
  claude360TokensEnsure: (payload) => ipcRenderer.invoke('claude360:tokens:ensure', payload),
  claude360TokensCreate: (payload) => ipcRenderer.invoke('claude360:tokens:create', payload),
  claude360TokensReveal: (payload) => ipcRenderer.invoke('claude360:tokens:reveal', payload),
  claude360TokensDelete: (payload) => ipcRenderer.invoke('claude360:tokens:delete', payload),
  claude360GroupsList: () => ipcRenderer.invoke('claude360:groups:list'),
  claude360ModelsByGroup: (payload) => ipcRenderer.invoke('claude360:models:by-group', payload),
  claude360ModelsRefresh: () => ipcRenderer.invoke('claude360:models:refresh'),
  claude360ModelsList: () => ipcRenderer.invoke('claude360:models:list'),
  claude360BillingMe: () => ipcRenderer.invoke('claude360:billing:me'),
  claude360BillingTopupOptions: () => ipcRenderer.invoke('claude360:billing:topup-options'),
  claude360BillingTopupWechat: (payload) => ipcRenderer.invoke('claude360:billing:topup-wechat', payload),
  claude360BillingTopupOrder: (payload) => ipcRenderer.invoke('claude360:billing:topup-order', payload),
  claude360BillingTokenStats: (payload) => ipcRenderer.invoke('claude360:billing:token-stats', payload),
  claude360MusicSubmit: (payload) => ipcRenderer.invoke('claude360:music:submit', payload),
  claude360MusicFetch: (taskId) => ipcRenderer.invoke('claude360:music:fetch', { taskId }),
  claude360MusicMediaBlob: (url) => ipcRenderer.invoke('claude360:music:media-blob', { url }),
  claude360MusicMediaProbe: (url) => ipcRenderer.invoke('claude360:music:media-probe', { url }),
  claude360CanvasGenerate: (payload) => ipcRenderer.invoke('claude360:canvas:generate', payload),
  claude360CanvasEdit: (payload) => ipcRenderer.invoke('claude360:canvas:edit', payload),
  mediaAssetsSaveImage: (payload) => ipcRenderer.invoke('media:assets:save-image', payload),
  mediaAssetsSaveMusic: (payload) => ipcRenderer.invoke('media:assets:save-music', payload),
  mediaAssetsList: (payload) => ipcRenderer.invoke('media:assets:list', payload),
  mediaAssetsReadBlob: (payload) => ipcRenderer.invoke('media:assets:read-blob', payload),
  mediaAssetsDelete: (payload) => ipcRenderer.invoke('media:assets:delete', payload),
  getKunConfigFile: () =>
    ipcRenderer.invoke('kun:config:read'),
  setKunConfigFile: (content) =>
    ipcRenderer.invoke('kun:config:write', content),
  openKunConfigDir: () =>
    ipcRenderer.invoke('kun:config:open-dir'),
  getGitBranches: (workspaceRoot) =>
    ipcRenderer.invoke('git:branches', workspaceRoot),
  switchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:switch-branch', { workspaceRoot, branch }),
  createAndSwitchGitBranch: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:create-and-switch-branch', { workspaceRoot, branch }),
  createGitCheckpoint: (payload) =>
    ipcRenderer.invoke('git:checkpoint:create', payload),
  restoreGitCheckpoint: (payload) =>
    ipcRenderer.invoke('git:checkpoint:restore', payload),
  checkoutGitBranchWorktree: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:checkout-branch-worktree', { workspaceRoot, branch }),
  createGitBranchWorktree: (workspaceRoot, branch) =>
    ipcRenderer.invoke('git:create-branch-worktree', { workspaceRoot, branch }),
  listGitBranchWorktrees: (params) =>
    ipcRenderer.invoke('git:branch-worktrees', params),
  removeGitBranchWorktree: (params) =>
    ipcRenderer.invoke('git:remove-branch-worktree', params),
  acquireWorktree: (params) =>
    ipcRenderer.invoke('worktree:acquire', params),
  releaseWorktree: (params) =>
    ipcRenderer.invoke('worktree:release', params),
  listWorktrees: (params) =>
    ipcRenderer.invoke('worktree:list', params),
  removeWorktree: (params) =>
    ipcRenderer.invoke('worktree:remove', params),
  getWorktreeChanges: (params) =>
    ipcRenderer.invoke('worktree:changes', params),
  commitWorktree: (params) =>
    ipcRenderer.invoke('worktree:commit', params),
  mergeWorktree: (params) =>
    ipcRenderer.invoke('worktree:merge', params),
  abortWorktreeMerge: (params) =>
    ipcRenderer.invoke('worktree:abort-merge', params),
  continueWorktreeMerge: (params) =>
    ipcRenderer.invoke('worktree:continue-merge', params),
  syncWorktreeFromMain: (params) =>
    ipcRenderer.invoke('worktree:sync', params),
  abortWorktreeRebase: (params) =>
    ipcRenderer.invoke('worktree:abort-rebase', params),
  cleanupWorktrees: (params) =>
    ipcRenderer.invoke('worktree:cleanup', params),
  findAvailableWorktreePoolIndex: (params) =>
    ipcRenderer.invoke('worktree:find-available', params),
  listEditors: () => ipcRenderer.invoke('editor:list'),
  openEditorPath: (options) =>
    ipcRenderer.invoke('editor:open-path', options),
  listWorkspaceDirectory: (options) =>
    ipcRenderer.invoke('file:list-workspace-directory', options),
  resolveWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:resolve-workspace', options),
  readWorkspaceFile: (options) =>
    ipcRenderer.invoke('file:read-workspace', options),
  readWorkspaceImage: (options) =>
    ipcRenderer.invoke('file:read-workspace-image', options),
  readWorkspacePdf: (options) =>
    ipcRenderer.invoke('file:read-workspace-pdf', options),
  readLocalPdfText: (options) =>
    ipcRenderer.invoke('file:read-local-pdf-text', options),
  saveWorkspaceFileAs: (payload) =>
    ipcRenderer.invoke('file:save-as', payload),
  writeWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:write-workspace', payload),
  createWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:create-workspace', payload),
  createWorkspaceDirectory: (payload) =>
    ipcRenderer.invoke('file:create-workspace-directory', payload),
  saveWorkspaceClipboardImage: (payload) =>
    ipcRenderer.invoke('file:save-workspace-clipboard-image', payload),
  readClipboardImage: () =>
    ipcRenderer.invoke('clipboard:read-image'),
  getPathForFile: (file) =>
    webUtils.getPathForFile(file),
  renameWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:rename-workspace-entry', payload),
  deleteWorkspaceEntry: (payload) =>
    ipcRenderer.invoke('file:delete-workspace-entry', payload),
  watchWorkspaceFile: (payload) =>
    ipcRenderer.invoke('file:watch-workspace', payload),
  unwatchWorkspaceFile: (watchId) =>
    ipcRenderer.invoke('file:unwatch-workspace', watchId),
  onWorkspaceFileChanged: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('file:workspace-changed', wrapped)
    return () => ipcRenderer.removeListener('file:workspace-changed', wrapped)
  },
  exportWriteDocument: (payload) =>
    ipcRenderer.invoke('write:export', payload),
  copyWriteDocumentAsRichText: (payload) =>
    ipcRenderer.invoke('write:copy-rich-text', payload),
  requestWriteInlineCompletion: (payload) =>
    ipcRenderer.invoke('write:inline-completion', payload),
  retrieveWriteContext: (payload) =>
    ipcRenderer.invoke('write:retrieve-context', payload),
  generateWriteInfographic: (payload) =>
    ipcRenderer.invoke('write:generate-infographic', payload),
  authorizeWritePrototype: (payload) =>
    ipcRenderer.invoke('write:authorize-prototype', payload),
  openWritePrototype: (payload) =>
    ipcRenderer.invoke('write:open-prototype', payload),
  transcribeSpeech: (payload) =>
    ipcRenderer.invoke('speech:transcribe', payload),
  getLocalWhisperModelStatus: (modelId) =>
    ipcRenderer.invoke('speech:local-whisper:status', modelId),
  downloadLocalWhisperModel: (payload) =>
    ipcRenderer.invoke('speech:local-whisper:download', payload),
  cancelLocalWhisperModel: (modelId) =>
    ipcRenderer.invoke('speech:local-whisper:cancel', modelId),
  checkLocalWhisperDownloadSources: (payload) =>
    ipcRenderer.invoke('speech:local-whisper:sources', payload),
  deleteLocalWhisperModel: (modelId) =>
    ipcRenderer.invoke('speech:local-whisper:delete', modelId),
  onLocalWhisperModelProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('speech:local-whisper:progress', wrapped)
    return () => ipcRenderer.removeListener('speech:local-whisper:progress', wrapped)
  },
  listWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:list'),
  clearWriteInlineCompletionDebugEntries: () =>
    ipcRenderer.invoke('write:inline-completion-debug:clear'),
  startSse: (threadId, sinceSeq, streamId) =>
    ipcRenderer.invoke('runtime:sse:start', { threadId, sinceSeq, streamId }),
  stopSse: (streamId) => ipcRenderer.invoke('runtime:sse:stop', streamId),
  onSseEvent: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:sse-event', wrapped)
    return () => ipcRenderer.removeListener('runtime:sse-event', wrapped)
  },
  onSseEnd: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:sse-end', wrapped)
    return () => ipcRenderer.removeListener('runtime:sse-end', wrapped)
  },
  onSseError: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:sse-error', wrapped)
    return () => ipcRenderer.removeListener('runtime:sse-error', wrapped)
  },
  claude360ChatStreamStart: (payload) => ipcRenderer.invoke('claude360:chat:stream-start', payload),
  claude360ChatStreamStop: (streamId) => ipcRenderer.invoke('claude360:chat:stream-stop', streamId),
  onClaude360ChatDelta: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claude360:chat:delta', wrapped)
    return () => ipcRenderer.removeListener('claude360:chat:delta', wrapped)
  },
  onClaude360ChatEnd: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claude360:chat:end', wrapped)
    return () => ipcRenderer.removeListener('claude360:chat:end', wrapped)
  },
  onClaude360ChatError: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claude360:chat:error', wrapped)
    return () => ipcRenderer.removeListener('claude360:chat:error', wrapped)
  },
  onClawChannelActivity: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claw:channel-activity', wrapped)
    return () => ipcRenderer.removeListener('claw:channel-activity', wrapped)
  },
  onTrayAction: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('tray:action', wrapped)
    return () => ipcRenderer.removeListener('tray:action', wrapped)
  },
  onRuntimeStatus: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('runtime:status', wrapped)
    return () => ipcRenderer.removeListener('runtime:status', wrapped)
  },
  mirrorClawChannelMessage: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror', { threadId, text, direction }),
  mirrorClawChannelMessageToFeishu: (threadId, text, direction) =>
    ipcRenderer.invoke('claw:channel:mirror-to-feishu', { threadId, text, direction }),
  createClawTaskFromText: (text, options) =>
    ipcRenderer.invoke('claw:task:create-from-text', {
      text,
      channelId: options?.channelId,
      providerId: options?.providerId,
      modelHint: options?.modelHint,
      reasoningEffort: options?.reasoningEffort,
      mode: options?.mode
    }),
  createScheduleTaskFromText: (text, options) =>
    ipcRenderer.invoke('schedule:task:create-from-text', {
      text,
      workspaceRoot: options?.workspaceRoot,
      clawChannelId: options?.clawChannelId,
      providerId: options?.providerId,
      modelHint: options?.modelHint,
      reasoningEffort: options?.reasoningEffort,
      mode: options?.mode
    }),
  runDesktopCommand: (command) =>
    ipcRenderer.invoke('desktop:command', command),
  reportRecentWorkspaces: (workspaceRoots) => {
    ipcRenderer.send('workspace:report-recent', { workspaceRoots })
  },
  onWindowMaximizedChanged: (handler) => subscribeWindowMaximizedChanged(handler),
  onThreadNavigateRequest: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('thread:navigate-request', wrapped)
    return () => ipcRenderer.removeListener('thread:navigate-request', wrapped)
  },
  onWorkspaceOpenRequest: (handler) => subscribeWorkspaceOpenRequest(handler),
  onWindowMaterialApplied: (handler) => subscribeWindowMaterialApplied(handler),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  getComputerUsePermissions: () => ipcRenderer.invoke('computer-use:permissions'),
  requestComputerUsePermission: (kind) =>
    ipcRenderer.invoke('computer-use:request-permission', kind),
  showTurnCompleteNotification: (payload) => ipcRenderer.invoke('notification:turn-complete', payload),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getGuiUpdateState: () => ipcRenderer.invoke('gui:update-state'),
  getDismissedGuiUpdateVersion: () =>
    ipcRenderer.invoke('gui:update-dismissed-version'),
  checkGuiUpdate: (channel) =>
    ipcRenderer.invoke('gui:update-check', channel),
  downloadGuiUpdate: (channel) =>
    ipcRenderer.invoke('gui:update-download', channel),
  installGuiUpdate: () => ipcRenderer.invoke('gui:update-install'),
  dismissGuiUpdateVersion: (version) =>
    ipcRenderer.invoke('gui:update-dismiss', { version }),
  onGuiUpdateState: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('gui:update-state', wrapped)
    return () => ipcRenderer.removeListener('gui:update-state', wrapped)
  },
  logError: (category, message, detail) =>
    ipcRenderer.invoke('log:error', { category, message, detail }),
  getLogPath: () => ipcRenderer.invoke('log:get-path'),
  openLogDir: () => ipcRenderer.invoke('log:open-dir'),
  perfPreloadTimestamps: { startedAtEpochMs: preloadStartedAtEpochMs, readyAtEpochMs: 0 },
  reportPerfMarks: (payload) => {
    ipcRenderer.send('perf:renderer-marks', payload)
  },
  createTerminal: (payload) => ipcRenderer.invoke('terminal:create', payload),
  writeToTerminal: (payload) => ipcRenderer.invoke('terminal:write', payload),
  resizeTerminal: (payload) => ipcRenderer.invoke('terminal:resize', payload),
  disposeTerminal: (sessionId) => ipcRenderer.invoke('terminal:dispose', sessionId),
  onTerminalData: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('terminal:data', wrapped)
    return () => ipcRenderer.removeListener('terminal:data', wrapped)
  },
  onTerminalExit: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('terminal:exit', wrapped)
    return () => ipcRenderer.removeListener('terminal:exit', wrapped)
  }
} satisfies KunGuiApi

// preload 模块求值结束时刻：contextBridge 在 expose 时结构化克隆 api，
// 必须在 expose 之前回填，renderer 侧才能读到真实值。
api.perfPreloadTimestamps.readyAtEpochMs = Date.now()

contextBridge.exposeInMainWorld('kunGui', api)
