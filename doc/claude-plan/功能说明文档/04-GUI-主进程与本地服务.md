# 04 · GUI 主进程与本地服务

> 范围：`src/main/`、`src/preload/`、`src/main/ipc/`、`src/main/runtime/`、`src/main/terminal/`
> 技术栈：Electron + electron-vite + TypeScript

> **版本边界**：本章描述原 Kun 基线能力。第 7 节 UI 插件/形象工坊会在 P2 中删除，P2 后仅作历史参考。

本章按「最小颗粒度」逐一拆解主进程内所有本地服务。

## 0. 总体架构与进程边界

Kun GUI 采用经典三段式：**主进程（main）持有一切本地资源与外部进程**，**预加载脚本（preload）以白名单形式桥接 IPC**，**渲染层（renderer）完全沙箱化**。

- **窗口安全基线**（`src/main/index.ts` `createWindow`）：`BrowserWindow` 强制 `contextIsolation:true`、`sandbox:true`、`nodeIntegration` 关闭，通过 `additionalArguments: ['--kun-home-dir=...']` 把家目录传给沙箱化 preload。`webviewTag:true` 仅为内嵌原型预览开放。
- **webview 守卫**（`installDevPreviewWebviewGuards`）：监听 `web-contents-created`，`will-attach-webview` 默认 `preventDefault()`，只放行开发预览 URL 或经 `prototype-embed-registry` 授权的 `file://` 原型页，并强制剥离 preload、关 nodeIntegration、开 sandbox。
- **单实例锁** + `second-instance` 显示已有窗口；运行 claw-schedule MCP 子服务模式时跳过。
- **生命周期收口**：`before-quit` 先 `stopManagedRuntimesForQuit()` 优雅停掉所有受托管运行时（schedule/workflow/claw/telegram/weixin-bridge + kun child），再 `app.quit()`。

关键文件：`src/main/index.ts`（主进程入口/窗口/托盘/生命周期/Kun 运行时托管）、`src/main/ipc/register-app-ipc-handlers.ts`。

---

## 1. IPC 通道注册与 Schema 校验机制

### 1.1 IPC 注册中枢 — register-app-ipc-handlers
- **功能**：集中注册近百个 `ipcMain.handle(...)` 通道，是渲染层访问全部本地能力的唯一入口。依赖注入接收 store/getMainWindow/runtimeRequest/各 runtime getter/logError。
- **覆盖**：设置读写、运行时请求、Claude 订阅登录与 SDK 安装、上游模型探测、Git/worktree/checkpoint、工作区文件、Skill、UI 插件（P2 后删除）、Write 系列、语音、计算机使用权限、桌面命令、通知、GUI 更新、日志。
- **统一校验**：每个 handler 第一步 `parseIpcPayload(channel, schema, payload)`——Zod `safeParse` 失败即抛错，绝不把未校验数据传给下游。

### 1.2 Schema 定义 — app-ipc-schemas
- **功能**：用 Zod 为所有 IPC payload 定义严格 schema，是主进程「输入边界防线」。
- **特征**：几乎所有对象 schema `.strict()`（拒绝多余字段）；明确上限常量 `MAX_BODY_BYTES=2_000_000`、`MAX_PATH_LENGTH=4_096`、`MAX_ID_LENGTH=256`、`MAX_SKILL_FILE_BYTES=1_000_000` 等；`runtimeRequestPayloadSchema` 用 `.refine(isAllowedRuntimeRequest)` 对 runtime 请求路径做**白名单校验**（基于 `KUN_*_TEMPLATE` 端点模板），渲染层无法越权访问非授权端点。

### 1.3 预加载桥 — preload/index.ts
- **功能**：`contextBridge.exposeInMainWorld('kunGui', api)`，约 110 个方法以受控形式暴露；每个只是 `ipcRenderer.invoke` 薄封装，事件订阅类返回 unsubscribe 闭包；家目录从 `process.argv` 读取，`getPathForFile` 用 `webUtils.getPathForFile` 拿拖拽文件真实路径。

---

## 2. Kun 运行时托管与空闲回收

### 2.1 Kun 运行时适配器 — kun-adapter
- **功能**：把「Kun 单运行时」抽象成 `kunRuntimeAdapter`，提供 resolveExecutable/ensureRunning/stopAndWait/isChildRunning/getBaseUrl/reclaimPort/resolveAvailablePort。
- **核心**：`runtimeRequestViaHost(settings, path, init, ensureRuntime)`——主进程向 Kun 发 HTTP 的核心：ensureRuntime 保活，按方法设超时（POST 60s/其它 15s），带 `Authorization: Bearer`；失败后对 GET/HEAD 或端口变更安全重试一次。`defaultKunDataDir()` 落在 userData 下。
- **关键文件**：`kun-adapter.ts`、`kun-process.ts`（spawn 子进程、端口探测、写 kun 配置）、`resolve-kun-binary.ts`、`kun-base-url.ts`、`kun-health.ts`。

### 2.2 Kun 可执行解析 — resolve-kun-binary
- **功能**：决定如何启动 Kun。解析顺序：① 用户自定义 binaryPath（脚本用 Electron 自带 Node 跑，否则当自定义命令）；② 兜底内置 `kun/dist/cli/serve-entry.js`。`buildKunServeArgs` 纯函数拼 `kun serve` argv。

### 2.3 运行时保活、健康看门狗与崩溃自愈（index.ts 内）
- **`ensureRuntime`/`ensureKunRuntime`**：去重保活。`waitForKunHealth` + `probeThreadApi` 探测；对卡死子进程等过启动窗口、确认 `RUNTIME_HUNG_CONFIRM_MS=10s` 仍无响应后原地 stop 再以同端口重启（修复重启风暴 #544/#621）。
- **看门狗**：周期健康探测，连续失败达阈值触发强制重启。
- **崩溃处理** + **重启前等空闲**（`waitForManagedRuntimeReadyBeforeStop` 调 `waitForRuntimeTurnsIdle`）。

### 2.4 空闲回收 — managed-runtime-idle
- **功能**：受托管运行时重启/停止前先确认没有正在跑的轮次。
- **核心**：`waitForRuntimeTurnsIdle` 轮询 `GET /v1/threads?limit=500&include=side`，判断是否有 thread/turn 处于 queued/in_progress/started/running。返回 idle/timeout/unavailable；默认空闲超时 10 分钟、轮询 1s；获取失败一律 unavailable（fail-safe）。

### 2.5 运行时事件流转发 — runtime-sse-ipc
- **功能**：主进程持有真正 SSE 连接，向渲染层转发 Kun 线程事件。
- **IPC**：`runtime:sse:start`/`runtime:sse:stop`；回传 `runtime:sse-event`（批量）/`runtime:sse-end`/`runtime:sse-error`。
- **特征**：自实现 SSE 解析（兼容 LF/CRLF），用 seq/Last-Event-ID 断点续传；指数退避重连（750ms→5s），区分致命 4xx（除 408/429）；100ms 节流批量下发。

---

## 3. 内置终端（node-pty）— terminal-pty-ipc

- **功能**：主进程拥有真实伪终端（node-pty），流式推输出给渲染层。`node-pty` 动态 import 懒加载，原生 prebuild 缺失时优雅降级。
- **IPC**：`terminal:create/write/resize/dispose`；输出 `terminal:data`、退出 `terminal:exit`。
- **特征**：跨平台 shell 选择（Win PowerShell 7→Windows PowerShell→cmd；mac `$SHELL` 兜底 zsh；Linux 兜底 bash）；严格 UTF-8 locale 解析（保证 CJK 不乱码）；每会话 ~64KB 环形缓冲重挂回放；会话数受 `TERMINAL_MAX_SESSIONS` 限；渲染销毁或 before-quit 回收所有 PTY 杜绝孤儿。

---

## 4. Git 能力（分支 / Worktree / 检查点）

### 4.1 Git 仓库发现 — git-discovery
- **功能**：纯 Node 实现「向上查找最近 `.git`」。git 二进制缺失/报错/版本过旧（<2.28）时兜底。从起点逐级向上（上限 64 跳），命中 `.git`（目录或文件）即返回。

### 4.2 Git 分支与派生 worktree — git-service
- **功能**：分支查询/切换/创建 + 基于分支派生临时 worktree。git 调用经 `runGit`（execFile，强制 `LC_ALL=C` 让输出英文便于归类）。
- **IPC**：`git:branches`、`git:switch-branch`、`git:create-and-switch-branch`、`git:checkout-branch-worktree`、`git:create-branch-worktree`、`git:branch-worktrees`、`git:remove-branch-worktree`。
- **特征**：解析 `worktree list --porcelain` 标注「已在其它 worktree 检出」分支；派生 worktree 默认落 `~/.kun/worktrees/<随机>/<repoName>`，派生分支 `kun/worktree-<hex>`。

### 4.3 Worktree 池 — worktree-service
- **功能**：为调度/工作流并行 agent 提供可复用 worktree 池（内存 Map）。
- **IPC**：`worktree:acquire/release/list/remove/changes/commit/merge/abort-merge/continue-merge/sync/abort-rebase/cleanup/find-available`。
- **特征**：池槽 `pool-<i>`，分支 `WORKTREE_BRANCH_PREFIX-<i>`，受 `MAX_WORKTREE_POOL_SIZE` 限；`acquire` 复位（有改动且非 force 抛 `WORKTREE_HAS_CHANGES_PREFIX`）；`merge` **坚决不在用户主仓 checkout main**，仅当用户已在 main 才 ff-only；`sync` rebase 前自动 stash，冲突结构化返回。

### 4.4 Git 检查点 — git-checkpoint-service
- **功能**：为对话线程提供快照/回滚（恢复到某轮对话前），是**安全防护最重的服务之一**。
- **IPC**：`git:checkpoint:create`、`git:checkpoint:restore`。
- **快照内容**：落 `{dataDir}/git-checkpoints/<id>/`，含 `head.bundle`（HEAD 提交离线保存）、`unstaged.patch`/`staged.patch`（--binary）、`untracked/`（逐个拷贝）、`metadata.json`。创建前 `assertNoUnmerged` 拒带冲突仓库。
- **恢复多重安全**：① **忙碌守卫**——破坏性 reset/clean 前查 `GET /v1/threads`，任一 running 即拒绝，查询失败 fail-closed；② **救援检查点**——恢复前先自动建 `:rollback-rescue`；③ 目标解析（HEAD 不在则从 bundle unbundle）；④ **路径越界防护** `resolvePathWithinRepository`（词法检查拒 `..`/绝对路径/空字节 + realpath 检查防符号链接导向仓库外）。
- **过期清理**：`cleanupUnusedGitCheckpointsIfDue` 扫描被引用的 workspaceCheckpointId 删无引用目录（10 分钟 grace 窗口）。

---

## 5. 工作区文件服务（workspace-service 聚合）

`workspace-service.ts` 仅 `export *` 重导出三个子模块。

### 5.1 路径解析与边界 — workspace-paths
- **功能**：所有工作区文件操作地基。`expandHomePath`、`normalizeUserPath`、`resolveTargetPathWithinWorkspace`/`resolveOpenTargetPath`/`enforceWorkspaceBoundary`。
- **特征**：realpath 规范化后判 isWithinWorkspace，越界直接抛错；`resolveOpenTargetPath` 支持 basename 模糊匹配（跳过 `.git/node_modules/dist`）；`validateEntryName` 拒路径分隔符。

### 5.2 文件读写与剪贴板图片 — workspace-files
- **IPC**：`file:list-workspace-directory`、`file:read-workspace`、`file:read-workspace-image`、`file:read-workspace-pdf`、`file:write-workspace`、`file:create-workspace`、`file:create-workspace-directory`、`file:save-workspace-clipboard-image`、`clipboard:read-image`、`file:rename-workspace-entry`、`file:delete-workspace-entry`、`file:resolve-workspace`，及 `file:watch-workspace`/`file:unwatch-workspace`（fs.watch + 90ms 去抖）。
- **特征**：读文件体积上限（预览 1.5MB/图片 12MB/PDF 64MB），前 N 字节探测 `\0` 判二进制拒预览；剪贴板图片落 tmp/kun 与工作区 img/，禁删工作区根。

### 5.3 外部编辑器集成 — workspace-editors
- **IPC**：`editor:list`、`editor:open-path`、`shell:open-external`。
- **功能**：维护编辑器候选表（VS Code/Cursor/Windsurf/Antigravity），跨平台探测命令/路径/图标，按各编辑器行号跳转语法打开指定文件位置。

---

## 6. Skill（技能）管理

### 6.1 Skill 发现与列举 — skill-service
- **IPC**：`skill:list`、`skill:list-roots`、`skill:open-root`。
- **特征**：根目录候选 = 项目级公共目录 + 全局公共目录 + 用户 extraDirs + Codex 插件缓存（`~/.codex/plugins/cache/**`）；技能包识别 `skill.json` 或 `SKILL.md`（frontmatter 解析）；**路径遍历防护** `assertSafeEntryName`（entry 必须纯文件名）；id 用 NFKC + slug 去重。

### 6.2 Skill 落盘 — skill-save-service
- **IPC**：`skill:save-file`。`normalizeSkillFolderName` 拒路径分隔符，只在根目录一层创建。

### 6.3 从 GitHub 导入 Skill — github-skill-import-service
- **IPC**：`skill:import-github`。委托 `shared/github-skill-import` 拉取解析，逐个 `saveGuiSkillPackage` 写入；返回数量/名称/路径。

---

## 7. UI 插件（形象工坊，P2 后删除 / 历史参考）

> P2 删除 `ui-plugin-service`、`ui-plugin-bundled`、`src/shared/ui-plugin.ts` 以及 `ui-plugin:list/install/remove/load` IPC。以下内容仅说明原 Kun 基线机制，不再作为 Claude360 Copilot 目标能力。

### 7.1 UI 插件落盘服务 — ui-plugin-service
- **IPC**：`ui-plugin:list/install/remove/load`。
- **安全特征**：安装**白名单复制**（只复制 manifest.json 与 figures 引用的图片，脚本不进数据目录）；`confinedPluginPath` 强制路径落 plugins 根内；目录名须与 manifest id 一致；单图/总图/manifest 体积上限。

### 7.2 预装插件播种 — ui-plugin-bundled
- 首次启动把官方示例「iKun 模式」种到 `~/.kun/ui-plugins/ikun/`，用 `.bundled-seed-v1` 标记保证只播种一次。

### 7.3 原型嵌入授权 — prototype-embed-registry
- **功能**：为内嵌原型预览 webview 做授权闸门。渲染层请求授权某 `.html` 路径，主进程校验（工作区包含 + 符号链接规范化 + 含 `proto` 目录段 + `.html` 扩展）通过后记录 `file://` URL，webview 守卫据此放行。
- **IPC**：`write:authorize-prototype`、`write:open-prototype`。授权集上限 256（LRU）。

---

## 8. 语音转写（本地 Whisper + 云端 ASR）

### 8.1 转写调度 — speech-to-text-service
- **功能**：统一入口，按协议分发：`local-whisper` 本地、`mimo-asr` 小米 MiMo（OpenAI 兼容、音频作 input_audio）、其余标准 OpenAI `audio/transcriptions` multipart。
- **IPC**：`speech:transcribe`。base64 体积上限、按 timeoutMs 超时、错误归类。

### 8.2 本地 Whisper 模型管理 — local-whisper-service
- **IPC**：`speech:local-whisper:status/download/cancel/sources/delete`；进度 `speech:local-whisper:progress`。
- **特征**：模型落 `userData/models/speech/whisper/<id>/`，下载到 `.download` 临时文件后**严格校验**（大小匹配 + SHA-256 一致）才 rename 到位；连接超时 20s + 停滞超时 30s，可取消；多下载源；转写时把 base64 写临时 wav 调 `whisper-cli`（环境变量 `KUN_WHISPER_CLI` 或内置 `resources/whisper/<platform>-<arch>/`），临时文件 finally 清理。

---

## 9. Write 模式本地服务（导出 / 信息图 / 行内补全 / RAG / PDF）

### 9.1 文档导出 — write-export-service
- **功能**：把 Markdown/纯文本导出为 HTML/DOC/DOCX/PDF，或富文本复制到剪贴板。
- **IPC**：`write:export`、`write:copy-rich-text`。
- **特征**：服务端用 `react-markdown + remark-gfm + renderToStaticMarkup` 渲染带内置 CSS 的 HTML（A4），本地图片转 data URI 内联；DOCX 走 `html-to-docx`；**PDF 用隐藏沙箱化 BrowserWindow 加载临时 HTML、等字体图片加载后 printToPDF**，完成后销毁清理。

### 9.2 信息图/设计稿生成 — write-infographic-service
- **功能**：把选中文本经图像生成模型转信息图（3:4）或设计草稿（4:3），落工作区 img/ 返回相对 Markdown 路径。
- **IPC**：`write:generate-infographic`。文档与参考图须在工作区内；参考图限 10MB 且 png/jpeg/webp；有参考图走 `client.edit` 否则 `client.generate`。

### 9.3 行内补全 — write-inline-completion-service
- **功能**：Write 编辑器「幽灵文本」行内补全/局部改写引擎。
- **IPC**：`write:inline-completion`、调试 `write:inline-completion-debug:list/clear`。
- **特征**：三模式 `short`/`long`/`edit`，用 `<<<SHORT/LONG/EDIT ...>>>` 标记块协议并清洗弱模型标记汤；多端点适配（OpenAI chat/Responses/Anthropic/DeepSeek FIM/自定义）；12s 超时；经 `fetchWithOptionalProxy` 支持代理；调用 RAG 注入工作区片段。

### 9.4 PDF 取文 — write-pdf-text-service
- **功能**：用 `pdfjs-dist`（禁 worker、Node polyfill DOMMatrix/ImageData/Path2D）提取 PDF 文本。
- **IPC**：`file:read-local-pdf-text`。上限 64MB/300 页/100 万字符，按 `path:size:mtime` LRU 缓存（上限 32）。

### 9.5 工作区检索（RAG/BM25）— write-retrieval-service
- **功能**：对工作区文档建轻量倒排索引 + BM25 + 关键词加权检索，为行内补全和 Write 助手提供本地知识片段。
- **IPC**：`write:retrieve-context`。
- **特征**：索引预算严格（行内补全 250ms/助手 2.5s，最多扫 8000 条目/160 文件/单文件 600KB/720 chunks）；分词支持拉丁词 + 中文 n-gram（2–4 gram）带停用词；BM25（k1=1.2,b=0.72）+ 标题/路径命中加权 + 短语命中加成；索引 30s TTL 缓存 + in-flight 去重。

---

## 10. 计算机使用权限 — computer-use-permissions

- **功能**：管理 macOS 上 computer_use 需要的辅助功能（键鼠注入）与屏幕录制（截图）权限。
- **IPC**：`computer-use:permissions`（只读查询）、`computer-use:request-permission`（申请并打开系统设置）。
- **特征**：非 macOS 直接返回「无需权限」；macOS 区分实时信任与设置库状态，给出 `accessibilityNeedsRestart` 提示；原生模块懒加载，缺失时优雅降级。

---

## 11. 遗留会话导入 — legacy-session-import-service

- **功能**：把「DeepSeek GUI」时代遗留会话目录导入当前 Kun 数据目录（新旧磁盘格式一致，本质只是拷贝线程目录）。
- **IPC**：`kun:sessions:detect-legacy`、`kun:sessions:import-legacy`、`kun:sessions:pick-source-dir`。
- **约束（幂等/非破坏）**：自动检测 `~/.deepseekgui/kun/threads` 与 `~/.deepseekgui/coreagent/threads`；按目录名去重，已存在线程跳过不覆盖；拷贝而非移动；单线程失败被吞并计入 skipped。

---

## 12. 主进程顶层其它能力（index.ts 内联）

- **设置存储**：`settings-store.ts`（JsonSettingsStore 落 userData）+ `applySettingsPatch`（深度归一化/合并、校验端口、按需重配日志/托盘/登录项/检查点清理，触发各 runtime sync）。
- **托盘**：Tray + tray-session-menu，菜单列近期线程/新建/退出。
- **窗口关闭策略**：`promptWindowCloseAction`（最小化到托盘/退出）。
- **桌面命令**：`desktop:command`（undo/redo/cut/copy/paste/zoom/devtools/窗口控制）。
- **GUI 自动更新**：`gui-updater.ts`（electron-updater + 自建 R2 feed，域名 kun-agent.com 优先、deepseek-gui.com legacy 兜底）；IPC `gui:update-state/check/download/install`；安装前 stopManagedRuntimesForQuit。
- **Claude 订阅与 Agent SDK**：`claude-subscription:status/login/models/sdk-status/sdk-install`，Claude Code 二进制（~222MB）按需下载到 `userData/agent-sdk`。
- **上游模型与 provider 探测**：`upstream:models`、`provider:probe`。
- **通知**：`notification:turn-complete`。
- **日志**：`logger.ts` + `log:error/get-path/open-dir`。
- **Kun MCP 配置文件**：`kun:config:read/write/open-dir`（写入前 validateMcpConfigContent 校验，写后触发运行时重配）。
- **代理工具**：`proxy-fetch.ts`（fetchWithOptionalProxy）。

> 说明：Claw/IM、Schedule、Workflow、Weixin/Telegram/Feishu 等自动化/IM 桥接运行时（`claw-runtime.ts`、`schedule-runtime.ts`、`workflow-runtime.ts` 等）同样运行在主进程，由 `app.whenReady` 内创建并随设置 sync、退出时统一 stop，与本章本地服务共享 store/runtimeRequest/logError 与 IPC 校验机制。

---

## 工程要点总结

- **输入边界防线统一且严格**：所有 IPC 经 Zod `.strict()` 校验，`runtime:request` 额外端点白名单 refine。
- **安全防护最重的两点**：git-checkpoint-service（恢复前忙碌守卫 + 救援检查点 + 双重路径越界防护）与 prototype-embed-registry/webview 守卫（默认拒绝、仅放行授权过的 `proto/*.html`）。
- **运行时托管自愈**：健康看门狗、卡死子进程原地重启、重启前等轮次空闲三层自愈（规避重启风暴 #544/#621）。
- **本地离线能力齐全**：本地 Whisper（SHA-256 双校验 + 多镜像）、PDF 取文（pdfjs）、BM25 工作区 RAG（拉丁词 + 中文 n-gram）、隐藏窗口 printToPDF 导出。
