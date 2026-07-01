# 07 · GUI · 自动化、扩展与设置

> 范围：`components/workflow`、`schedule`、`mcp`、`settings-section-*`、`chat/ConnectPhoneView`、`PluginMarketplaceView`、`InitialSetupDialog`、`store/{chat-store-claw-actions,ui-plugin-store}`（`ui-plugin-store` 为 P2 后删除项）
> 参考：`docs/workflow-loop.md`、`docs/UI_PLUGINS.md`（P2 后删除，仅历史参考）、`docs/model-provider-presets.md`

> **版本边界**：本章描述原 Kun 基线能力。形象工坊、UI 插件、Retroma、iKun 在 P2 后删除；相关段落仅作历史参考。

覆盖「可视化工作流 Loop / 定时任务 / IM 远程入口(claw) / MCP 管理 / 设置中心 / 插件市场 / 初始设置向导 / 媒体生成」八大功能域。

## 一、可视化工作流 Loop（节点式编排画布）

工作流体系基于 `@xyflow/react`（React Flow），产品里把「一整个工作流」称为「创建 Loop」。

### 1.1 工作流列表与生命周期
- **入口**：`WorkflowView`（顶部「创建 Loop / Workflows」）。
- **机制**：
  - 列表卡片显示节点数、上次运行时间、状态徽标（idle/running/success/error）、上次结果（>240 字截断）。
  - 每个工作流两开关：**启用**（enabled）、**作为工具供 Agent 调用**（callableByAgent，需先启用）。
  - 运行 `runWorkflow(id, input)`；manual-trigger 定义 inputSchema 时弹 RunInputDialog 表单（text/number/boolean/paragraph/json/select 字段，含必填校验）。停止 stopWorkflow(id)。
  - 单节点运行 runWorkflowNode(workflowId, nodeId)。
  - 轮询 getWorkflowStatus()：运行中 1.2s、空闲 5s。
  - 导入/导出 DSL（serializeWorkflowDsl/parseWorkflowDsl，文件名 `*.loop.json`），导入去重命名并重指向自引用节点 ID。

### 1.2 编辑器画布与节点面板
- **入口**：`WorkflowEditorView`（全屏覆盖层）。
- **机制**：
  - **左侧调色板**按组分类（WORKFLOW_PALETTE_GROUPS：trigger/ai/flow/data/action）可折叠 + 「自定义」组（模块 + 预设）。点击或拖拽（DnD MIME `application/x-workflow-node`/`-preset`/`-module`）插入。
  - **n8n 式连线插入**：从输出端口拖到空白触发 connectMenu 选下一节点自动建边。
  - 顶部：工作流名、enabled、运行历史、**环境变量**（EnvVarsModal）、保存、运行/停止。
  - **环境变量**：工作流级 WorkflowEnvVarV1[]（string/number/boolean/secret），节点内 `{{$env.key}}` 引用，secret 历史脱敏。

### 1.3 节点类型全集（25 种）

| 分组 | 节点 | 关键配置 |
|---|---|---|
| 触发器 | **manual-trigger** | workspaceRoot、inputSchema、本地 curl 示例 |
| | **schedule-trigger** | schedule.kind（manual/interval/daily/at/cron）+ 参数 |
| | **webhook-trigger** | method、path、URL `http://127.0.0.1:{webhookPort}{path}` |
| AI | **ai-agent** | prompt、providerId/model、reasoningEffort、mode=agent |
| | **generate-image** | prompt、image 能力供应商/model、size、outputDir |
| | **parameter-extractor** | source、instruction、fields(typed schema)、模型 |
| 流程 | **condition** | leftExpr/operator/rightValue；双输出 true/false |
| | **switch** | rules[] + fallback；多输出端口 |
| | **question-classifier** | source/instruction/categories[]/模型；每分类一输出端口 |
| | **filter** | 条件过滤数组 |
| | **merge** | mode=array/object |
| | **loop** | 循环节点（见 1.4） |
| | **human-approval** | title/instruction/timeoutMs/onTimeout；双端口 approved/rejected |
| 数据 | **set-fields** | fields[]、keepIncoming |
| | **template** | template(`{{}}`)、outputMode=text/json |
| | **json** | mode=parse/stringify、strict |
| | **code** | language=javascript/python/bash、防抖语法检查 |
| | **sort** | field/order/numeric |
| | **limit** | count、from=first/last |
| | **aggregate** | mode=count/sum/collect/join |
| 动作 | **http-request** | method/url/headers/body/timeoutMs/parseJson |
| | **subworkflow** | workflowId（跑一次别的工作流） |
| | **delay** | delayMs |
| | **output** | mode=auto/text/json、textTemplate、jsonPath（无输出端口） |
| 自定义 | **custom** | 绑定 moduleId + 用户脚本字段值 |

### 1.4 Loop（循环）节点 —— 自走 Agent
- **入口**：flow 组「循环」节点。
- **机制**（NodeConfigPanel loop 分支）：
  - **workflowId**：循环体。
  - **mode**：`condition`（条件循环 / loop-agent，上轮 output→下轮 payload，停止条件默认 `json.done equals true`，输出含 `_iterations`/`_done`）；`foreach`（遍历数组，arraySource 表达式，execution sequential/parallel，并行 concurrency 1–8 默认 4 保序，continueOnError）。
  - **maxIterations**：1–100，默认 10（硬顶刹车）。
  - 循环体内可用 `{{$loop.index}}`/`{{$loop.item}}`/`{{$loop.total}}`。
  - 护栏：嵌套深度 ≤5、整轮看门狗 + 节点执行次数上限 200。

### 1.5 节点配置面板（NodeConfigPanel）
- **机制**：
  - **输入绑定**（InputBindingsEditor，Dify 风格）：为节点命名上游输出，节点内 `{{$input.key}}` 引用；源选择来自可达上游节点 typed 输出字段。
  - **变量选择器**（VariablePicker，`{ }` 按钮）：级联 typed 变量树，列出 `{{text}}`/`{{json.}}`/`{{$input.}}`/`{{$env.}}`/`{{$run.}}` + 各上游节点字段，点击插入 token。
  - **悬空引用检测**（collectDanglingRefs）：节点重命名/删除后 `{{$nodes…}}` 失效时顶部黄色告警。
  - **错误处理**（非 trigger 节点）：onError=fail/continue/fallback、retries（0–10）、retryDelayMs、fallbackJson。
  - **单节点测试**（TestNodeDialog）：mock JSON → testWorkflowNode 隔离运行。
  - **存为预设**（onSavePreset）。

### 1.6 自定义模块管理（ModuleManager）
- **入口**：调色板「自定义」组齿轮按钮。
- **机制**：name/description/language(js/python/bash)/字段 schema(key/label/type/defaultValue/options)/code（js 用 `$fields`/`return`，命令行用 `WORKFLOW_FIELDS` 环境变量），防抖语法检查；字段在 custom 节点自动生成表单（CustomNodeForm）。

### 1.7 运行历史与运行日志
- **运行历史**（WorkflowRunHistory）：左侧运行列表，右侧逐节点结果折叠（error/message/inputJson/outputJson/threadId/重试徽标）。
- **运行日志面板**（WorkflowRunLogPanel）：按执行顺序流式显示，运行中节点 spinner；可嵌入聊天运行抽屉。

### 1.8 Agent 钩子触发器（反应式自动化）
- **入口**：WorkflowView 顶部「工作流钩子」→ WorkflowHookTriggers 弹窗。
- **机制**：每条触发器 enabled、phase（WORKFLOW_HOOK_PHASES 如 PreToolUse/PostToolUse）、workflowId、mode（observe 等）+ 工具阶段额外配 toolNames（如 `write, edit`）；默认新建 PostToolUse + `['write','edit']` + observe；底部「防递归」说明（触发器的 loop 运行时其工具调用不再触发钩子）。

---

## 二、定时任务（Schedule）

- **入口**：`ScheduleTasksView`。

### 2.1 任务列表与运行
- 轮询 getScheduleStatus()（5s）；筛选 all/enabled/running/done（按 nextRunAt 排序）。
- **保持唤醒**（keepAwake）开关：阻止系统休眠。
- 任务卡片：状态徽标、调度摘要、下次/上次运行、claw 标签、`供应商/模型 · 推理强度`；操作：打开上次会话线程、立即运行、编辑、删除、启用开关。

### 2.2 任务编辑对话框（ScheduleTaskDialog）四节
1. **内容**：标题（≤50）、prompt（≤8000）。
2. **模型**：客户端模式 clientMode（code 本地 Agent / im 绑定 claw IM 渠道）；供应商 + 模型（仅文本对话能力）、推理强度（按模型 profile 过滤）。
3. **时间**：kind = daily（时:分）/ at（datetime-local，过去时校验失败）/ interval（everyMinutes 1–10080）/ manual。
4. **环境**：工作区、启用开关、优先级（0–100）、**worktree 隔离**（useWorktree）、**任务依赖**（dependsOn 多选）。
- 校验 validateScheduledTaskDraft。

### 2.3 全局默认（ScheduleDefaultsDialog）
- 全局 enabled、默认供应商/模型、默认工作区、**promptPrefix**（所有任务 prompt 前缀）、默认技能 skills.defaultNames、额外技能目录 skills.extraDirs。

---

## 三、IM 远程入口与连接手机（claw）

claw = 把手机/IM 当远程入口让 Agent 远程干活。支持 **飞书 / Lark / 微信 / Telegram**。

### 3.1 连接手机视图（ConnectPhoneView）
- **入口**：ConnectPhoneView + ConnectPhoneSidebarPanel。
- **机制**：顶部四目标切换 `CONNECT_PHONE_TARGETS = [feishu, lark, weixin, telegram]`。
  - **飞书/Lark/微信**：扫码安装 startClawImInstallQr(provider, {isLark}) → 二维码 + 倒计时 + 用户码 → pollClawImInstall 轮询 → 完成后 createConnectPhoneCredential 构造凭据 → onAddProvider 写入渠道。含过期/失败重试、已连接拦截。
  - **Telegram**：不走扫码，引导去设置页填 Bot Token。
  - 侧栏面板额外：渠道列表（含最近会话 senderName/chatId）、断开渠道。

### 3.2 claw store actions（渠道与会话管理）
- **机制**（chat-store-claw-actions.ts）：createClawActions 暴露 refreshClawChannels/addClawChannel（同 provider 去重）/selectClawChannel/selectClawConversation/deleteClawChannel/resetClawChannelSession（新建线程迁移会话映射）/setClawChannelModel；渠道与本地会话线程映射；可恢复线程查找（按 `[Claw:…]` 标题前缀）。渠道结构 ClawImChannelV1：provider/label/model/workspaceRoot/enabled/agentProfile/platformCredential/conversations[]/feishuStream。

### 3.3 claw 设置区块（settings-section-claw）
- **入口**：设置 → claw（手机）。
- **机制**：运行时（claw.enabled 总开关、默认工作区）；**Telegram 连接卡**（4 步引导 + Bot Token + 允许的 chatId → connectTelegramBot）；**管理 Agent**：每渠道折叠面板含启用开关、（飞书）流式开关、Telegram 凭据编辑、Agent 名、claw 模型、工作区覆盖、Agent 画像字段（description/identity/personality/userContext/replyRules）。

---

## 四、MCP 管理（MCP 服务器配置 UI）

- **功能**：结构化编辑 `~/.kun/mcp.json`。
- **入口**：嵌入设置（agents/general 区块 MCP 卡）与插件市场，组件 McpServersEditor。
- **机制**：
  - **双模式**：表单模式（McpServerCard 列表）与原始 JSON 文本模式；JSON 不可解析时强制原始模式。
  - **每个服务器**：name、transport（stdio/streamable-http/sse）、enabled；stdio 配 command/cwd/args/env；http/sse 配 url（校验 http/https）/headers；信任范围 trustScope=user/workspace（workspace 时必填 trustedWorkspaceRoots）、timeoutMs、可见工作区根 workspaceRoots。
  - **校验**（validateMcpServers）：name 必填/去重、stdio command 必填、http url 合法、workspace 信任根非空。
  - **解析容错**（parseMcpConfigText）：兼容 Claude Desktop/Cursor 的 `mcpServers` 键与 `type` 字段。
> 工具发现/连接诊断 overlay（offline/disabled/configured/connected/drift/error、工具数、搜索索引）由 plugin-marketplace-runtime.ts 的 buildMcpMarketplaceOverlay 聚合。

---

## 五、设置中心（逐区块）

- **入口**：`SettingsView`（约 1219 行核心调度）+ SettingsSidebar（16 分类导航）。各区块除 general 外均 lazy 加载。

### 5.1 general（通用）
- **通用卡**：语言（en/zh）、主题（system/light/dark）、UI 字体缩放、对话内容最大宽度、工作区根、会话工作区根、**光标聚光灯**（开关 + 取色器 + 色阶）。
- **桌面行为卡**：开机自启（win/darwin）、启动最小化、关闭行为（ask/tray/quit）、回合完成通知。
- **新手引导预览卡**、**旧版会话导入卡**、**Git 检查点卡**（自动清理 + 周期）、**日志卡**（开关 + 保留天数 + 目录）。

### 5.2 providers（供应商）
- 支持：添加空白自定义供应商、添加预设供应商（MODEL_PROVIDER_PRESETS：DeepSeek/Xiaomi/MiniMax/Vercel AI Gateway/Zhipu/Z.ai/Kimi Code/Moonshot CN/Global）、选为活动 Kun 供应商。
- 每个供应商：apiKey、baseUrl、端点格式（OpenAI Chat/Responses、Anthropic Messages）、models[]、modelProfiles（reasoning supportedEfforts/defaultEfforts、是否文本/图片对话模型）。
- 可选生成能力：image/speech/music/video，tokenPlan（订阅计划，单独 providerId 后缀）。

### 5.3 write（写作）
- 写作工作区根；排版卡（字体预设/字号/行高）；内联补全卡（writeInlineCompletion：启用、供应商/模型继承、baseUrl/maxTokens）；选区辅助卡；Agent 预设卡；调试日志卡。

### 5.4 mediaGeneration（媒体生成，含 image）
- 聚合「图片生成 + 语音合成 TTS + 音乐生成 + 视频生成」四卡（见第九章）。

### 5.5 speechToText（语音转文本）
- 启用开关（首开自动选本地 Whisper）；供应商：本地 Whisper / 配置过 speech 能力的供应商 / 自定义（协议 openai/mimo-asr、baseUrl/apiKey/model）。
- **本地 Whisper**：下载源选择（含连通性探测）、模型列表（文件大小/内存/CPU线程/质量档/下载状态）、下载/取消/删除（含进度订阅）。
- 语言（auto/zh/en/ja/ko + 自定义）、高级超时、**测试**（合成 0.5s 440Hz 正弦音验证链路）。

### 5.6 agents（智能体 + 权限）8 张卡
1. **agents**：autoStart、kun 供应商/模型、codePromptPrefix、高级（端口/二进制/数据目录/runtimeToken/kunInsecure/token 经济）。
2. **permissions**：工具权限模式单选卡组（KUN_TOOL_PERMISSION_MODES：always-ask/read-only/sensitive-ask/workspace-write/bypass）。
3. **computerUse**（电脑操作）：启用 + mode（auto/always/off）+ 权限行 + 模型质量提示。
4. **designQuality**（设计质量）：启用 + 严格度（relaxed/standard/strict）。
5. **skill**（技能）：检测目录、权限来源、扫描目录、技能动作。
6. **mcp**：MCP 搜索开关 + 高级（搜索模式/限制），内嵌 McpServersEditor。
7. **kunAdvanced**、8. **kunDiagnostics**。

### 5.7 其它区块
- **archives**：按工作区分组列归档会话，支持打开/恢复/删除。
- **worktree**：列 git 分支 worktree，支持移除。
- **memory**：记忆总开关；概览（活跃/墓碑/启用）；按 scope 筛选；增/查/禁用/删；最近注入记录 ID。
- **shortcuts**：搜索 + 逐命令重绑（捕获键盘事件、冲突检测、按平台解析、重置）。
- **easterEgg（形象工坊，P2 后删除）**：内置「默认 Kun」卡（含 Retroma 羊皮纸配色）+ 已安装 UI 插件卡（含预装 iKun），激活/删除/安装文件夹。该区块为原 Kun 基线能力，P2 后不再保留。
- **updates**：更新通道（frontier/stable）、GuiUpdateControl（检查/下载/安装）。
- **terminal**：颜色模式（native/none/custom）；custom 编辑 4 表面色 + 16 ANSI 色。
- **debug**：LlmDebugSettingsSection。

---

## 六、UI 插件（形象工坊扩展机制，P2 后删除 / 历史参考）

> P2 删除 UI 插件 store、IPC、预装 iKun、Retroma 配色和 `docs/UI_PLUGINS.md`。以下内容仅用于解释原代码，不作为后续目标态。

- **功能**：纯声明式吉祥物形象包，无代码执行，换掉工作台泳动鸟、状态形象、彩蛋、完成庆祝、主题色 token、进行中文案。
- **机制**（docs/UI_PLUGINS.md）：
  - 一个插件 = 一个文件夹（manifest.json + 图片），安装白名单复制到 `~/.kun/ui-plugins/<id>/`。
  - manifest：id（保留字限制）、name/version/author、figures（swim/surf/greet/sleep/sit/run/toggleIcon 槽位含回退链）、labels（zh/en 文案）、tokens（`--ds-*` 白名单主题色）、features.cameos。
  - 安全：无 JS/CSS、路径禁 `..`/绝对路径、图片经主进程读后 data URL 注入、token 锚定 `html[data-ui-plugin='<id>']`。
  - 运行时（ui-plugin-store.ts）：单一 uiMode（default/retroma/ikun/插件 id），管理 DOM 属性/token 样式/图集加载；installUiPluginFromDialog/removeUiPluginById/activateUiMode/loadUiPlugin。iKun 是预装示例（首启自动安装）。

---

## 七、插件市场（PluginMarketplaceView）

> 注意：插件市场（MCP + Skill）与第六章「形象工坊」（UI 插件）是两套独立体系；P2 后仅保留插件市场，不保留 UI 形象插件。

- **功能**：安装 MCP 服务器 / Agent 技能（Skill），含推荐目录、自定义添加、GitHub 导入、OAuth 连接器。
- **入口**：PluginMarketplaceView（约 2078 行）。
- **机制**：
  - **双 Tab**：MCP / Skill；筛选 all/recommended/installed。本地已安装记录存浏览器存储 `kun.installedPlugins`。
  - **推荐目录**（RECOMMENDED_ITEMS）：MCP（gui_schedule 系统托管、playwright、github、context7、sequential-thinking、memory、brave-search 等 stdio npx；vercel、google-workspace OAuth 远程，强制 https，安装前弹 OAuth 预览，docs URL 白名单）；Skill（code-review、frontend-polish、bug-hunt、release-notes 等内置 skillInstructions）。
  - **安装 MCP**（installMcpItem→appendMcpConfig）：buildStdioMcpServer/buildRemoteMcpServer（远程强制 https），mergeMcpJsonConfig 合并进 mcp.json（已存在跳过）。
  - **安装 Skill**：buildSkillContent 生成 frontmatter + 正文，saveSkillFile(rootPath, id, content) 写入。
  - **启停**：toggleMcpEnabled（改 mcp.json enabled）、toggleSkillEnabled（改 disabledSkillIds，同步 chat store）。
  - **自定义添加**：MCP 填命令/args 或原始 JSON 片段（校验 https）；Skill 填名/描述/正文。
  - **GitHub 导入**：importSkillsFromGitHub(rootPath, url) 批量导入。
  - **技能根选择**：skillRootOptionsFromRoots（与设置页同源），按 project/global 作用域。

---

## 八、初始设置向导（InitialSetupDialog）

- **功能**：首启/重看引导，配置主题、模型供应商凭据、工具权限，并自动联动语音/图像能力。
- **入口**：首次启动弹出，general 区块「新手引导预览」可重开。
- **机制**：
  - **主题**：system/light/dark（即时 applyTheme）。
  - **供应商卡**：DeepSeek（默认）+ Xiaomi + MiniMax 预设（INITIAL_SETUP_PROVIDER_PRESETS 仅这三个）。每卡选 access 模式 api/token-plan，填 apiKey/baseUrl。
  - **工具权限**：PERMISSION_OPTIONS（always-ask/read-only/sensitive-ask/workspace-write/bypass，带图标描述）。
  - **保存逻辑**（initial-setup-save.ts / buildInitialSetupSettings）：为每个填了 key 的草稿 upsert profile（upsertPresetProfile 合并已有），激活选中 profile；**自动联动**（initialSetupAutoWirePlan）：仅当语音/图像能力尚未配置时把它们指向刚配好且具该能力的付费 profile 或 token-plan，不覆盖用户已有选择；权限模式仅在用户实际改动选择器时才重写。

---

## 九、媒体生成（图像 / 语音合成 / 音乐 / 视频）

- **入口**：设置 → mediaGeneration（MediaGenerationSettingsSection 聚合四卡）。
- **机制**：每能力独立 enabled，供应商可选「配置过该能力的供应商」或「自定义」（CUSTOM_*_PROVIDER_ID）。自定义填协议/baseUrl/apiKey/model；选供应商则运行时用供应商凭据覆盖。
  - **图像生成**：协议（openai/minimax-image）、默认尺寸（1024x1024）、超时（10s–600s）。工作流 generate-image 节点复用此能力。
  - **语音合成 TTS**：协议（openai/minimax-t2a/mimo-tts）、voice、音频格式（mp3/wav/flac）、超时（10s–900s）。
  - **音乐生成**：协议（minimax 等）、格式、超时（10s–1800s）。
  - **视频生成**：协议（minimax 等）、默认时长（1–30s）、默认分辨率（768P/1080P）、超时（30s–3600s）、轮询间隔 pollIntervalMs。
  - 缺供应商 apiKey 时显示黄色告警。
- **通用控件**（settings-controls.tsx）：ModelSelect/SecretInput/Toggle/SettingRow。
