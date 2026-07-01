# Codex 代码审查与功能验收任务书 · Claude360 Copilot 二开

> 本文件是交给 Codex 的**独立**审查/验收任务书。请勿假设你能看到此前任何对话历史；本文件应自包含。
> 目标：对「白牌化 Kun → Claude360 Copilot 客户端 + newapi 后端」这一二开项目做**一次完整的代码审查 + 功能验收**，产出分级问题清单与可否交付的结论。

---

## 0. 你的角色与总原则

- 你是一名**独立、严格、以证据为准**的资深审查员。所有结论必须给出 `文件:行` 证据，不臆测。
- **只读审查为主**：默认不修改代码；如需修改验证，先说明再改，且**绝不执行任何 git 提交/分支/推送操作**。
- 对每个发现给出**置信度（0–100）**与**严重度（Critical / Important / Minor）**，并区分「真实缺陷」「既有架构张力（非本次引入）」「误报/可接受」。
- 允许对既有结论提出反驳：若你认为某处「已知偏差」实际是必须修复的红线，请明确升级并给理由。

---

## 1. 项目背景（简版）

- **客户端**：`/root/app/claude360agent/claude360-Copilot`，Electron 34 + React 19 + TypeScript（双 tsconfig：`tsconfig.web.json` / `tsconfig.node.json`）+ Vite（electron-vite）+ Zustand + Vitest + zod + electron-builder。
- **后端**：`/root/app/claude360agent/newapi`，Go/Gin/GORM 中转站（模块 `github.com/QuantumNous/new-api`）。客户端通过 `/api/cli/*` 与其对接。
- **二开目标**：把开源 Agent 客户端 **Kun** 白牌化为 **Claude360 Copilot**，深度接入 newapi（`claude360.xyz`），新增：账号/密钥/登录、模型收口、我的页、原生音乐工作台（Suno）、原生生图工作台（OpenAI 兼容图像端点）。
- **权威路线图**：`doc/codex-plan/plan-01 ~ plan-06`（6 份，含验收项与 Risk Notes）。补充记录见 `doc/claude-plan/STATUS-自动执行进度.md`（其"第八节"记录了最近一轮代码审查与修复）。

### 凭据模型（务必理解）
- 三要素：`cli_token`（身份/access token）、分组 **API Key**（`sk-xxx`）、请求头 `New-Api-Group`。
- 秘钥用 Electron `safeStorage` 加密，存 `userData/claude360-secrets.json`；**settings 里只存脱敏引用（tokenRef / apiKeyRef），不存明文**。
- `cli_token` 存于 secret-store，key ref 约定：`claude360:cli-token`、`claude360:api-key:<tokenId>`。

---

## 2. 硬约束 / 红线（审查时逐条核查是否被违反）

1. **凭据安全（最高优先）**：API Key / cli_token 明文**只允许在 main 进程读写使用**；绝不能出现在：
   - 返回给 renderer 的任何结果对象、
   - 普通持久化（`settings.json`）、
   - 日志（日志中的 Authorization / key 必须脱敏）。
   - 唯一允许把明文 Key 下发 renderer 的通道：用户**显式** reveal（`claude360:tokens:reveal`）并复制，UI 不得长期驻留/落盘。
2. **provider.apiKey 收口（本轮新增架构，重点复核）**：claude360 provider profile 落盘时 `apiKey` 应为空，改带 `apiKeyRef`（形如 `claude360:api-key:<tokenId>`）。真 Key 由 main 在 **spawn / 写子进程 config 前**从 secret-store 解出注入运行时（kun 是**子进程**，拿不到 secretStore）。`settings:get` 下发 renderer 前须对 claude360 provider 的 `apiKey` 脱敏。**须向后兼容**：无 `apiKeyRef` 时回退 inline `apiKey`（旧安装零行为变化）。
3. **无 git 操作**：全程不得 commit/branch/push。
4. **newapi Rule 5**：禁改 `new-api` / `QuantumNous` 品牌；JSON 走 `common/json` 包装；DB 三库（MySQL/PG/SQLite）兼容。
5. **保留边界（不得中性化/改名）**：内部运行时命名必须保留——`window.kunGui`、`kun-runtime`、`KUN_*` env、`KUN_*_TEMPLATE`、`id='kun'`、跨包 import、`AgentKun/KunStateFigure/KunHeroStage/AnimatedWorkLogo/kun_*.png`、R2 release 前缀、legacy 迁移常量。**仅"运行时网络/界面可见文本"必须中性化为 Claude360 Copilot**。
6. **不改 `doc/codex-plan/` 正文**（如需勾选复选框以外的记录，写到别处）。

---

## 3. 关键架构点（理解这些能避免误报）

- **provider id 归一化**：`normalizeModelProviderId` 会把 `:`→`-` 并小写，故 `claude360:<group>` 存盘后为 `claude360-<group>`；`isClaude360ProviderId` 必须同时兼容 `claude360:` 与 `claude360-`。
- **原始信封通道**：Suno 音乐端点返回 `{code,message,data}`；OpenAI 兼容图像端点返回 `{data:[{url|b64_json}]}`——两者都走「raw」通道（`postSunoRaw` / `postImagesRaw` / `postImagesMultipart`），**不是** newapi 常规的 `{success,data}`。
- **测试约定**：Vitest `include` 只匹配 `*.test.ts`（不含 `.test.tsx`），node 环境无 jsdom → 组件测试用 `renderToStaticMarkup` + 依赖注入 + 把副作用抽到纯 `*-actions.ts` 模块。
- **kun 运行时是子进程**：main 通过 spawn 启动，明文 Key 经子进程 `config.json > serve.providers[].apiKey` 与 `DEEPSEEK_API_KEY` env 注入（这是 main 侧解密后写入的，属预期出口）。

---

## 4. 审查范围与重点文件

### 4.1 客户端 main 进程（服务/安全边界）
- `src/main/services/claude360-api-client.ts`（脱敏 `sanitizeClaude360Message`、raw 通道、错误分类可重试性）
- `src/main/services/claude360-secret-store.ts`（safeStorage 加密/降级、`enc:true` 不可读时的降级方向）
- `src/main/services/claude360-token-service.ts`（`ensureGroupToken` 的 in-flight 去重是否真正防并发重复建 token）
- `src/main/services/claude360-model-service.ts`（模型/分组同步，profile 只带 `apiKeyRef` 不带明文）
- `src/main/services/claude360-billing-service.ts` / `claude360-auth-service.ts`（2FA、登录态、账单）
- `src/main/services/claude360-music-service.ts`（`/suno/*`、"上游成功但缺任务"归约是否防无限轮询/误计费）
- `src/main/services/claude360-canvas-service.ts`（base64 解码边界/25MB 上限、multipart、鉴权前置）
- `src/main/upstream-models.ts`（只从 claude360 provider 取模型，未登录明确报错不回落）
- `src/main/kun-process.ts`（**重点**：`setClaude360KeyResolver` / `providersConfigForRuntime`（异步水合）/ `startKunChildOnce` 的 `DEEPSEEK_API_KEY` 解析；确认子进程能拿到真 Key、settings 不落明文）

### 4.2 IPC 契约 / preload / shared 设置
- `src/main/ipc/app-ipc-schemas.ts` / `register-app-ipc-handlers.ts`（zod 校验齐全性；`settings:get` 脱敏；channel 与 handler 一一对应）
- `src/preload/index.ts` / `src/shared/kun-gui-api.ts`（暴露面最小、无明文 Key 通道）
- `src/shared/app-settings-claude360.ts` / `app-settings-provider.ts` / `app-settings-write.ts` / `app-settings-normalize.ts` / `app-settings-types.ts`（`ModelProviderProfileV1.apiKeyRef` 归一化保留；`isClaude360ProviderId`；写作补全 provider 收口）

### 4.3 renderer 状态层与工作台
- 音乐：`src/renderer/src/music/{music-task-store,music-workbench-actions,suno-params}.ts`、`components/music/*`
- 生图：`src/renderer/src/canvas/{canvas-store,canvas-workbench-actions,image-result-utils}.ts`、`components/canvas/*`
- 我的页：`src/renderer/src/components/my/*`
- 可见性：`src/renderer/src/lib/feature-visibility.ts`
- 重点：Zustand 纯度/竞态、轮询失败上限与归约、并发提交拦截读最新 state、持久化不含 Key、大 base64 不爆 localStorage、useEffect cleanup。

### 4.4 UI/UX（桌面 Web 范式）
- 可访问性（对比 ≥4.5:1、`:focus-visible` 焦点环、图标按钮 aria-label、键盘可达、颜色非唯一信息载体）
- 交互状态（hover/active/disabled/loading）、空/错/载态、暗色成对处理、图标统一 lucide（禁 emoji）
- 面向用户文案是否残留「Kun/ikun/小鸟」等可见文本（内部 `window.kunGui` 等不算）

### 4.5 newapi 后端（plan-01）
- `controller/cli.go`：`CliAuthPassword` / `CliAuthPassword2FA` / `CliTokenStats` + 2FA challenge store（TTL、一次性消费防重放）
- `router/api-router.go`：3 条 `/api/cli/*` 路由的鉴权/限流/Turnstile 装配
- 遵守 Rule 5、`common/json`、三库兼容

---

## 5. 分模块功能验收清单（逐项判定：通过 / 不通过 / 存疑）

> 每份 plan 的详细验收项见 `doc/codex-plan/plan-0X-*.md` 的 "验收" 段；下面是抽检要点。

- **plan-01 newapi CLI 登录/2FA/token_stats**：`go test ./controller ./router` 全绿；密码登录 / 2FA required / 错误 challenge 不消费 / 正确 TOTP 一次性消费 / token_stats 401 与用户隔离。
- **plan-02 账号/密钥/登录核心**：settings 契约、secret store 加密、apiClient、auth service、登录弹窗、登出、首启改 `settings.claude360.loggedIn`。
- **plan-03 模型收口 + API Key 分组 + 我的页**：模型只源于 claude360、未登录明确报错不回落 DeepSeek；写作补全只接受 `claude360:*`；我的页（route `my`、6 子面板）；自定义供应商入口隐藏（`SHOW_MANUAL_PROVIDER_CONFIG=false`）但底层解析保留。
- **plan-04 品牌/appId/路由/隐藏入口**：品牌 → Claude360 Copilot（appId `xyz.claude360.copilot`）；`feature-visibility.ts` 隐藏 plugins/claw/schedule/workflow（保留 handler/route）；AppRoute +music/canvas；Sidebar 加 My/Canvas/Music。
- **plan-05 原生音乐工作台**：`Claude360MusicService`（`/suno/submit/music`·`/suno/fetch`，Key 只在 main）；轮询失败上限 + 并发提交拦截（防重复计费）；歌词助手/播放器。
- **plan-06 原生生图工作台 MVP**：生图 JSON + 编辑 multipart；`isClaude360ImageModelId` 过滤 image 模型（不硬编码）；历史限量 100 + 大 base64 丢弃 + 损坏安全恢复；复制/下载。

### 本轮修复专项复核（须独立验证是否真正解决）
- **A** `ensureGroupToken` in-flight 去重：并发同 group|purpose 是否只建一次 token。
- **B** 全局 `:focus-visible`：`base-shell.css` 兜底规则是否覆盖新三页交互元素；图上浮层 `data-focus-ring="on-media"` 高对比环是否生效。
- **C** apiKeyRef 收口：`settings.json` 与 `settings:get` 是否已无 claude360 明文；子进程 config/env 是否仍能拿到真 Key；旧明文数据是否向后兼容。
- **UI 8 项**：自定义 switch、必填标识+就近校验、Loader2、CTA 统一、radiogroup、选中态 Check 角标+aria-pressed、range aria-label、Trash2/去裸 URL；i18n 键 zh/en 是否成对。

### 请独立复核以下"已被判为降级/未改"的项（判断是否成立）
1. 「`claude360:models:refresh` 覆盖 `provider.providers` 会清除用户自定义 provider」——是否真的因 `SHOW_MANUAL_PROVIDER_CONFIG=false` + normalize 必重建默认 provider 而低风险？迁移遗留数据是否可能丢失？
2. 「多任务并发轮询时，某任务网络错误会因另一任务成功而被误计 miss」——`hasActiveTask` 并发提交拦截是否真的使其不可达？rehydrate 多个在途任务是否构成反例？
3. 「`submitting` 态无运行期超时，IPC 悬挂可锁死提交按钮」——是否有必要补超时兜底？

---

## 6. 验收命令（在对应仓库根目录执行）

### 客户端 `/root/app/claude360agent/claude360-Copilot`
```bash
npm run typecheck      # web + node 双 tsconfig，须 0 error
npm run lint           # 须 0 error（既有 exhaustive-deps warning 可接受，但不得新增 error）
npm test               # vitest run，须全绿
npm run build          # electron-vite build，须成功
```
> 达成判定：四项全部通过；无头环境无法执行 `npm run dev` 手动冒烟与 `dist:linux` 真实打包，这两类可标注为"环境受限未执行"。

### newapi `/root/app/claude360agent/newapi`
```bash
go test ./controller ./router   # 须全绿
```

---

## 7. 你需要重点回答的问题（审查提问清单）

1. 是否存在**任一**路径把 `apiKey` / `cli_token` / `Authorization` 写入返回值、日志、`settings.json`？给出证据或确认无。
2. apiKeyRef 收口后，kun 子进程在 **spawn/写 config** 时是否确实拿到解密后的真 Key？（若拿不到，运行时会 401 → 全应用不可用）
3. `settings:get` 脱敏是否覆盖旧明文过渡数据？脱敏后 renderer 侧（设置页/就绪判断/probe 回传）是否仍工作正常？
4. zod 校验是否覆盖所有带 payload 的 claude360 IPC（canvas n∈[1,4]、size 枚举、edit image 必填、music prompt/instrumental 二选一等）？
5. 音乐/生图工作台是否存在无限轮询、重复计费、内存/localStorage 爆量、卸载后 setState 竞态？
6. UI 是否满足 WCAG 关键项（焦点环、aria-label、对比、颜色非唯一载体、暗色对比）？是否残留 emoji 当图标或面向用户的 "Kun/小鸟" 文案？
7. newapi 改动是否违反 Rule 5 / `common/json` / 三库兼容？2FA challenge 是否防重放？
8. 是否有任何**保留边界**被误中性化（运行时 `kun-*` 命名被改）？

---

## 8. 交付物（输出格式，严格）

请输出一份审查+验收报告，含：

1. **执行摘要**：可否交付（Ready / 需修复后可用 / 阻塞），一句话结论。
2. **四命令闸门结果表**（客户端 4 项 + newapi go test），贴关键输出。
3. **问题清单**：按 `Critical / Important / Minor` 分级，每条含：
   - `文件:行`、问题描述、复现/证据、修复建议、**置信度**、类别（真实缺陷 / 既有架构张力 / 误报）。
4. **plan-01~06 验收表**：逐 plan 标注 通过 / 不通过 / 存疑 + 依据。
5. **本轮修复（A/B/C+UI）复核结论**：逐项确认是否真正解决。
6. **降级项独立判定**（第 5 节 3 个问题）：你是否同意降级，理由。
7. **保留边界核查**：确认无误中性化，或列出违规点。
8. **遗留 OPEN 项**与后续建议。

> 用中文输出。发现与结论以证据为准；对无法在无头环境验证的项（GUI 手动冒烟、真实打包），显式标注"环境受限未执行"，不要据此判失败。
