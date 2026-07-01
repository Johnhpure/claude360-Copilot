# Copilot Claude360 Account Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划不包含 git 提交步骤；每个任务完成后运行验证，提交仅在用户明确要求后执行。

**Goal:** 在 Claude360 Copilot 客户端中建立统一账号态、密钥态、登录弹窗和 Claude360 main 进程服务层。

**Architecture:** 新增 Claude360 settings 契约和 main service，敏感凭据只在 main 进程加密保存，renderer 通过 typed IPC 调用登录、登出、同步、session 查询。首次配置弹窗由 API Key 配置改为 Claude360 登录，保留网页授权登录并新增用户名密码登录。

**Tech Stack:** Electron main/preload、React、TypeScript、Zod、Vitest、Electron `safeStorage`、newapi `/api/cli/*`。

---

## File Structure

- Create: `claude360-Copilot/src/shared/claude360.ts`
  - Claude360 API response、session、account、token ref、group、model、topup、错误码类型。

- Create: `claude360-Copilot/src/shared/app-settings-claude360.ts`
  - `defaultClaude360Settings()`、`mergeClaude360Settings()`、normalize helpers。

- Modify: `claude360-Copilot/src/shared/app-settings-types.ts`
  - 增加 `Claude360SettingsV1` 到 `AppSettingsV1`。
  - 增加 `claude360?: Claude360SettingsPatchV1` 到 `AppSettingsPatch`。

- Modify: `claude360-Copilot/src/shared/app-settings.ts`
  - 导出 `app-settings-claude360`。

- Modify: `claude360-Copilot/src/shared/app-settings-normalize.ts`
  - normalize 时补齐 `claude360` 默认值。

- Modify: `claude360-Copilot/src/main/settings-store.ts`
  - 默认 settings 加入 `claude360: defaultClaude360Settings()`。

- Create: `claude360-Copilot/src/main/services/claude360-secret-store.ts`
  - 基于 `safeStorage` 加密保存 `cli_token` 和 API Key 明文。

- Create: `claude360-Copilot/src/main/services/claude360-api-client.ts`
  - 封装 Claude360 HTTP 请求、envelope 解析、Authorization、错误脱敏。

- Create: `claude360-Copilot/src/main/services/claude360-auth-service.ts`
  - 设备授权、password 登录、2FA、session 恢复、登出。

- Modify: `claude360-Copilot/src/main/ipc/app-ipc-schemas.ts`
  - 增加 Claude360 IPC payload zod schema。

- Modify: `claude360-Copilot/src/main/ipc/register-app-ipc-handlers.ts`
  - 注册 `claude360:*` IPC handlers。

- Modify: `claude360-Copilot/src/shared/kun-gui-api.ts`
  - 增加 typed `KunGuiApi` 方法。

- Modify: `claude360-Copilot/src/preload/index.ts`
  - 暴露 `claude360Session`、`claude360PasswordLogin` 等 IPC 方法。

- Modify: `claude360-Copilot/src/renderer/src/components/InitialSetupDialog.tsx`
  - 替换首次 API Key 配置为 Claude360 登录。

- Modify: `claude360-Copilot/src/renderer/src/components/InitialSetupDialog.test.ts`
  - 更新登录弹窗渲染、password 登录、网页授权轮询测试。

- Modify: `claude360-Copilot/src/renderer/src/AppShell.tsx`
  - 首次打开逻辑改为 Claude360 session 判断。

- Modify: `claude360-Copilot/src/renderer/src/components/initial-setup-save.ts`
  - 停用旧 API Key 初始保存流程或改为 Claude360 登录成功后的兼容入口。

- Create tests:
  - `claude360-Copilot/src/shared/app-settings-claude360.test.ts`
  - `claude360-Copilot/src/main/services/claude360-secret-store.test.ts`
  - `claude360-Copilot/src/main/services/claude360-api-client.test.ts`
  - `claude360-Copilot/src/main/services/claude360-auth-service.test.ts`

## Settings Contract

新增 settings 块：

```ts
export type Claude360SettingsV1 = {
  baseUrl: string
  loggedIn: boolean
  username: string
  displayName: string
  defaultGroup: string
  selectedTextGroup: string
  selectedImageGroup: string
  selectedMusicGroup: string
  cliTokenRef: string
  tokenRefs: Record<string, Claude360TokenRef>
  modelCache: Claude360ModelCache
  lastSyncAt: string
}
```

默认值：

```ts
export const DEFAULT_CLAUDE360_BASE_URL = 'https://claude360.xyz'

export function defaultClaude360Settings(): Claude360SettingsV1 {
  return {
    baseUrl: DEFAULT_CLAUDE360_BASE_URL,
    loggedIn: false,
    username: '',
    displayName: '',
    defaultGroup: 'auto',
    selectedTextGroup: 'auto',
    selectedImageGroup: '',
    selectedMusicGroup: '',
    cliTokenRef: '',
    tokenRefs: {},
    modelCache: { groups: [], models: [] },
    lastSyncAt: ''
  }
}
```

## IPC Contract

在 `window.kunGui` 上新增：

```ts
claude360Session(): Promise<Claude360SessionResult>
claude360StartDeviceAuth(): Promise<Claude360DeviceAuthStartResult>
claude360PollDeviceAuth(deviceCode: string): Promise<Claude360DeviceAuthPollResult>
claude360PasswordLogin(payload: Claude360PasswordLoginPayload): Promise<Claude360LoginResult>
claude360PasswordLogin2FA(payload: Claude360PasswordLogin2FAPayload): Promise<Claude360LoginResult>
claude360Logout(): Promise<Claude360LogoutResult>
claude360SyncAccount(): Promise<Claude360SyncResult>
```

Renderer 不接收 `cli_token` 明文；登录成功只返回展示用 session，明文由 main 进程保存。

## Task 1: Settings 类型和默认值

**Files:**

- Create: `src/shared/app-settings-claude360.ts`
- Modify: `src/shared/app-settings-types.ts`
- Modify: `src/shared/app-settings.ts`
- Modify: `src/shared/app-settings-normalize.ts`
- Modify: `src/main/settings-store.ts`
- Test: `src/shared/app-settings-claude360.test.ts`
- Test: `src/shared/app-settings.test.ts`

- [x] **Step 1: 写 settings 默认值测试**

断言：

- `defaultClaude360Settings().baseUrl === 'https://claude360.xyz'`。
- `loggedIn` 默认 false。
- 不存在 `cli_token` 或 API Key 明文字段。

- [x] **Step 2: 写 settings normalize 测试**

断言旧 settings 缺少 `claude360` 时，`normalizeAppSettings` 自动补齐默认块。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/shared/app-settings-claude360.test.ts src/shared/app-settings.test.ts
```

Expected: FAIL，模块或字段不存在。

- [x] **Step 4: 实现 settings 类型和默认值**

新增 `app-settings-claude360.ts`，并在 `AppSettingsV1`、`AppSettingsPatch`、`defaultSettings()`、normalize 流程中接入。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/shared/app-settings-claude360.test.ts src/shared/app-settings.test.ts
```

Expected: PASS。

## Task 2: Secret store

**Files:**

- Create: `src/main/services/claude360-secret-store.ts`
- Test: `src/main/services/claude360-secret-store.test.ts`

- [x] **Step 1: 写加密存储测试**

覆盖：

- `saveSecret('cli-token', 'abc')` 后 `loadSecret` 返回 `abc`。
- 文件内容或 store 内容不包含 `abc` 明文。
- `deleteSecret` 后读取返回 null。
- `safeStorage.isEncryptionAvailable()` 不可用时，使用明确 fallback，并在测试中标记安全降级行为。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-secret-store.test.ts
```

Expected: FAIL，service 不存在。

- [x] **Step 3: 实现 `Claude360SecretStore`**

接口：

```ts
export type Claude360SecretStore = {
  saveSecret(ref: string, value: string): Promise<void>
  loadSecret(ref: string): Promise<string | null>
  deleteSecret(ref: string): Promise<void>
  clearClaude360Secrets(): Promise<void>
}
```

实现要求：

- ref 使用稳定前缀：`claude360:cli-token`、`claude360:api-key:<tokenId>`。
- 日志不得输出明文。
- fallback 必须集中封装，后续可替换系统 keychain。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-secret-store.test.ts
```

Expected: PASS。

## Task 3: Claude360 API client

**Files:**

- Create: `src/shared/claude360.ts`
- Create: `src/main/services/claude360-api-client.ts`
- Test: `src/main/services/claude360-api-client.test.ts`

- [x] **Step 1: 写 envelope 解析测试**

覆盖：

- `{ success: true, data }` 返回 data。
- `{ success: false, message }` 转换为 typed error。
- HTTP 401/500 返回可展示错误。
- error 对象脱敏 Authorization、password、token、key。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-api-client.test.ts
```

Expected: FAIL。

- [x] **Step 3: 实现 API client**

接口：

```ts
export class Claude360ApiClient {
  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch })
  get<T>(path: string, token?: string): Promise<T>
  post<T>(path: string, body?: unknown, token?: string): Promise<T>
}
```

要求：

- baseUrl 去除尾部 `/`。
- 默认使用 JSON。
- Authorization 格式为 `Bearer <token>`。
- 不在错误信息中拼接敏感 header/body。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-api-client.test.ts
```

Expected: PASS。

## Task 4: Auth service

**Files:**

- Create: `src/main/services/claude360-auth-service.ts`
- Test: `src/main/services/claude360-auth-service.test.ts`
- Reference: `newapi/controller/cli.go`

- [x] **Step 1: 写 password 登录测试**

Mock API:

- `POST /api/cli/auth/password` 返回 `cli_token`。
- `GET /api/cli/me` 返回用户信息。

断言：

- service 保存 `cli_token` 到 secret store。
- settings 中 `loggedIn=true`，`username/displayName` 更新。
- 返回 renderer 的 result 不包含 `cli_token`。

- [x] **Step 2: 写 2FA 流程测试**

Mock API:

- password login 返回 `require_2fa=true` 和 `challenge_id`。
- `passwordLogin2FA` 返回 `cli_token`。

断言：

- 第一步不写 `loggedIn=true`。
- 第二步成功后才保存 session。

- [x] **Step 3: 写网页授权轮询测试**

Mock API:

- `auth/start` 返回 device code。
- `auth/poll` pending/approved。

断言：

- approved 后保存 token。
- expired/denied/consumed 有明确状态。

- [x] **Step 4: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-auth-service.test.ts
```

Expected: FAIL。

- [x] **Step 5: 实现 auth service**

接口：

```ts
export class Claude360AuthService {
  getSession(): Promise<Claude360SessionResult>
  startDeviceAuth(): Promise<Claude360DeviceAuthStartResult>
  pollDeviceAuth(deviceCode: string): Promise<Claude360DeviceAuthPollResult>
  passwordLogin(input: Claude360PasswordLoginPayload): Promise<Claude360LoginResult>
  passwordLogin2FA(input: Claude360PasswordLogin2FAPayload): Promise<Claude360LoginResult>
  logout(): Promise<Claude360LogoutResult>
  syncAccount(): Promise<Claude360SyncResult>
}
```

- [x] **Step 6: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-auth-service.test.ts
```

Expected: PASS。

## Task 5: IPC schema、handler、preload

**Files:**

- Modify: `src/main/ipc/app-ipc-schemas.ts`
- Modify: `src/main/ipc/app-ipc-schemas.test.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.test.ts`
- Modify: `src/shared/kun-gui-api.ts`
- Modify: `src/preload/index.ts`

- [x] **Step 1: 写 schema 测试**

覆盖：

- password login payload 必须包含 username/password。
- 2FA payload 必须包含 challengeId/code。
- deviceCode 不能为空。
- payload 中多余字段不应被传到 service。

- [x] **Step 2: 写 IPC handler 测试**

Mock `Claude360AuthService`，断言：

- `claude360:session` 调用 `getSession`。
- `claude360:password-login` 调用 `passwordLogin`。
- service 错误转换为 `{ ok: false, message }`。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
```

Expected: FAIL。

- [x] **Step 4: 注册 IPC**

新增 channels：

- `claude360:session`
- `claude360:auth:start-device`
- `claude360:auth:poll-device`
- `claude360:auth:password-login`
- `claude360:auth:password-login-2fa`
- `claude360:auth:logout`
- `claude360:sync-account`

- [x] **Step 5: 扩展 preload 和 shared API 类型**

在 `src/preload/index.ts` 中新增对应 `ipcRenderer.invoke` 方法，并在 `KunGuiApi` 声明中补齐类型。

- [x] **Step 6: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
npm run typecheck
```

Expected: PASS。

## Task 6: 登录弹窗替换首次配置

**Files:**

- Modify: `src/renderer/src/components/InitialSetupDialog.tsx`
- Modify: `src/renderer/src/components/InitialSetupDialog.test.ts`
- Modify: `src/renderer/src/components/initial-setup-save.ts`
- Modify: `src/renderer/src/components/initial-setup-save.test.ts`
- Modify: `src/renderer/src/AppShell.tsx`
- Modify: `src/renderer/src/AppShell.test.ts`

- [x] **Step 1: 写登录弹窗渲染测试**

断言：

- 弹窗标题为 Claude360 Copilot 登录语义。
- 有“账号密码登录”和“网页授权登录”两个入口。
- 不显示旧 API Key、Base URL、Provider 配置字段。

- [x] **Step 2: 写 password 登录交互测试**

Mock `window.kunGui.claude360PasswordLogin`：

- 输入用户名密码后提交。
- 成功时关闭弹窗并触发账号同步。
- `require_2fa=true` 时切换到验证码输入态。

- [x] **Step 3: 写网页授权测试**

Mock `startDeviceAuth` 和 `pollDeviceAuth`：

- 展示 user code 和打开浏览器按钮。
- pending 时显示等待。
- approved 时关闭弹窗。
- expired 时提供重试按钮。

- [x] **Step 4: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/InitialSetupDialog.test.ts src/renderer/src/AppShell.test.ts
```

Expected: FAIL，旧 UI 仍存在。

- [x] **Step 5: 改造 `InitialSetupDialog`**

实现要求：

- 不再保存用户输入的 API Key。
- 不显示第三方供应商配置。
- 登录成功后调用 `claude360SyncAccount()`。
- 错误状态包括网络失败、账号密码错误、2FA 错误、授权过期。

- [x] **Step 6: 改造首次启动判断**

`AppShell` 或现有首次配置逻辑应从：

- 旧：是否存在 active agent API key。

改为：

- 新：`claude360Session().loggedIn` 为 false 时展示登录弹窗。

- [x] **Step 7: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/InitialSetupDialog.test.ts src/renderer/src/AppShell.test.ts
npm run typecheck
```

Expected: PASS。

## Task 7: 登出和敏感信息清理

**Files:**

- Modify: `src/main/services/claude360-auth-service.ts`
- Modify: `src/main/services/claude360-secret-store.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/renderer/src/components/InitialSetupDialog.tsx` 或后续“我的”页入口
- Test: service 和 IPC 测试

- [x] **Step 1: 写登出测试**

断言：

- `logout()` 清空 `cliTokenRef`。
- `loggedIn=false`。
- `username/displayName` 清空。
- `clearClaude360Secrets()` 被调用。
- provider profiles 后续计划会清空或重建；本计划至少不保留 Claude360 明文。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-auth-service.test.ts src/main/services/claude360-secret-store.test.ts
```

Expected: FAIL 或登出断言失败。

- [x] **Step 3: 实现登出清理**

登出不调用生产接口，仅清理本地状态。后续如 newapi 增加 token revoke，可单独规划。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-auth-service.test.ts src/main/services/claude360-secret-store.test.ts
```

Expected: PASS。

## Task 8: 回归验证

**Files:** 本计划涉及所有文件。

- [x] **Step 1: 运行新增和相关单测**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/shared/app-settings-claude360.test.ts src/main/services/claude360-secret-store.test.ts src/main/services/claude360-api-client.test.ts src/main/services/claude360-auth-service.test.ts src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/renderer/src/components/InitialSetupDialog.test.ts src/renderer/src/AppShell.test.ts
```

Expected: PASS。

- [x] **Step 2: 类型检查**

Run:

```bash
cd "claude360-Copilot"
npm run typecheck
```

Expected: PASS。

- [x] **Step 3: 全量测试**

Run:

```bash
cd "claude360-Copilot"
npm run test
```

Expected: PASS。

## Risk Notes

- 不保存用户名密码。
- Renderer 不应持有长期 `cli_token` 或 API Key 明文。
- 登录错误信息不能泄露“用户存在但密码错误”等可被枚举的信息，尽量复用后端 message。
- 若 `safeStorage` 在某些 Linux 环境不可用，fallback 必须显式、集中、可测试，后续再升级为 keytar 或系统 keychain。
- `window.kunGui` 命名可暂时保留以降低改造面；品牌层面另由计划 04 处理。
