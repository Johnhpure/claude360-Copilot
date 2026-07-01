# Claude360 Copilot 开发设计文档

## 1. 设计目标

Claude360 Copilot 是 Claude360 模型站的原生桌面客户端。它基于现有 Kun Electron 项目改造，但产品体验上不再暴露 Kun 的多供应商配置模型，而是以 Claude360 账号为唯一入口。

核心设计目标：

- 用户只登录 Claude360，不配置第三方供应商。
- 所有模型、分组、余额、充值、API Key 都来自 Claude360。
- 保留本地 Agent runtime、Code、写作和工具能力。
- 音乐、生图作为原生工作台接入。
- 账号态、密钥态、模型态边界清晰，避免 renderer 泄露长期凭据。

## 2. 现有系统概览

### 2.1 claude360-Copilot

技术栈：

- Electron main。
- React renderer。
- TypeScript。
- Zustand 状态管理。
- 本地 Kun runtime 通过 HTTP/SSE 服务交互。

关键路径：

- `src/preload/index.ts`：暴露 `window.kunGui`。
- `src/main/ipc/register-app-ipc-handlers.ts`：注册 IPC。
- `src/main/settings-store.ts`：本地 JSON 设置存储。
- `src/shared/app-settings-provider.ts`：provider 和模型解析。
- `src/renderer/src/components/Workbench.tsx`：主工作台。
- `src/renderer/src/components/chat/Sidebar.tsx`：侧边栏。
- `src/renderer/src/components/InitialSetupDialog.tsx`：首次配置。
- `src/main/upstream-models.ts`：composer 模型列表。
- `src/main/services/write-inline-completion-service.ts`：写作补全调用。

### 2.2 newapi

技术栈：

- Go。
- Gin。
- GORM。

已具备 Claude360 CLI 接口：

- 设备授权。
- 账号信息。
- API Key 列表、创建、reveal。
- 分组列表。
- 模型列表。
- 充值选项、微信充值和订单查询。

缺口：

- CLI 口径用户名密码登录。
- CLI 口径 token stats。
- 可选的 CLI 口径 API Key 删除/更新。

### 2.3 infinite-canvas

现状：

- Go 后端 + React/Next 前端。
- 有独立用户、JWT、文件、素材、画布数据、图片历史和 workflow。
- 已支持 Claude360 API Key 登录和 image 分组验证。

第一阶段处理：

- 不直接嵌入旧页面。
- 不迁移完整后端。
- 在 Copilot 原生实现生图工作台 MVP。
- 参考其图片请求、历史和画布交互模型。

### 2.4 claude360-music-web

现状：

- Vite + React 18 + Zustand。
- 已直接通过 Bearer API Key 调 Claude360 `/suno/*`。
- Suno 参数构造和轮询逻辑完整。

第一阶段处理：

- 迁移核心组件和 store。
- 删除独立登录。
- 使用 Copilot 的 Claude360 Key。

## 3. 总体架构

```
Renderer
  ├─ LoginDialog
  ├─ MyPage
  ├─ Code / Write
  ├─ MusicWorkbench
  └─ CanvasWorkbench
        │
        ▼ preload IPC
Main Process
  ├─ Claude360AuthService
  ├─ Claude360AccountService
  ├─ Claude360TokenService
  ├─ Claude360ModelService
  ├─ Claude360BillingService
  ├─ Claude360SecretStore
  └─ SettingsStore
        │
        ▼ HTTPS
Claude360 newapi
  ├─ /api/cli/*
  ├─ /v1/*
  └─ /suno/*
```

设计原则：

- Renderer 不直接持久化 `cli_token` 和完整 API Key。
- Main 进程统一处理 Claude360 API 请求和敏感数据。
- Runtime 仍读取 settings 中解析后的 provider 信息。
- Claude360 provider profile 是内部兼容层，不作为用户可编辑供应商暴露。

## 4. 设置模型

新增 `claude360` 设置块，建议结构：

```ts
type Claude360SettingsV1 = {
  baseUrl: string
  loggedIn: boolean
  username: string
  displayName: string
  defaultGroup: string
  selectedTextGroup: string
  selectedImageGroup: string
  selectedMusicGroup: string
  tokenRefs: Record<string, Claude360TokenRef>
  modelCache: Claude360ModelCache
  lastSyncAt: string
}

type Claude360TokenRef = {
  tokenId: number
  name: string
  group: string
  maskedKey: string
  secretKeyRef: string
  createdTime: number
}

type Claude360ModelCache = {
  groups: Array<{
    name: string
    ratio: number | null
    desc: string
    recommended: boolean
    models: Claude360ModelInfo[]
  }>
}

type Claude360ModelInfo = {
  id: string
  displayName: string
  endpoints: string[]
  tags: string[]
  recommended: boolean
}
```

敏感字段处理：

- `cli_token` 不直接存入 JSON 明文。
- API Key 明文不直接存入 JSON 明文。
- JSON 中只保存 `secretKeyRef`。
- `secretKeyRef` 对应密文由 main 进程通过 safeStorage 管理。

## 5. Claude360 服务层

### 5.1 Claude360AuthService

职责：

- 网页授权登录。
- 用户名密码登录。
- 2FA 登录流程。
- 登出。
- 校验和恢复登录态。

接口：

```ts
startDeviceAuth(): Promise<DeviceAuthStartResult>
pollDeviceAuth(deviceCode: string): Promise<DeviceAuthPollResult>
passwordLogin(input: PasswordLoginInput): Promise<LoginResult>
passwordLogin2FA(input: PasswordLogin2FAInput): Promise<LoginResult>
logout(): Promise<void>
getSession(): Promise<Claude360Session | null>
```

错误策略：

- 授权码过期：提示重新发起。
- 2FA 必需：切换到 2FA 输入态。
- Turnstile 缺失：提示完成验证。
- 网络失败：允许重试，不清除已有登录态。

### 5.2 Claude360TokenService

职责：

- 拉取 API Key 列表。
- 创建分组 Key。
- reveal Key 并加密保存。
- 为功能模块确保可用 Key。

核心方法：

```ts
ensureGroupToken(group: string, purpose: 'text' | 'image' | 'music'): Promise<Claude360TokenRef>
listTokens(): Promise<Claude360TokenRef[]>
createToken(group: string, name: string): Promise<Claude360TokenRef>
revealToken(tokenId: number): Promise<string>
```

自动创建策略：

- 文本默认使用推荐分组或 `auto`。
- 生图优先使用 `image` 分组。
- 音乐优先使用 Suno/音乐分组，具体分组名称以 `/api/cli/groups` 返回为准。
- 若分组不可用，提示用户当前账号不具备该能力。

### 5.3 Claude360ModelService

职责：

- 拉取分组。
- 拉取分组模型。
- 生成内部 provider profiles。
- 刷新 composer model groups。

内部 provider 映射：

```ts
type Claude360ProviderProfile = {
  id: `claude360:${group}`
  name: `Claude360 / ${group}`
  apiKey: string
  baseUrl: 'https://claude360.xyz'
  endpointFormat: 'chat_completions'
  models: string[]
  modelProfiles: Record<string, ModelProviderModelProfileV1>
}
```

模型能力推断：

- `endpoints` 包含 image generation：输出图像能力。
- 模型名或 tags 包含 vision/multimodal：支持图片输入。
- 默认文本模型支持 tool calling。
- reasoning 能力按模型元数据和已知模型表补充。

### 5.4 Claude360BillingService

职责：

- 账号余额。
- 充值选项。
- 微信充值。
- 订单状态轮询。

接口：

```ts
getMe(): Promise<Claude360Me>
getTopupOptions(): Promise<TopupOptions>
createWechatTopup(amount: number, discountCode?: string): Promise<TopupOrder>
getTopupOrder(orderId: string): Promise<TopupOrderStatus>
```

## 6. 登录设计

### 6.1 首次启动判断

现有逻辑通过 `getActiveAgentApiKey(settings)` 判断是否需要首次配置。改造后应改为：

- 无 Claude360 session：打开登录弹窗。
- 有 session 但缺少可用文本 Key：打开初始化同步流程。
- 有 session 且有文本 Key：正常进入工作台。

### 6.2 登录弹窗

结构：

- 标题：登录 Claude360 Copilot。
- Tab：账号密码登录、网页授权登录。
- 底部：网络错误、服务地址、隐私提示。

账号密码登录：

- 用户名。
- 密码。
- Turnstile。
- 2FA 输入态。

网页授权登录：

- 设备码。
- 打开浏览器按钮。
- 轮询状态。
- 过期重试。

登录成功后：

1. 保存 `cli_token`。
2. 拉取 `/api/cli/me`。
3. 拉取 `/api/cli/groups`。
4. 确保默认文本 Key。
5. 拉取模型列表。
6. 写入内部 provider profiles。
7. 启动或重启 Kun runtime。

## 7. 模型调用设计

### 7.1 Code

Code composer 使用 `composerModelGroups`。改造后：

- `fetchUpstreamModelIds` 改为读取 Claude360 model cache。
- 不再读取用户自定义 provider。
- `onConfigureProviders` 改为打开“我的 / API Key 分组”，不打开供应商设置。

### 7.2 写作

写作模块包含两类模型调用：

- 写作助手对话。
- inline completion。

改造策略：

- 写作助手模型列表来自 Claude360 文本分组。
- inline completion 继承写作模型，关闭自定义模型输入。
- `resolveWriteInlineCompletionApiKey` 和相关 provider 解析继续复用，但输入的 provider profiles 只来自 Claude360。

### 7.3 图片

生图工作台直接调用：

- `POST /v1/images/generations`
- `POST /v1/images/edits`

Header：

- `Authorization: Bearer <image group key>`
- 必要时 `New-Api-Group: image`

### 7.4 音乐

音乐工作台调用：

- `POST /suno/submit/music`
- `POST /suno/fetch`

Header：

- `Authorization: Bearer <music group key>`

## 8. “我的”页设计

路由：

- 新增 `AppRoute = ... | 'my'`。

入口：

- 左下角固定入口。
- 替换小鸟区域。

页面区块：

- 账号概览。
- 余额和充值。
- 今日用量。
- API Key 分组。
- 分组倍率。
- 模型能力摘要。

交互：

- 刷新账号信息。
- 创建分组 Key。
- reveal 并复制 API Key。
- 打开网页充值。
- 微信充值二维码。
- 订单轮询。

## 9. 音乐工作台设计

迁移来源：

- `claude360-music-web/src/types.ts`
- `claude360-music-web/src/lib/suno-params.ts`
- `claude360-music-web/src/api/suno.ts`
- `claude360-music-web/src/store/tasks.ts`
- `claude360-music-web/src/features/create/generate.ts`

组件：

- `MusicWorkbench`
- `MusicCreatePanel`
- `MusicTaskList`
- `MusicPlayer`
- `LyricsAssistantDrawer`

状态：

- 表单状态。
- 任务列表。
- 轮询状态。
- 当前播放歌曲。

错误处理：

- 提交失败：任务标记 failure。
- 轮询未知状态：累计失败次数，达到阈值标记 failure。
- API Key 不可用：跳转“我的”页创建/修复 Key。

## 10. 生图工作台设计

第一阶段组件：

- `CanvasWorkbench`
- `CanvasToolbar`
- `ImagePromptPanel`
- `ImageResultGrid`
- `ImageEditorPanel`
- `ImageHistoryPanel`
- `CanvasAssetStore`

状态：

```ts
type CanvasState = {
  activeImageId: string
  prompt: string
  mode: 'generate' | 'edit'
  images: CanvasImage[]
  history: CanvasHistoryItem[]
  selectedModel: string
  size: string
  busy: boolean
  error: string
}
```

第一阶段能力：

- 文本生图。
- 单图编辑。
- 多图历史。
- 下载。
- 复制。
- 重新生成。

暂不做：

- 无限画布复杂节点系统。
- 云同步。
- 素材市场。
- 排行榜。
- 会员系统。
- admin。

## 11. 隐藏与移除策略

采用“隐藏入口，保留代码”的方式，降低回归风险。

隐藏：

- Sidebar 插件入口。
- Sidebar Claw 入口。
- Schedule 入口。
- Workflow 入口。
- 形象工坊设置入口。

移除或停用：

- `SidebarMascot` 渲染。
- `IkunCameoLayer` 渲染。
- `KunCelebrationLayer` 渲染。
- UI plugin mascot 相关文案入口。

注意：

- 不删除底层模块，避免影响测试和 runtime。
- 后续确认完全不需要后再做清理。

## 12. 品牌与打包设计

需要修改：

- `package.json`
- `electron-builder.config.cjs`
- `src/main/app-identity.ts`
- 图标资源。
- 托盘图标。
- macOS 权限描述。
- Windows shortcutName。
- Linux AppImage 名称。
- renderer locales。

建议：

- 新 appId：`xyz.claude360.copilot`
- productName：`Claude360 Copilot`
- artifactName：`Claude360-Copilot-${version}-${os}-${arch}.${ext}`
- userData 目录使用新产品名。

风险：

- 新 appId 会让它成为新应用，不自动升级原 Kun。
- 这是符合当前产品定位的行为。

## 13. 测试策略

### 13.1 单元测试

- Claude360 auth service。
- token service 自动创建逻辑。
- model service 分组映射。
- settings migration。
- write inline completion provider 解析。
- Suno 参数构造。
- 音乐任务状态恢复。
- 画布状态 reducer。

### 13.2 集成测试

- 登录后同步账号、分组、模型。
- 创建 Key 后 runtime 可调用模型。
- Code 发送消息。
- 写作 inline completion。
- 充值订单状态轮询。
- 音乐生成任务。
- 生图请求。

### 13.3 打包测试

- Windows 安装、启动、卸载。
- macOS 启动、图标、权限说明。
- Linux AppImage 启动。
- 断网启动。
- 登录态恢复。
- 登出后密钥清理。

## 14. 安全设计

- 不保存用户名密码。
- `cli_token` 加密存储。
- API Key 加密存储。
- renderer 只拿必要展示字段。
- reveal API Key 需要用户显式操作。
- 日志中屏蔽 Authorization、API Key、password、token。
- 生产环境操作必须单独确认。

## 15. 开发顺序

1. 新增文档和接口契约。
2. newapi 补 CLI password login 和 token stats。
3. Copilot 新增 Claude360 settings 和 secret store。
4. 新增 Claude360 IPC 和 service。
5. 替换首次配置为登录弹窗。
6. 接入分组 Key 和模型同步。
7. 收口 Code/写作模型选择。
8. 新增“我的”页。
9. 隐藏非核心入口和小鸟功能。
10. 品牌/appId/打包改造。
11. 迁移音乐工作台。
12. 实现生图工作台 MVP。
13. 全量测试和打包验证。

## 16. 风险与缓解

- 登录安全复杂：保留网页授权作为兜底，用户名密码严格走后端安全流程。
- 自动创建 Key 达上限：提示用户去“我的”页清理或网页管理。
- 模型元数据不完整：先按 endpoints 和命名规则推断，后续补模型 metadata。
- 生图范围失控：第一阶段只做 MVP，不搬完整 infinite-canvas。
- 隐藏功能引发路由断裂：只隐藏入口，不删除底层路由。
- 品牌改名影响打包：单独做打包验证。

## 17. 待确认技术问题

1. Turnstile 在 Electron 中使用网页登录还是内嵌组件？
   - 建议：用户名密码登录内嵌 Turnstile；网页授权登录走浏览器。

2. 音乐分组名称是否固定？
   - 建议：不要硬编码，先从 `/api/cli/groups?tool=music` 或后端新增 tool 过滤能力获取。

3. 生图模型默认值是否固定为 `gpt-image-2`？
   - 建议：第一阶段可默认，但最终以 `/api/cli/models?tool=image` 返回为准。

4. API Key 删除是否进入第一阶段？
   - 建议：若后端工作量可控则做，否则跳转网页管理。

5. 是否需要导入旧 Kun 会话？
   - 建议：不作为第一阶段必做，避免用户数据迁移风险。
