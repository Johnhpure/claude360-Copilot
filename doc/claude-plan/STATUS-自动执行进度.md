# 自动执行进度与决策记录

> 自动生成 · 供醒后审阅 · 你可否决本文件任何决策

## 一、背景：两个目标冲突（重要，需你裁决）

会话中先后设了两个 `/goal`，指向**同一项目的两套替代路线图**：

1. 先：执行 `doc/claude-plan/plans/`（Claude 写的 P2/P0/P1，3 份，未含 P3/P4/P5）。
2. 后：执行 `doc/codex-plan/`（Codex 写的 plan-01~06，6 份完整，含 newapi Go 后端）。

两者**终态相同**（白牌化 Claude360 Copilot + 登录/账号/模型/我的页/音乐/生图 + 全绿），只是计划文档不同。**同时执行会冲突**。

**我的协调决策**（可否决）：
- codex-plan 更完整（6 份覆盖全部子系统），且是你最新显式目标 → 以 **codex-plan 为权威路线图**。
- 已完成的 claude-plan P2（移除形象工坊）= codex `plan-04` 验收项"小鸟/形象工坊/cameo/celebration 不再渲染"，**完全兼容、不浪费、不回退**。
- 你的长期铁律"绝不动 codex-plan 文档"与 codex 目标模板里"勾选复选框"冲突时，**以铁律为准**：我**不在 codex-plan 文档里勾选**，改用 TaskList + 本文件跟踪。
- 全程不做 git 提交/分支/推送。

## 二、已完成：P2 移除形象工坊（claude-plan，= codex plan-04 小鸟部分）

全部 10 Task 完成（计划文档复选框已全勾）。改动：
- 剥离 `AnimatedWorkLogo.tsx`（删 cameo/celebration/iKun 变体/SidebarMascot，保留 work-logo + KunStateFigure）及消费方 `MessageTimeline`/`Sidebar`/`Workbench`。
- 删彩蛋设置页 `settings-section-easter-egg.*` 及 5 处注册点；删 `easterEgg` 枚举。
- 删 UI 插件运行时：渲染层 `ui-plugin-store`/`ui-mode`/`ikun-mode`，主进程 `ui-plugin-service`/`ui-plugin-bundled`/`shared/ui-plugin` 及 IPC/preload/契约。
- CSS：`base-shell.css` 4972→3979 行（删 ikun/cameo/celebration/confetti/retroma + 孤儿关键帧），`surfaces-write.css` 删 2 条。
- i18n：删 zh/en 的 easterEgg/uiPlugin/uiMode/ikun 文案；删 ikun 资源图 8 个 + `examples/ui-plugins/` + `docs/UI_PLUGINS.md`。
- 重写 `AnimatedWorkLogo.test.ts`（保留项回归 + 痕迹清零负向断言，12 项通过）。
- **保留**：AgentKun、KunHeroStage、KunStateFigure、AnimatedWorkLogo、kun_*.png、kun/ 目录、KUN_* env。

痕迹清零自查：`ui-plugin|ikun|easterEgg|cameo|celebration|retroma|sidebar-mascot` 在 src 下**功能性引用为 0**。

## 三、验收命令结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过 |
| `npm run lint` | ✅ 0 error（14 个既有 exhaustive-deps warning，非本次引入） |
| `npm run build` | ✅ built in ~24s |
| `npm test` | ⚠️ 1797 通过 / **2 既有失败**（见下） |

## 四、（已解决）原 2 个 MessageTimeline 既有失败

`MessageTimeline.tool-summary.test.ts` 的 2 处 HEAD 既有失败已**对齐项目自身测试规格**修复（测试是较新的 `fix(test)` 提交，描述更优 UX：错误默认可见）：
1. `message-timeline-process.tsx`：工具/各类错误块 `defaultOpen = isError`（去掉 `&& block.kind !== 'tool'`），错误段 `defaultExpanded` 含 `hasError`（不再仅 processing）。
2. `MessageTimeline.tsx`：完成态回合若含错误，work process 默认展开但仍可手动折叠（运行中仍锁定展开）。

**当前整树四命令全绿**：`npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅（1825/1825）· `npm run build` ✅。

## 五、后续路线（codex-plan，按 index 顺序）

环境就绪：python3.12、newapi 在 `/root/app/claude360agent/newapi`（plan-01 Go 可本地执行）、go1.22.2。

- [x] plan-01 newapi CLI 登录/用量接口（Go：controller/cli.go + router；`go test ./controller ./router` **全绿**）
- [x] plan-02 客户端 Claude360 账号/密钥/登录核心（**Task 1-8 完成**：settings 契约/secret store/API client/auth service/IPC 接线/登录弹窗重写/登出/回归；typecheck ✅、新测试全绿、首启改 `settings.claude360.loggedIn`）
- [x] plan-03 模型收口 + API Key 分组 + 我的页（**全部 8 Task 完成**：token/model/billing 三服务 + provider profile + IPC（11 channel）+ Task 5 模型源收口 + Task 6 我的页 UI（route `my`、MyPage+6 子面板、Sidebar 入口、两段式审查+修复轮询超时/token 命名）+ Task 7 隐藏自定义供应商入口（`SHOW_MANUAL_PROVIDER_CONFIG` 门控，保留底层解析）+ Task 8 回归；**四命令全绿**：typecheck ✅ / lint ✅（0 error, 14 既有 warning）/ test ✅（222 文件 1859 测试）/ build ✅ 22s。OPEN：Task8 Step3 手动 GUI 冒烟无头环境跳过；分组倍率无后端字段暂显「—」；未登录 UX 用通用错误横幅）
  - 关键发现：`normalizeModelProviderId` 会把 `:` 归一化为 `-`，故 `claude360:<group>` 存盘后为 `claude360-<group>`；`isClaude360ProviderId` 同时兼容两种分隔符。
- [x] plan-04 品牌/appId/路由/隐藏入口（**全部 9 Task 完成**，subagent 双簇并行+两段式审查）：品牌 Kun→Claude360 Copilot（package.json/electron-builder productName+appId `xyz.claude360.copilot`+artifact `Claude360-Copilot-`+NSIS/mac 文案）、`APP_PRODUCT_NAME`、数据目录视为新应用（`AUTO_IMPORT_LEGACY_DATA=false`，迁移函数保留不自动导入/清理）、图标 claude360 占位资源、`feature-visibility.ts` 集中可见性（隐藏 plugins/claw/schedule/workflow，保留 handler/route）、AppRoute +music/canvas+Workbench 占位分支、Sidebar 加 My/Canvas/Music、审查补修 WindowsTitleBar logo + 关于弹窗/完成通知品牌文案。**四命令全绿**：typecheck/lint(0err)/test(225 文件 1876)/build 24s。OPEN：图标为 kun 副本占位需真实设计资源；`dist:linux` 实际打包需真实环境未跑；部分 runtime/CLI 语境的 "Kun" 文案按 Risk Notes 保留。
- [x] plan-05 原生音乐工作台（**全部 8 Task 完成**，subagent 后端→前端串行+两段式审查）：shared 音乐类型（状态枚举忠实迁移源 submitting/queued/in_progress/success/failure）、main `Claude360MusicService`（ensureGroupKey music 分组 + `/suno/submit/music`·`/suno/fetch`，postSunoRaw 处理 `{code,message,data}` 信封，Key 只在 main）、music IPC（submit/fetch schema+handler）、renderer suno-params（迁移 music-web 14 用例）+ music-task-store（Zustand，轮询失败上限 10、历史上限 60、持久化不含 Key）+ MusicWorkbench 等 5 组件 + actions 纯模块。审查修复：① 严重·轮询对"上游成功但缺任务"改返回 unresolved 可归约结果，修复无限轮询；② 计费风险·handleSubmit 加 `hasActiveTask` 拦截并发提交；③ 修 lint。**四命令全绿**：typecheck/lint(0err)/test(231 文件 1965)/build 22s。OPEN：MusicPlayer 播放队列参数未接自动连播；music 分组按名称含 `music` 近似判定；歌词助手为结构模板无 AI；手动 GUI 冒烟无头跳过。
- [x] plan-06 原生生图工作台 MVP（**全部 8 Task 完成**，subagent 后端→前端串行+两段式审查）：shared canvas 类型、main `Claude360CanvasService`（image 分组 Key + `/v1/images/generations` JSON + `/v1/images/edits` multipart FormData，url/b64_json 归一化，api-client 加 postImagesRaw/postImagesMultipart，Key 只在 main）、canvas IPC（generate n∈[1,4]/size 枚举、edit image 必填）、renderer canvas-store（历史上限 100、大 base64 持久化限量、损坏安全恢复）+ image-result-utils + CanvasWorkbench 等 6 组件 + actions 纯模块（`isClaude360ImageModelId` 过滤 image 模型，不硬编码 gpt-image-2，无模型空态+刷新）。审查修复：editImage 鉴权前置、复制反馈接线+消死键、常量命名语义。**四命令全绿**。OPEN：复制/下载跨平台真机待验证；mimeType 归一 png；手动 GUI 冒烟无头跳过。

---

## 七、最终达成（2026-07-01）

**codex-plan 六份计划全部完成**（plan-01~06 所有 Task 复选框已勾，仅 3 个 GUI 手动冒烟 + 1 个真实打包因无头环境保留未勾）。plan-01/02 早期会话完成（补勾）；plan-03 Task5 直做 + Task6/7 subagent；plan-04/05/06 按文件簇 subagent 实施 + 每份两段式审查（独立 code-reviewer + 我复验），审查发现的 1 个严重项（音乐轮询无限循环）+ 多个建议均已修复。全程零 git 操作，未改 codex-plan 正文（仅勾复选框）。

**最终四命令闸门（全绿）**：
| 命令 | 结果 |
|---|---|
| `npm run typecheck` | ✅ PASS（web + node 双 tsconfig） |
| `npm run lint` | ✅ 0 error（14 个既有 exhaustive-deps warning，非本次引入） |
| `npm test` | ✅ 239 文件 / **2066 测试全通过** |
| `npm run build` | ✅ built in ~25s |

**遗留 OPEN 汇总**：① 图标为 kun 副本占位需真实设计资源；② 分组倍率无后端字段暂显「—」；③ 未登录 UX 用通用错误横幅；④ music 分组按名称含 `music` 近似判定、歌词助手结构模板无 AI、播放队列未接自动连播；⑤ canvas mimeType 归一 png、复制/下载跨平台真机待验证；⑥ 3 个 GUI 手动冒烟（plan-03/05/06 各 Step3）+ plan-04 `dist:linux` 真实打包无头环境未执行；⑦ 部分 runtime/CLI 语境 "Kun" 文案按 Risk Notes 保留。

## 八、代码审查 + UI/UX 审查与修复（2026-07-01 追加）

用 `superpowers:requesting-code-review`（3 个独立 code-reviewer subagent：main 服务/IPC 契约/renderer 逻辑）+ `ui-ux-pro-max`（1 个 UI subagent）做**两段式审查**（独立 reviewer + 我逐项复验），并按用户「全部含架构项 C」范围落地修复。**全程零 git 操作。**

**复验后确认并修复：**
- **A 计费安全**：`claude360-token-service.ts` `ensureGroupToken` 无并发去重 → 同 group|purpose 首刷并发会在中转站重复建 token。已加 in-flight Promise 去重（`ensureInflight` Map），补并发单测（只建一次）。
- **B 可访问性**：新三页无键盘焦点环（违反 WCAG 2.4.7）。`base-shell.css` 加全局 `:focus-visible` 兜底（`:where()` 零特异性，组件类可覆盖）+ 图上浮层 `data-focus-ring="on-media"` 高对比白环。
- **C 架构（明文 Key 收口）**：provider profile 不再落明文 apiKey → 改存 secret-store 引用 `apiKeyRef`（`apiKey:''`）。类型 `ModelProviderProfileV1` 加 `apiKeyRef`；`normalizeModelProviderProfile` 保留该字段；`buildClaude360ProviderProfiles`/`claude360-model-service` 改传 ref；`kun-process` 注入 `setClaude360KeyResolver`，在 spawn/写子进程 config 前（`providersConfigForRuntime` 异步化 + env 路径）用 apiKeyRef 从 secret-store 解出真 Key 注入运行时（子进程拿不到 secretStore，故必须 main 侧解密）；`settings:get` 对 claude360 provider apiKey 脱敏后再下发 renderer。**强向后兼容**：无 ref 时回退 inline apiKey，旧安装零行为变化。补 spawn 前水合单测。
- **UI 打磨（8 项）**：纯器乐自定义 switch、必填标识+字段级就近校验、异步按钮 Loader2 旋转、三处低余额 CTA 统一描边式、假 ARIA tab 降级为 radiogroup、结果图选中态加 Check 角标+aria-pressed、range 滑块 aria-label+品牌色、删除图标改 Trash2+不展示裸 audioUrl。新增 6 个 i18n 键（zh/en）。

**复验后降级（未改，低风险/不可达）：** 「刷新模型清空自定义 provider」（自定义入口已 `SHOW_MANUAL_PROVIDER_CONFIG=false` 隐藏 + normalize 必重建默认 provider）；「多任务轮询 miss 误计」（`hasActiveTask` 拦截并发提交 → 正常单任务不可达）；「submitting 无运行期超时」（刷新可自愈，低概率）。

**修复后四命令闸门（全绿）**：typecheck ✅ / lint ✅（0 error，14 既有 warning）/ test ✅（**239 文件 2069 测试**，含 3 个新增：并发去重/spawn 水合/apiKeyRef）/ build ✅（~22s）。


## 六、plan-01 完成详情（newapi，2026-07-01）

新增 `POST /api/cli/auth/password`、`POST /api/cli/auth/password/2fa`、`GET /api/cli/token_stats`：
- `controller/cli.go`：`CliAuthPassword`/`CliAuthPassword2FA`/`CliTokenStats` + `buildCliLoginSuccessResponse` + 短生命周期 2FA challenge store（create/lookup/consume/cleanup，5 分钟 TTL，验证码错误不消费、成功一次性消费防重放）。
- `router/api-router.go`：3 条路由（密码登录走公开 CLI 路由 + CriticalRateLimit + TurnstileCheck；token_stats 走 cliAuthed/CliAccessTokenAuth）。
- 测试：`cli_test.go`（challenge 单测）、`cli_password_auth_http_test.go`（无 2FA 成功/错误凭据/2FA required/错误 challenge·验证码不消费/正确 TOTP 换 token·一次性消费）、`cli_token_stats_http_test.go`（401/用户隔离/消费日志聚合/时间窗口）、`api_router_cli_auth_test.go`（路由契约）。
- 验收：`go test ./controller ./router` 全绿；复用 `ValidateAndFill`/`IsTwoFAEnabled`/`GetTwoFAByUserId`/`ensureUserAccessToken`/`GetUserTokenStats`，无生产依赖；遵守 newapi Rule 5（未动 new-api/QuantumNous 品牌）。
