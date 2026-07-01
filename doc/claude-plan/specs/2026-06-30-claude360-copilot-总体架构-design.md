# Claude360 Copilot — 总体架构规划（Master Design）

> 文档类型：项目级总体架构设计（总纲）
> 日期：2026-06-30
> 状态：待用户审查
> 范围：将开源 Agent 客户端 Kun 二次开发为 Claude360 专属 AI Agent 客户端「Claude360 Copilot」的整体技术路线
> 关联代码库：`claude360-Copilot`（被改造的 Kun）、`newapi`（中转站）、`infinite-canvas`（画布/生图）、`claude360-music-web`（音乐）、`suno-shim`（音乐网关）

本文件是整个改造项目的**总纲**，定义跨子项目的架构、决策、约束与实施顺序。每个子项目（P0–P5）后续各自走「设计 spec → 实施计划 → 编码」的完整循环，并以本文件为权威约束来源。

---

## 1. 背景与目标

Claude360（claude360.xyz）是一个 AI 大模型中转站。运营痛点：用户不会配置、调用工具不统一，产生大量异常请求，运维负担重。

**目标**：提供一个免费、统一的桌面客户端「Claude360 Copilot」，深度接入 Claude360 中转站，让用户在一个客户端内完成登录、充值、管理 API Key 分组、对话、编程、写作、生图、生成音乐，无需自行配置任何模型供应商。

**改造基线**：开源项目 Kun（Electron 34 + React 19 + 内置 `kun serve` 本地运行时）。

---

## 2. 关键决策汇总

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 画布整合方式 | 原生重写（抽取 infinite-canvas 生图逻辑），**纯生图工作台**（不保留无限画布交互、不保留云同步/会员/排行榜等运营功能、不引入 Go 后端） |
| D2 | 音乐整合方式 | 原生重写 + 主进程网络代理，**完整整合** music-web 的创作/写词/轮询/播放/下载 |
| D3 | 网络架构 | 客户端对中转站的所有请求统一经**主进程网关代理模块**，渲染进程不直连外网 |
| D4 | 登录方式 | **网页快捷授权（设备码）与用户名密码两者并列**，统一归一到 access token |
| D5 | 实施顺序 | P2 移除形象工坊 → P0 白牌化 → P1 中转站地基 → P3 我的页 → P5 音乐 → P4 生图 |
| D6 | 分发模式 | **全新分发**（用户无存量 Kun 安装），本地数据目录用新名、无需老数据迁移 |
| D7 | 白牌化深度 | **彻底白牌**：覆盖 L1–L3（可见层 / 文件系统·进程 / 开发者工具·抓包）+ L4 低垂果实（appId、包名、GitHub URL、注释）；仅保留 `kun/` 运行时目录与 `KUN_*` env（用户接触不到、改动成本极高）。目标：普通用户与会开 DevTools/抓包的技术用户都看不到 "kun" |
| D8 | 凭据模型 | 二元凭据：access token（身份）+ API Key（调用），单 Key 配 `New-Api-Group` 头切分组 |

---

## 3. 总体架构

```
┌──────────────────── Claude360 Copilot (Electron) ────────────────────┐
│  渲染进程 (React 19, 纯 UI, contextIsolation + sandbox + CSP)           │
│   ┌──────┬───────┬──────────┬──────────┬─────────┬──────────┐         │
│   │Code  │Write  │生图工作台 │音乐工作台 │我的账户 │登录弹窗   │         │
│   │对话  │写作   │(P4)      │(P5)      │(P3)     │(P1)      │         │
│   └──────┴───────┴──────────┴──────────┴─────────┴──────────┘         │
│        │ 全部经 IPC（渲染进程 CSP 不放行外部域，不能直连）                  │
│        ▼                                                              │
│  主进程                                                                │
│   ┌────────────────────────────┐   ┌──────────────────────────┐      │
│   │ ① Claude360 网关代理模块(新增) │   │ ② kun 运行时托管 (已有)      │      │
│   │  - 注入 access token / Key   │   │  - kun serve 子进程         │      │
│   │  - 注入 New-Api-Group 分组头  │   │  - baseUrl 固定指向中转站     │      │
│   │  - 设备码授权轮询/登录         │   │  - apiKey = Copilot 专属 Key │      │
│   │  - 生图/音乐/账户请求转发       │   └──────────────────────────┘      │
│   └────────────────────────────┘                                      │
└────────┼──────────────────────────────────┼──────────────────────────┘
         ▼ HTTPS                              ▼ HTTPS
   claude360.xyz (newapi 中转站)
   ├─ /api/cli/auth/*   设备码授权登录          ← 登录弹窗(P1)
   ├─ /api/user/login   用户名密码登录          ← 登录弹窗(P1)
   ├─ /api/cli/me       账户/余额/今日用量       ← 我的页(P3)
   ├─ /api/cli/tokens   API Key 分组增删改查     ← 我的页(P3)/凭据初始化(P1)
   ├─ /api/cli/groups   分组 + 倍率             ← 我的页(P3)
   ├─ /api/cli/topup/*  微信扫码充值            ← 我的页(P3)
   ├─ /api/cli/models   可用模型列表            ← Code/Write 模型下拉(P1)
   ├─ /v1/chat/completions、/v1/responses 文本对话/写作/AI写词 ← Code/Write 运行时、音乐(P5)
   ├─ /v1/images/generations、/v1/images/edits 生图 (New-Api-Group: image) ← 生图工作台(P4)
   └─ /suno/*           音乐 (含 suno 权限分组)   ← 音乐工作台(P5)
                            └→ suno-shim → api.sunoapi.org（对客户端透明）
```

**架构要点**：
- **单一出口**：新增「主进程 Claude360 网关代理模块」作为客户端与 newapi 之间的唯一出口，负责凭据注入、分组头切换、设备码授权轮询。渲染进程任何页面都不直连外网（受 CSP 约束，也避免凭据落入渲染层）。
- **复用已有运行时托管**：Code 对话与 Write 写作仍走内置 `kun serve` 运行时，仅把其 `baseUrl/apiKey/endpointFormat` 固定指向中转站（详见 P1）。
- **新页面走代理模块**：生图、音乐、我的账户三个新页面的网络请求经主进程网关代理模块（而非 kun 运行时），因为它们调用的是 `/v1/images/generations`、`/v1/images/edits`、`/suno/*`、`/api/cli/*` 等非对话端点。

---

## 4. 核心设计：二元凭据模型

newapi 中存在**两种语义不同的凭据**，必须配合使用。这是整个改造的技术枢纽。

| 凭据 | 本质 | 用途 | 获取方式 | 存储 |
|---|---|---|---|---|
| **access token**（身份令牌） | 代表"用户是谁"（newapi `user.access_token`） | 调 `/api/cli/*` 控制台类接口（账户/余额/充值/Token 管理） | 登录后获得 | 持久化到本地（electron-store） |
| **API Key**（`sk-xxx`，newapi 里叫 token） | 代表"调用额度凭证" | 调 `/v1/chat/completions`、`/v1/responses`、`/v1/images/generations`、`/v1/images/edits`、`/suno/*` 实际跑模型 | 客户端用 access token 调 `/api/cli/tokens` 自动创建/获取 | 持久化到本地 |

### 4.1 登录流程（双入口并列，D4）

两种入口最终都归一到「持久化一个 access token」：

```
入口 A：网页快捷授权（设备码）
  客户端 POST /api/cli/auth/start → 得 user_code + verification_url
    → 引导用户浏览器打开 verification_url 登录并确认授权
    → 客户端轮询 POST /api/cli/auth/poll → status=approved 时拿到 cli_token
    → cli_token 即 access token，持久化

入口 B：用户名密码
  客户端 POST /api/user/login (username/password) → 得 session
    → 主进程网关保存并复用登录 cookie
    → 客户端 GET /api/user/token（需 UserAuth/session cookie）生成 access token
    → 持久化 access token（不依赖浏览器 session）
```

> 注：登录弹窗 UI 两入口平等呈现；若站点启用 2FA，密码登录需补 `/api/user/login/2fa`。登录前可先调 `GET /api/status`（无需鉴权）读取 `quota_per_unit`/`price` 换算常数；当前 newapi 代码未在该接口返回 password 登录开关，P1 不应依赖该字段。P1 落地前必须验证 Electron 主进程网关是否正确保存 `/api/user/login` 返回的 session cookie，并能用同一 cookie 调通 `/api/user/token`。

### 4.2 调用凭据初始化（P1 关键步骤）

登录拿到 access token 后，客户端自动确保存在一个「Copilot 专属 API Key」：
1. 调 `GET /api/cli/tokens` 查是否已有 Copilot 专属 Key；
2. 无则 `POST /api/cli/tokens`（name="Claude360 Copilot"，默认无限额度、永不过期）创建，`POST /api/cli/tokens/:id/reveal` 取明文；
3. 把该 Key 注入 kun 运行时（`runtime.apiKey`）、并供主进程网关代理在生图/音乐请求时携带。

### 4.3 分组切换机制

单个 Copilot 专属 Key 通过请求头 `New-Api-Group: <group>` 在调用时指定走哪个分组（覆盖 token 默认分组，前提是该分组在用户可用分组内）：
- 文本对话/写作：默认分组（或 `auto`）
- 生图：`New-Api-Group: image`（newapi distributor 代码支持该头覆盖用户可用分组；目标部署仍需实测 image 分组）
- 音乐：含 suno 权限的分组

> 验证项（P1 落地前确认）：确认中转站当前部署配置下，单 Key + `New-Api-Group` 头可覆盖分组用于 image/suno；否则退化为「按分组各建一个 Key」。

### 4.4 换算常数（我的页用）

`余额(¥) = quota / quota_per_unit × price`，其中 newapi 默认 `quota_per_unit=500000`、`price=7.3`。两值从 `GET /api/status` 动态读取，不硬编码；`/api/cli/me` 已返回算好的人民币展示字段，优先直接用。

---

## 5. 子项目分解与方案概要

每个子项目独立交付，后续各自出详细 spec。

### P0 — 白牌化（消除一切可识别的 "Kun" 痕迹）

- **目标**（D7 彻底白牌）：普通用户正常使用、技术用户开 DevTools/抓包，都看不到 "kun"。全新分发（D6）使数据目录 / storage / appId 可安全改名、无迁移负担——这推翻了上一轮迁移注释里"appId 永不改"的前提。
- **L1 用户可见**：`src/main/app-identity.ts`（`APP_PRODUCT_NAME`）、`package.json`（productName）、`electron-builder.config.cjs`（productName / artifactName / 快捷方式名 / 卸载名 / 图标 `kun*.png`）、`src/renderer/src/locales/{zh,en}/*.json`（全部 "Kun" 文案）、`src/renderer/src/App.tsx`（loading 文案）、关于页文案、README。
- **L2 文件系统·进程**：数据目录 `~/.kun`、`appData/Kun` → 品牌/中性名（约 154 处引用）；日志目录 / 文件名及日志内容中的 Kun 标识；`kun serve` 子进程的 `process.title`（任务管理器 / 活动监视器显示名）。
- **L3 开发者工具·抓包（含网络可见文本，最高优先）**：
  - **运行时 system prompt / 子代理 persona / 写作 inline prompt 文本**（`kun/src/prompt/kun-system-prompt.ts` 的 "You are Kun…"、`agent-loop.ts` 测试工厂占位、`delegation/builtin-profiles.ts` 的"你是 Kun 内置…"、`src/main/services/write-inline-completion-service.ts` 的 "You are Kun inline writing"）——**会随模型请求发往中转站，抓包/中转站日志直接可见 "Kun"，是最高优先泄露点**，必须中性化；
  - `mcp__kun__<tool>` 工具名前缀（agent-sdk/Claude 订阅模式模型可见，`sdk-tool-bridge.ts` serverName=`'kun'`）；
  - whisper / updater 的 `User-Agent: Kun/<version>`（`local-whisper-service.ts`、`gui-updater.ts`）；
  - `window.kunGui` → 中性/品牌桥名（**512 处全局替换** + typecheck 兜底）；storage key `kun.*` → 新前缀（约 30 个 key，全新分发无兼容问题）；localStorage 库名；
  - CSS 前缀 `ds-`（219 个 class，DeepSeek 遗留缩写，低优先）；React 组件名含 Kun 的可改名（`KunRuntimeProvider` 等）；`src/renderer/index.html` 的 title / meta。
  - 注：模型 / 探测请求本身**不设 UA、不含 kun**（已验证 `compat-model-client.ts`），网络泄露集中在上述 prompt 文本与 whisper/updater UA。
- **L4 低垂果实**：`package.json` name `kun-gui` → `claude360-copilot`、homepage / repository GitHub URL → 自有或移除；appId `com.xingyuzhong.deepseekgui` → 如 `com.claude360.copilot`（全新分发可安全改）；明显源码注释中的品牌字样。
- **保留（纯内部技术标识，用户/抓包均接触不到）**：`kun/` 运行时**目录名**、`KUN_*` 环境变量（已验证仅主进程 spawn 时注入子进程、渲染进程 `process.env` 命中 0 处、不出网）、`kun serve` 命令名、bin `kun`、内部 JS 常量名（如 `KUN_*_TEMPLATE` 路由模板）。**关键区分**：保留的只是"标识符"；`kun/` 运行时内**网络可见 / 界面可见的文本内容**（system prompt、persona、UA）**不在保留之列、必须中性化**（见 L3）。
- **前置动作**：进入 M1 时先做一次**精确痕迹普查**（区分 "Kun" 品牌字样 vs `chunk`/`trunk` 等误报），产出逐文件、逐类别的改造清单。
- **风险**：中（514 处 window 桥 + 48 处 storage + UA 全局重命名，靠 typecheck + 全量构建兜底；需先验证运行时 UA 与 `process.title` 确实可改）。

### P1 — 中转站接入地基

- **范围**：登录 + 凭据 + 统一供应商，是 P3/P4/P5 的前置依赖。
- **① 登录弹窗**：替换 `InitialSetupDialog.tsx`，实现 §4.1 双入口；首启判定（`chat-store-navigation-actions.ts` 的 `boot()`，原 `needsInitialSetup = !apiKey`）改为「无 access token」；新增凭据存储字段。
- **② 凭据初始化**：实现 §4.2，登录后自动确保 Copilot 专属 Key。
- **③ 统一供应商**：屏蔽 `settings-section-providers.tsx` 的新增/自定义供应商入口；运行时单 provider 固定指向中转站（改 `kun-process.ts` 的 `buildKunServeArgs`/`providersConfigForRuntime` + `app-settings-kun.ts` 默认值）。
- **④ 模型来源**：`upstream-models.ts` 的 `fetchUpstreamModelIds` 改为从 `/api/cli/models` 拉取（替代"镜像用户配置的 provider.models"）。
- **风险**：中。建议拆两步：先改模型来源，再改 baseUrl/apiKey 统一注入。

### P2 — 移除形象工坊

- **范围**：删左下角小鸟形象入口、主会话泳动彩蛋、UI 插件系统、彩蛋设置页。
- **删**：`SidebarMascot`（`AnimatedWorkLogo.tsx`）、`IkunCameoLayer`/`KunCelebrationLayer`、`settings-section-easter-egg.tsx` 及其在 `SettingsView/SettingsSidebar/settings-sections/chat-store-types` 的注册（`'easterEgg'` 枚举）、`ui-plugin-store.ts`、主进程 `ui-plugin-service.ts`/`ui-plugin-bundled.ts` 及其 IPC/契约、`Workbench.tsx` 的 cameo 渲染分支。
- **必须保留**：`AgentKun`（子 Agent 卡片头像，被 `SubagentCallCard`/`SubagentDetailPanel` 依赖）、`KunStateFigure`（工作态 logo）及其引用的 `src/asset/img/kun_*.png`。
- **衔接**：左下角腾出的位置供 P3「我的」入口使用。
- **风险**：中（需精确切割，约 20 文件）。

### P3 — 我的账户页

- **范围**：左下角"我的"入口 + 账户页。
- **接入**：左下角 `Sidebar.tsx` footer 加 `SidebarCommandRow`；`AppRoute` 加 `'account'`，仿 schedule/workflow 接入 store 动作 + Workbench route 分支。
- **内容**（全走 `/api/cli/*`）：账号信息 + 余额/今日 token 用量（`/api/cli/me`）、API Key 分组增删改查（`/api/cli/tokens` + `:id/reveal`）、各分组及倍率（`/api/cli/groups`）、微信扫码充值（`/api/cli/topup/options|wechat|order` 轮询）。
- **依赖**：P1（access token）、P2（入口位置）。
- **风险**：低。

### P4 — 生图工作台（纯生图，D1）

- **范围**：传统生图页——prompt + 参考图 → 出图 → 历史管理/下载。**不要**无限画布/节点/连线/云同步/会员。
- **复用**：infinite-canvas 的 `services/api/image.ts` 生图请求逻辑（`requestGeneration`/`requestEdit`）；UI 重写为原生 React 页。
- **网络**：主进程网关代理 `/v1/images/generations`、`/v1/images/edits`，注入 Key + `New-Api-Group: image`；图片本地存储（Electron 渲染进程 IndexedDB 或主进程落盘）。
- **接入**：`AppRoute` 加 `'image'`，左侧导航加入口。
- **依赖**：P1。
- **风险**：中。

### P5 — 音乐工作台（完整整合，D2）

- **范围**：完整搬入 music-web——创作表单（简单/标准模式）、AI 写词、提交、轮询、播放、下载。
- **复用**：music-web 的 `api/`（改走 IPC）、`lib/suno-params.ts`、`store/{tasks,createForm,player}`、`hooks/usePolling.ts`、`features/{create,library,player,lyrics-ai}`、组件（同栈，可几乎原样搬入 `src/renderer/src/music/`）。
- **网络**：主进程网关代理 `/suno/submit/music`、`/suno/fetch`、`/v1/chat/completions`（写词 SSE）；下载改主进程落盘到用户选择目录。删 music-web 自带登录页，凭据接 P1 体系。
- **CSP**：必须走主进程代理（渲染进程 CSP 不放行远程音频/封面/外部域）。
- **接入**：`AppRoute` 加 `'music'`，左侧导航加入口。
- **依赖**：P1。
- **风险**：中。

---

## 6. 跨子项目共享约束与规范

所有子项目必须遵守，避免重复决策与不一致：

1. **白牌化命名规范**（D7/P0 定义）：彻底白牌覆盖 L1–L3 + L4 低垂果实。新代码一律用 `claude360`/中性命名，**禁止引入任何新的 `kun` 用户可见或可探查字符串**（含 UI 文案、storage key、CSS class、window 桥名、网络 UA）。仅 `kun/` 运行时内部目录与 `KUN_*` env 保留。
2. **网络代理规范**（D3）：渲染进程**绝不直连**中转站。所有外部请求经主进程网关代理模块（新页面）或 kun 运行时（对话/写作）。凭据只存在于主进程 + electron-store，不下发到渲染层（渲染层只拿数据/本地文件路径）。
3. **CSP**：维持渲染进程现有严格 CSP（`default-src 'self'`），不放宽外部域；远程资源（音频/封面/生成图）一律经主进程拉取后以本地路径/data 返回。
4. **凭据存储**：access token 与 Copilot 专属 Key 存 electron-store（主进程），渲染层通过 IPC 按需取脱敏后的账户信息。
5. **导航/路由扩展模式**：新页面照搬现有模式——`AppRoute` 枚举 + `openXxx` store 动作 + `Sidebar` 入口 + `Workbench` route 分支 + i18n 文案 + `WorkspaceModeTabs`/`activeView` 同步。
6. **运行时供应商**：单 provider 指向中转站；不破坏 workflow/定时任务/IM 仍依赖的 `providersConfigForRuntime` 路由结构（P1 改造时保持其形状，仅收敛为单一中转站 provider）。

---

## 7. 实施顺序与里程碑（D5）

```
里程碑 M1a（切割）：P2 移除形象工坊
   → 先移除 iKun/UI 插件/Retroma 等白牌化会碰到的彩蛋残留
里程碑 M1b（换名）：P0 白牌化
   → 客户端"换上新身份"，完成用户可见、文件系统可见、抓包可见命名收敛
里程碑 M2（地基）：P1 中转站接入地基
   → 登录 + 统一供应商 + 凭据初始化，打通"统一调用"核心价值
里程碑 M3（账户）：P3 我的账户页
   → 登录后可见余额/用量/充值/APIKey 管理，变现登录价值
里程碑 M4（音乐）：P5 音乐工作台
   → 轻、复用度高，先交付一个完整新功能
里程碑 M5（生图）：P4 生图工作台
   → 最后交付生图，闭环全部需求
```

每个里程碑独立可验证；M1 内部按 P2 → P0 串行执行，P1 之后再进入业务接入。

---

## 8. 主要风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 单 Key + `New-Api-Group` 头跨分组（image/suno）在目标部署不可用 | P4/P5 调用失败 | newapi distributor 代码已支持该头；P1 落地前仍需按目标部署实测验证；退化方案：按分组各建一个 Key |
| 设备码授权会话当前是 newapi 单实例内存存储 | 多副本部署时授权轮询失败 | 确认中转站部署形态；如多副本需先把会话迁到 Redis（newapi 侧） |
| 移除形象工坊误删 AgentKun/工作 logo | 子 Agent 卡片/工作态显示损坏 | 严格按 P2"必须保留"清单切割，先删入口再清运行时 |
| 屏蔽自定义供应商破坏 workflow/定时任务路由 | 自动化功能回归 | P1 保持 `providersConfigForRuntime` 形状，仅收敛为单 provider |
| 白牌化全局重命名（window 桥 514 / storage 48 / UA）遗漏或错改 | 残留 kun 痕迹被技术用户发现，或功能引用断裂 | 精确普查清单 + typecheck + 全量构建 + 运行时抓包自查 |
| 运行时 UA / `process.title` 实际不可改 | 抓包 / 进程名仍暴露 kun | P0 落地前先验证可改点；不可改则评估改 kun 运行时源码或接受该残留 |
| CSP 阻断远程音频/图片 | 音乐/生图无法播放/显示 | 一律走主进程代理，不放宽 CSP |

---

## 9. 留待各子项目细化的开放问题

- 登录弹窗的具体布局与两入口的视觉呈现（P1，设计时配可视化）。
- 白牌命名选择（P0）：window 桥名与 storage key 用品牌名（`claude360.*` / `window.claude360`）还是中性名（`app.*` / `window.desktop`）——品牌名更统一，中性名更不暗示任何来源。
- 我的页、生图工作台、音乐工作台的页面布局与交互细节（P3/P4/P5，设计时配可视化）。
- 生图/音乐生成结果的本地存储策略（IndexedDB vs 主进程落盘）与历史管理。
- Copilot 专属 Key 的命名、是否对用户在「我的页」可见/可删（避免误删导致客户端失效）。
- 充值二维码在桌面端的展示与轮询体验。

---

## 10. 后续流程

本总纲经用户审查通过后，按 D5 顺序进入第一个里程碑：先执行 P2 移除形象工坊，再执行 P0 白牌化，然后进入 P1 中转站接入地基。每个后续子项目同样走「设计 spec → 实施计划 → 编码」循环。
