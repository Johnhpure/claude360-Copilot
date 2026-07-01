# Claude360 Copilot 第一阶段任务文档

## 1. 背景

Claude360 当前提供模型中转、在线生图画布、音乐创作台和 Suno 网关。现有问题是用户分散使用不同工具，配置方式不统一，模型调用参数与供应商配置混乱，导致模型站运维负担高。

第一阶段目标是把开源 Kun 深度改造为 `Claude360 Copilot` 原生客户端，让普通用户无需理解供应商、Base URL、API Key 细节，也能统一完成对话、编程、写作、生图、音乐、充值和 API Key 分组管理。

本阶段只规划和开发 Claude360 Copilot 客户端及必要的 newapi 支撑接口，不触碰生产环境部署，不做生产数据操作。

## 2. 已确认决策

- 第一阶段直接开发 Claude360 Copilot 原生组件，不以内嵌旧站页面作为主要方案。
- 登录同时支持用户名密码登录和网页授权登录，由用户自选。
- 客户端允许自动创建 Claude360 API Key 分组。
- 插件、手机连接、计划任务、Workflow 第一阶段隐藏入口。
- 应用使用新的 appId，不沿用 Kun 或 DeepSeek GUI 的历史身份。
- 所有模型供应商入口收口为 Claude360，不暴露用户自定义供应商配置。
- 不主动执行 git commit、push、reset、分支操作。
- 生产环境连接、数据库变更、批量删除等高风险操作必须单独确认。

## 3. 第一阶段目标

### 3.1 产品目标

交付一个 Claude360 用户专属桌面客户端，用户安装后可以：

- 使用 Claude360 账号登录。
- 查看账号、余额、今日用量和充值入口。
- 管理自己的 API Key 分组，并查看每个分组倍率。
- 在 Code 和写作功能中从 Claude360 模型列表选择模型。
- 使用原生音乐工作台生成 Suno 音乐。
- 使用原生生图工作台生成和编辑图片。
- 无需配置第三方模型供应商。

### 3.2 工程目标

- 保留 Kun runtime 的 Agent 能力和现有 Electron + React 架构。
- 新增 Claude360 专属服务层，隔离账号态、密钥态和模型态。
- 复用 newapi 已有 `/api/cli/*` 能力，必要时补充缺失接口。
- 迁移音乐台核心逻辑，避免重复实现 Suno 参数和轮询状态。
- 原生重建画布核心能力，第一阶段控制功能范围，避免一次性迁移完整 infinite-canvas 后端。

## 4. 范围

### 4.1 必做

1. 品牌与应用身份
   - 应用名改为 `Claude360 Copilot`。
   - 使用新的 appId。
   - 替换窗口标题、安装包名、快捷方式名、托盘名、用户数据目录命名。
   - 替换图标资源。

2. 登录与账号态
   - 首次配置弹窗改为 Claude360 登录弹窗。
   - 支持网页授权登录。
   - 支持用户名密码登录。
   - 支持 2FA 后续流程。
   - 安全保存 `cli_token`。
   - 登出后清理本地账号态和敏感 Key 缓存。

3. API Key 分组
   - 拉取用户可用分组。
   - 拉取、创建、reveal 用户 API Key。
   - 自动为必要分组创建客户端专用 Key。
   - 维护分组到 Key 的映射。
   - 在“我的”页展示 Key、分组、倍率、状态和用量。

4. 模型列表与调用收口
   - 从 Claude360 获取模型列表。
   - 按分组生成内部 provider profile。
   - Code、写作、inline completion 只使用 Claude360 模型。
   - 隐藏自定义供应商新增、导入、Base URL、API Key 配置。

5. “我的”页面
   - 新增一等路由。
   - 展示账号信息、余额、今日 tokens、今日请求数。
   - 展示分组倍率。
   - 支持充值余额。
   - 支持 API Key 分组管理。

6. 音乐工作台
   - 原生迁移 `claude360-music-web` 核心功能。
   - 调用 Claude360 `/suno/submit/music` 和 `/suno/fetch`。
   - 使用 Copilot 统一账号和分组 Key。
   - 本地保存任务和作品列表。

7. 生图工作台
   - 原生实现第一阶段画布工作台。
   - 支持文本生图、图片编辑、历史、下载、复制。
   - 调用 Claude360 `/v1/images/generations` 和 `/v1/images/edits`。
   - 使用 `image` 分组 Key，没有则自动创建或提示创建。

8. 隐藏非核心入口
   - 插件市场。
   - 手机连接 / Claw。
   - Schedule。
   - Workflow。
   - 形象工坊、小鸟形象、iKun cameo、celebration。

### 4.2 暂不做

- 不做生产环境部署。
- 不做旧 infinite-canvas 全量后端迁移。
- 不做音乐作品云同步。
- 不做插件市场改造。
- 不做手机端 IM 接入。
- 不做复杂工作流系统迁移。
- 不做新用户注册流程，除非后续明确要求。
- 不做管理员后台功能。

## 5. 后端支撑任务

### 5.1 复用现有接口

现有 newapi 已提供：

- `POST /api/cli/auth/start`
- `POST /api/cli/auth/poll`
- `GET /api/cli/auth/info`
- `POST /api/cli/auth/approve`
- `GET /api/cli/me`
- `GET /api/cli/tokens`
- `POST /api/cli/tokens`
- `POST /api/cli/tokens/:id/reveal`
- `GET /api/cli/groups`
- `GET /api/cli/models`
- `GET /api/cli/topup/options`
- `POST /api/cli/topup/wechat`
- `GET /api/cli/topup/order`

### 5.2 需要新增或调整

1. CLI 用户名密码登录
   - `POST /api/cli/auth/password`
   - `POST /api/cli/auth/password/2fa`
   - 目标：桌面端不依赖浏览器 cookie，也不绕过 Turnstile 和 2FA 安全策略。

2. CLI token 用量统计
   - `GET /api/cli/token_stats`
   - 复用 `model.GetUserTokenStats`。
   - 目标：让“我的”页可以通过 `cli_token` 查看每个 Key 的统计数据。

3. 可选：删除/禁用 API Key
   - 若第一阶段需要完整增删 Key，则补充 CLI 版 delete/update 接口。
   - 若时间受限，第一阶段只做创建、查看、reveal，删除跳转网页管理。

## 6. 前端任务拆解

### 6.1 账号与设置基础

- 新增 Claude360 settings schema。
- 新增 main 进程 Claude360 service。
- 新增 preload IPC。
- 新增 renderer hook/store。
- 使用 Electron `safeStorage` 保存敏感凭据。
- 首次启动根据 Claude360 登录态决定是否打开登录弹窗。

### 6.2 登录弹窗

- 替换现有首次配置 API Key 表单。
- Tab 1：用户名密码登录。
- Tab 2：网页授权登录。
- 支持登录错误、2FA、授权码过期、重试。
- 登录成功后自动同步账号、分组、模型和默认 Key。

### 6.3 模型与分组

- 将 Claude360 分组映射为内部 provider profile。
- 更新 composer model picker 数据源。
- 更新写作助手模型数据源。
- 更新 inline completion provider 解析。
- 关闭手填自定义模型入口。

### 6.4 “我的”页

- 新增路由 `my`。
- 新增左下角入口。
- 账户信息卡片。
- 余额和充值卡片。
- API Key 分组表格。
- 分组倍率表格。
- token 用量统计。

### 6.5 音乐工作台

- 新增路由 `music`。
- 迁移表单模型、Suno 参数构造、任务 store、轮询逻辑。
- 添加播放器、任务列表、失败状态和重试入口。
- 接入 Claude360 分组 Key。

### 6.6 生图工作台

- 新增路由 `canvas`。
- 实现画布状态 store。
- 实现图片生成、图片编辑、历史记录。
- 实现图片上传、下载、复制。
- 接入 Claude360 image 分组 Key。

### 6.7 隐藏入口与品牌

- 隐藏 Sidebar 中插件、Claw、Schedule、Workflow。
- 移除左下角小鸟和形象工坊入口。
- 替换文案中的 Kun、DeepSeek GUI。
- 替换打包配置和图标。

## 7. 阶段拆分

### Milestone 0：文档与方案冻结

输出任务文档、开发文档、接口文档和验收清单。

验收：

- 文档位于 `doc/codex-plan/`。
- 明确不触碰生产环境。
- 明确第一阶段范围和非范围。

### Milestone 1：品牌与入口骨架

完成路由和品牌基础。

验收：

- appName 显示为 Claude360 Copilot。
- 新 appId 配置完成。
- 非核心入口隐藏。
- `my`、`canvas`、`music` 路由占位可打开。

### Milestone 2：Claude360 登录与账号态

完成登录、token 安全存储、账号同步。

验收：

- 用户名密码登录可用。
- 网页授权登录可用。
- 重启客户端后登录态可恢复。
- 登出后敏感凭据清除。

### Milestone 3：API Key 分组与模型收口

完成分组 Key 管理和模型选择改造。

验收：

- 自动创建必要分组 Key。
- Code 模型下拉来自 Claude360。
- 写作模型下拉来自 Claude360。
- 用户无法新增自定义供应商。

### Milestone 4：“我的”页

完成账号、余额、充值、分组和用量展示。

验收：

- 账号信息准确。
- 余额和今日用量准确。
- 充值二维码和订单轮询可用。
- 分组倍率展示准确。

### Milestone 5：音乐工作台

完成原生音乐功能。

验收：

- 能提交 Suno 任务。
- 能轮询任务状态。
- 能播放和下载成功作品。
- 刷新后任务不会卡在 submitting。

### Milestone 6：生图工作台

完成原生生图 MVP。

验收：

- 能文本生图。
- 能图片编辑。
- 能保存历史。
- 能下载和复制结果。

### Milestone 7：打包验证

完成跨平台打包和回归。

验收：

- Windows 安装包可安装和卸载。
- macOS 包名、图标、权限说明正确。
- Linux AppImage 可启动。
- 主要路径均通过测试。

## 8. 验收清单

- 首次启动必须进入 Claude360 登录弹窗。
- 登录成功后无需用户手动填写 Base URL 或 API Key。
- 模型调用统一走 `https://claude360.xyz`。
- Code 和写作不出现第三方供应商配置。
- 生图和音乐均使用用户 Claude360 余额。
- 低余额状态有明确提示和充值入口。
- API Key 不以明文长期保存在 renderer localStorage。
- 退出登录后不能继续调用模型。
- 隐藏的功能不能从侧边栏直接进入。
- 构建产物名称和 appId 都属于 Claude360 Copilot。

## 9. 主要风险

- 用户名密码登录涉及 Turnstile 和 2FA，必须避免降低安全策略。
- 自动创建 API Key 可能达到用户 Key 数量上限，需要清晰错误提示。
- 分组与模型列表可能变化，需要缓存失效和手动刷新机制。
- 生图原生画布范围过大，必须严格控制 MVP。
- 品牌重命名涉及 appId、userData、自动更新和安装包身份，必须独立测试。
- 隐藏功能时不要删除核心代码，避免引入大面积回归。

## 10. 待确认问题

1. API Key 删除是否第一阶段必须支持？
   - 建议：第一阶段先支持创建、查看、reveal，删除跳转网页管理。

2. 用户名密码登录是否必须支持 Turnstile 内嵌验证？
   - 建议：支持。否则生产环境开启 Turnstile 后桌面登录不可用。

3. 生图工作台是否第一阶段需要无限画布式多节点编辑？
   - 建议：先做轻量画布和历史列表，不迁移完整 infinite-canvas 工作流。

4. 音乐作品是否需要云端同步？
   - 建议：第一阶段本地保存，后续再加云同步。

5. 隐藏功能是否保留设置入口？
   - 建议：第一阶段完全隐藏入口，代码保留，避免用户误用。
