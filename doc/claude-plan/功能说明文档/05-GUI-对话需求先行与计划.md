# 05 · GUI · Code 对话、需求先行与计划

> 范围：`src/renderer/src/agent/`、`store/`、`sdd/`、`plan/`、`components/chat|sdd|plan|todo|subagents`、`ChangeInspector.tsx`、`DiffView.tsx`、`Workbench.tsx`

整体数据流：渲染端 `agent/` 层把 GUI 操作映射成 kun 运行时 HTTP/SSE 调用，`store/chat-store-*` 切片维护会话状态，`sdd/`、`plan/` 在其上叠加需求先行与计划 Todo 闭环，`components/` 渲染成工作台 UI。

## 一、对话工作台（Code Workspace）

### 1.1 渲染端与 kun 运行时的对接（agent/ 层）

**【功能】** 把 GUI 对话操作统一映射成 kun 运行时 HTTP 请求 + SSE 事件流。

**【机制】**
- **运行时客户端** `runtime-client.ts`：单例 `rendererRuntimeClient` 封装 `window.kunGui`：`runtimeRequest(path, method, body)` 走 HTTP；`startSse/stopSse/onSseEvent/onSseEnd/onSseError` 走 SSE；`getSettings/setSettings` 带内存缓存与 invalidateSettings。
- **Provider 抽象** `types.ts`：`AgentProvider` 接口（id:'kun'）罗列全部能力（listThreads/createThread/getThreadDetail/sendUserMessage/reviewThread/rewindThread/forkThread/compactThread/interruptTurn/steerUserMessage、goal/todos、approval/user-input、memory/attachment/skill）。`registry.ts` 惰性缓存 `KunRuntimeProvider` 单例。
- **Provider 实现** `kun-runtime.ts`：每方法对应一个运行时端点；`getCapabilities()` 返回 `{interrupt, stream, approvals, attachFiles, review}` 全开；`subscribeThreadEvents` 是核心：创建 streamId，批量接收 SSE，提取 maxSeq 回灌 `sink.onSeq`，交给 `dispatchKunRuntimeEvents`；审批 `handleApprovalRequest` 端侧自动放行（auto→allow、never→deny），仅 on-request/suggest/untrusted/always 才弹审批卡。
- **契约层** `kun-contract.ts`：定义全部 Core DTO（CoreThreadJson、CoreTurnItemJson、CoreRuntimeEventJson、CoreReviewOutputJson、CorePlanToolResultJson、CoreThreadTodoListJson、CoreThreadGoalJson、能力清单含 subagents/attachments/memory/imageGen）。`CORE_PLAN_TOOL_NAME = create_plan`。
- **事件映射** `kun-mapper.ts`：`chatBlockFromItem` 把 turn item 映射为 `ChatBlock`（user/assistant/reasoning/tool/approval/user_input/compaction/review/system）；`dispatchKunRuntimeEvents` 把连续 delta 合并成一次 `sink.onDeltas`，其余事件逐一派发；工具块据 toolName/toolKind 推断类型并提取命令元数据/Web 来源/生成文件/子Agent child 元数据；`create_plan` 特判为 plan 块抽 `meta.plan`；系统错误经 redactSecrets 脱敏。
- **耗时统计** `thread-timing.ts`：`buildTurnDurationByUserId` 用 started_at/ended_at 还原每个用户消息对应回合耗时。

**【关键文件】** `src/renderer/src/agent/{runtime-client,types,registry,kun-runtime,kun-contract,kun-mapper,thread-timing}.ts`

### 1.2 会话状态管理（store/ 各切片）

**【功能】** 用 zustand 单 store `useChatStore` 聚合会话全状态与全部动作；按职责切成多切片。

**【机制】** `chat-store.ts` 注入初始状态与各切片，持有模块级 `sseAbortRef`。逐切片职责：
- **app 切片**：路由切换（openCode/openWrite/openSettings/openPlugins/openClaw/openSchedule/openWorkflow）、Composer 模型/模式/Agent 选择（setComposerMode 'plan'|'agent'）、UI 主题/字号/排版、i18n。
- **navigation 切片**：boot、probeRuntime（含 restart）、工作区选择、refreshThreads（filterThreadsForSidebar 过滤）、selectThread（先 HTTP getThreadDetail 再开 SSE）与 subscribeThreadEventsLive（跳过 HTTP 直开 SSE，用于 claw 自动切线程）、recoverActiveTurn。
- **thread-actions 切片**：createThread/createConversation、sendMessage、drainQueuedMessages、reviewActiveThread。`sendMessage` 处理 busy/排队（guiPlan 消息不可排队）、乐观插入用户块、首条自动命名、附件/文件引用/checkpoint，通过 buildThreadEventSink + subscribeThreadEventsWithRecovery 建立带断流恢复的订阅。
- **maintenance 切片**：renameThread/pinThread/archiveThread/deleteThread、compactActiveThread、forkActiveThread/forkThreadFromTurn、goal 读写、setActiveThreadTodoStatus/clearActiveThreadTodos/syncPlanTodosFromMarkdown、rewindAndResend、rollbackWorkspaceToCheckpoint、resolveApproval/resolveUserInput/interrupt、resumeSessionIntoThread。
- **side 切片**：旁支对话 spawnSideConversation/sendSideMessage/promoteSideConversation 等，每个旁支独立 timeline/composer/busy/SSE，禁止触碰主线程状态。
- **runtime 切片**：buildThreadEventSink 构造 ThreadEventSink 全部回调（onDeltas/onTool/onCompaction/onReview/onApproval/onUserInput/onGoal/onTodos/onUsage/onTurnComplete/onError）；onTurnComplete 触发 notifySddChatTranscriptMirror、syncTurnCompletionPoll、refreshThreads、claw 飞书镜像。
- **runtime-helpers**：clearedThreadSelection、findReusableEmptyThreadId 等；ensureRuntimeProviderForSend（按需切 Provider 并重启运行时）、subscribeThreadEventsWithRecovery。
- **schedulers 切片**：scheduleStartupRuntimeProbe（启动 900ms 探测）、armBusyWatchdog（busy 看门狗，超时尝试 recoverActiveTurn）、syncTurnCompletionPoll（2.5s 轮询后台线程是否跑完）。

**【关键文件】** `src/renderer/src/store/chat-store*.ts`

### 1.3 工作台主体（Workbench 与右侧面板）

**【功能】** `Workbench.tsx`（约 2900 行）是 Code/Write/Claw 工作台编排根，挂接侧栏、时间线、悬浮 Composer 与右侧多模式面板，统揽 SDD/Plan 控制器。

**【入口】** 顶栏右面板模式按钮：`todo/plan/changes/browser/subagents`（内部 file/sdd-ai）；键盘快捷键（new-chat/choose-workspace/toggle-terminal/toggle-plan-mode/settings）。

**【机制】**
- 右侧面板全 lazy 加载（ChangeInspector/MessageTimeline/PlanPanel/TodoPanel/TerminalPanel/SubagentDetailPanel/WorkspaceFilePreviewPanel/DevBrowserPanel/SddAssistantPanel/SddDraftEditorView）；布局由 `useWorkbenchLayout` 管理。
- Composer 发送走 `handleSendAsync`：先判断 SDD 助手面板、`/plan` 命令、plan 模式、write/claw 分支，否则普通 sendMessage；支持 `@file` 文件引用（单文件 60K/总 180K 字符、目录展开上限 60 文件）、图片/PDF 附件上传（PDF 抽文本、图片校验视觉模型）。
- **上下文容量** `ContextCapacityPopover.tsx`：把最近回合 prompt token 按 tools/system/skills/messages/other 分类着色，叠加自动压缩阈值线（默认 0.9）。
- **文件树侧板** `ChatFileTreePanel.tsx`：onPreviewFile/onAddReference。
- **后台 shell 浮层** `BackgroundShellOverlay.tsx`：轮询 background_shell 会话并支持 stopBackgroundShell。
- **时间线** `MessageTimeline` + bubbles/cards/process：渲染各类块，工具块按 file_change/command_execution 呈现 diff/终端输出。

### 1.4 会话压缩 / 分叉 / 旁支 / 归档 / 重连

**【入口】** 斜杠命令（`floating-composer-commands.ts`）：`/new`（「新会话」）、`/compact`（「压缩/总结」）、`/fork`、`/archive`、`/restore`、`/btw`、`/goal`、`/research`、`/review`、`/plan`。

**【机制】**
- **压缩** `compactActiveThread(reason)` → compactThread 端点；返回 replacedTokens 立即下调容量计；监听 compaction_started/completed 渲染 compaction 块。
- **分叉** `forkActiveThread/forkThreadFromTurn(turnId)` → forkThread，记 forkedFrom* 到 thread-fork-registry。线程关系 `relation: 'primary'|'fork'|'side'`。
- **旁支(/btw)**：`parseBtwCommand` 解析，`spawnSideConversation(seedText)` 在不改 activeThreadId 前提下派生 side 线程并发首条；`promoteSideConversation` 升为主线程。
- **归档** `archiveThread` → PATCH status:'archived'/'idle'。
- **断流恢复**：SSE end/error 后线程仍 busy 则自动 recoverActiveTurn；busy 看门狗兜底。

---

## 二、SDD 需求先行工作流

> 一个需求 = 一个自包含目录 `.kunsdd/requirements/<uuid>/{requirement.md, trace.json, img/, proto/, chat/}`，对应计划 `.kunsdd/plan/sdd-<uuid>.md`，靠 uuid 关联。

### 2.1 需求草稿的结构化与存储

**【入口】** 侧栏「新建需求」→ startNewSddRequirement；侧栏「需求草稿」历史项 → openSddRequirementDraftFromHistory。

**【机制】**
- **草稿 store** `sdd-draft-store.ts`：`useSddDraftStore` 持 activeDraft/content/lastSavedContent/saveStatus/operationStatus。注册表 `kun.sdd.draft.registry.v1` 存 activeByWorkspace/drafts/contentByDraft。`buildSddDraftId = workspaceRoot:relativePath`；`createSddDraft` 生成 `.kunsdd/requirements/<uuid>/requirement.md`。退役的 `.kunsdd/draft/` 旧布局在 normalizeDraft 丢弃。
- **设计意图** `SddDesignContext`：designType('brand'|'product') + brandColor + tone[]，updateDesignContext 合并持久化，注入计划/原型 prompt。
- **磁盘动作** `sdd-draft-actions.ts`：saveActiveSddDraftToDisk、syncActiveSddDraftFromDisk（非脏时拉回磁盘，覆盖 Agent 就地编辑）、deleteSddDraft（删整个 unit 目录）。
- **恢复** `sdd-draft-restore.ts`：本地快照更新则用快照并标 dirty。
- **历史列表** `sdd-draft-history.ts`：合并记住的草稿与磁盘扫描（discoverDiskDrafts 遍历 `.kunsdd/requirements`），从首个标题生成标题，读 chat/meta.json 拿 chatThreadIds。
- 注意：Workbench 刻意不在启动/切目录时自动恢复草稿，避免劫持启动。

### 2.2 需求块（R 块）、验收标准与状态机

**【机制】** `@shared/sdd-trace.ts`：
- **语法**：`### R-1: 标题 {building}` + 描述 + `- [ ] 验收标准`。状态 token `SDD_REQUIREMENT_STATUSES = draft→planned→building→done→verified`（带 STATUS_RANK，只前进）。
- `parseSddRequirementBlocks`：跳过代码围栏，逐行解析 R 块，块内复选框即验收标准（SddAcceptanceItem），算 contentHash（FNV-1a 漂移检测）。
- `setSddRequirementStatus/applySddDerivedStatuses`：最小行编辑改写标题状态 token。
- **编辑器内进度** `SddRequirementProgress`：按 verified/done/building/planned 计数渲染分段进度条。

### 2.3 需求 AI 助手（澄清 / 调研 / 结构化 / 风险）

**【入口】** `SddAssistantPanel.tsx` 三组按钮（discover/structure/risk）→ applySddFramework（注入本地化 prompt 到 Composer）；底部 FloatingComposer 发送 → sendSddAssistantPrompt。

**【机制】**
- **PM 技能框架** `pm-skill-frameworks.ts`：把 pm-skills 框架蒸馏为可注入 guidance（discover：clarify/research/机会解决方案树/需求分诊；structure：用户故事3C/INVEST/PRD/文案润色；risk：风险假设映射/Pre-mortem/验证实验；plan/verify 仅注入无按钮）。`composeFrameworkGuidance(ids)` 拼成 prompt 块。
- **助手 prompt** `sdd-assistant-prompt.ts`：注入工作区、草稿路径、框架 guidance、草稿全文与用户请求，指示「改草稿则直接编辑草稿文件」。
- **框架武装/兜底**：仅当发送文本仍含注入 prompt 才真正应用 guidance。
- **对话线程注册** `sdd-thread-registry.ts`：`kun.sdd.threadRegistry.v1` 绑定草稿↔线程，区分 threadIds 与 publicThreadIds；SDD 助手线程默认对侧栏隐藏，构建计划开始时 releaseSddAssistantThread 公开。
- **对话转录** `sdd-chat-transcript.ts`：每完成回合 notifySddChatTranscriptMirror 把 blocks 重写进 `<unit>/chat/<threadId>.md` + meta.json；打开草稿时 refreshSddChatTranscriptFromProvider 全量重建。
- **设计上下文表单** `SddDesignContextBar`：选 brand/product、品牌色、tone chips，写回 updateDesignContext，由 `sdd-design-context.ts` 注入生成 prompt（明确反「AI 默认紫蓝渐变/奶油背景」通病）。

### 2.4 设计稿 / 信息图 / 交互式 HTML 原型生成

**【入口】** `SddDraftEditorView` 选区工具栏：generateImage(design|infographic)、generatePrototype()。

**【机制】**
- **信息图/设计稿**：经 infographic-pending 插占位，调 `window.kunGui.generateWriteInfographic` 生成图片落 `<unit>/img`，完成后 finishPendingInfographic 替换占位。
- **HTML 原型** `sdd-prototype-prompt.ts`：`buildSddPrototypeTurnPrompt` 指示 Agent 在保留路径 `<unit>/proto/prototype-*.html` 增量产出单文件 HTML（先骨架再多次 edit，每次 <4000 字符），注入设计上下文；图片驱动需视觉模型，缺失时 firstVisionCapableModel + 二次确认切换。
- **草稿图片采集** `sdd-draft-images.ts`：解析 markdown 本地图片引用（须落 `<unit>/img`），读 base64 测尺寸输出 SddDraftImageReference[] 供计划「Image Reference Map」；isSddPrototypeRelativePath 特判原型不当图片读。

### 2.5 需求 → 计划升级（「下一步」）

**【入口】** SDD 编辑器「下一步」→ handleSddNextStep。

**【机制】** handleSddNextStep：① 校验非空/无在途占位图/运行时空闲；② saveActiveSddDraftToDisk；③ 确保 SDD 助手线程；④ collectSddDraftImages 采图（支持则 uploadSddImagesAsAttachments）；⑤ `buildSddDraftToPlanPrompt` 拼 prompt：要求 Agent 恰好调一次 `create_plan` 保存到保留路径（operation=draft），注入草稿全文/对话上下文/Image Reference Map/设计上下文，强制需求可追溯——每步以 `(covers: R-1, R-3)` 标注实现的需求 id 覆盖全部 R-id，注入 pre-mortem + 优先级 guidance；⑥ sendPlanTurn，把 buildSddTraceSnapshot 写入 `<unit>/trace.json` 作漂移基线；⑦ 计划成功后清空 active 草稿。

### 2.6 需求 ↔ 计划 ↔ 开发的追溯回路

**【机制】**
- **追溯计算** `sdd-trace-compute.ts` `computeSddTrace`：解析 R 块 + 计划 covers（parseSddPlanCovers）+ 当前线程 todo 状态三方合并——plan 复选框为基线，活动 todo 把 completed 升 done、in_progress 标 building；得出 perRequirement 覆盖、uncoveredIds、derivedStatuses、changedIds/addedIds 漂移。
- **Hook** `use-sdd-trace.ts`：聚合编辑器/磁盘 requirement、计划面板/磁盘 plan、活动线程 todo、trace.json 快照（5s 慢刷新拉 Agent 就地编辑），算 trace 并**前进式写回** requirement.md 状态 token。
- **漂移检测** `diffSddRequirementChanges`：对比 contentHash 与快照识别变更/新增需求。
- **UI**：PlanPanel 顶部「覆盖 N/总数」「未覆盖 R-id」徽章，漂移时显示「需求已变更」横幅与「重新规划」按钮。

### 2.7 验收（/verify）与增量重规划（/replan）

**【入口】** PlanPanel「验收」→ verifyGuiPlan；漂移横幅「重新规划」→ replanChangedRequirements。

**【机制】**（workbench-plan-controller.ts）
- **验收** `verifyGuiPlan` + `sdd-verify-prompt.ts`：发 buildSddVerifyPrompt（agent 模式），逐条验收标准对照真实代码/行为（优先跑测试），就地 `- [ ]`→`- [x]`、全通过标题改 `{verified}`，注入「意图-实现差距审计 + 逐条测试场景」guidance。
- **增量重规划** `replanChangedRequirements(changedIds)`：只切变更块文本，构造 buildRefinePlanPrompt（只改受影响步骤、保留其余 covers），operation=refine 发 plan turn，成功后重写 trace 快照重新基线。

---

## 三、计划与 Todo

### 3.1 计划生成、保存与重新加载

**【入口】** `/plan`（parseGuiPlanCommand：`/plan`→打开、`/plan <需求>`→新建）；Plan 模式 Composer 发送；SDD「下一步」。

**【机制】**
- **命令解析** `plan-command.ts`：区分 open/create。
- **共享契约** `@shared/gui-plan.ts`：`GUI_PLAN_RELATIVE_DIR='.kunsdd/plan'`；create_plan 输入 `{markdown, source_request, title, operation:'draft'|'refine', plan_relative_path}`，输出 CreatePlanToolOutput{plan_id, relative_path, content_hash, ...}；buildPlanRelativePath/nextAvailablePlanRelativePath、buildGuiPlanId、validateCreatePlanToolInput。
- **控制器** `workbench-plan-controller.ts`：sendPlanTurn 默认 draft；监听 blocks 中最新成功 plan 工具块（latestSuccessfulPlanBlock→extractPlanMetadataFromBlock），loadPlanFromMeta 读盘 setActivePlan；shouldAutoOpenPlanPanel 只为本线程刚生成的计划自动弹面板；buildGuiPlan（构建计划：发 buildPlanBuildPrompt 让 Agent 按计划执行）。
- **plan-tool/plan-request/plan-path/plan-prompts**：识别 create_plan 块抽 meta.plan；找最近用户请求；draft/refine/build prompt 构造与显示格式化。
- **plan store** `plan-store.ts`：`useGuiPlanStore` 持 activePlan/content/saveStatus/operationStatus('drafting|ready|refining|building|error')/previewMode；注册表按 activeByWorkspace/activeByThread/plans 记忆。

### 3.2 计划面板（PlanPanel）

**【机制】** 用 WriteRichEditor（降级 WriteMarkdownEditor）编辑计划支持内联补全；650ms 防抖自动保存，保存成功调 syncPlanTodosFromMarkdown 同步 Todo；顶部状态徽章 + 覆盖率/未覆盖徽章 + 漂移横幅 + 验收按钮；底部「构建计划」按钮；operationStatus 为 drafting/refining/building 时只读。

### 3.3 计划 ↔ Todo 同步

**【机制】**
- **同步逻辑** `plan-todo-sync.ts`：extractPlanTodos 解析任务行成 ThreadTodoItem，每项带 source{kind:'plan', planId, ordinal, contentHash}，makePlanTodoId 用源信息 hash 生成稳定 id；mergePlanTodosForRenderer 按 contentHash/ordinal 多级匹配复用 id 与状态；计划里消失的 plan-todo 降级为手工项。
- **store 动作** `syncPlanTodosFromMarkdown`：算合并结果有变化才 setThreadTodos；setActiveThreadTodoStatus（单一 in_progress 互斥）；clearActiveThreadTodos。运行时 todos_updated 经 onTodos 回写。
- **入口** `TodoPanel.tsx`：三态统计、逐项勾选/三态切换、plan 来源项显示相对路径可 onOpenPlan 跳计划。

### 3.4 目标（/goal）

**【入口】** `/goal`（parseGoalCommand：menu/set/pause/resume/clear）。

**【机制】** setActiveThreadGoal/setActiveThreadGoalStatus/clearActiveThreadGoal → goal 端点；运行时 goal_updated/cleared 经 onGoal 回写并在时间线插系统块。Goal 含 objective/status('active|paused|blocked|usageLimited|budgetLimited|complete')/tokenBudget/tokensUsed/timeUsedSeconds。

---

## 四、变更审查

### 4.1 内联 diff 与变更审查面板（ChangeInspector / DiffView）

**【入口】** 右面板 changes 模式。

**【机制】**
- `ChangeInspector.tsx`：过滤 toolKind==='file_change' 且含统一 diff 文本的工具块，列出文件列表（含 +added/-removed 统计、running 标记），选中行在下方用 DiffView 全高展示补丁。
- `DiffView.tsx`：轻量统一 diff 渲染——解析文件名/增删行数/hunk，按扩展名语言徽章，`+/-/@@` 行着色、计算新行号、隐藏元行、支持复制整段；非补丁回退等宽 pre。
- diff 文本由 kun-mapper 从 file_change 工具结果产出，mergeChatBlocks 把同 callId 的 tool_call/tool_result 合并成一个块。

### 4.2 代码审查（/review，ReviewBlock）

**【入口】** `/review`（parseReviewCommand：无参=未提交改动、`base/branch <分支>`、`commit <sha>`、其余=自定义指令）。

**【机制】** reviewActiveThread(target)：无活动线程先建/复用代码线程，reviewThread 端点发审查回合并开 SSE。运行时回 review 事件经 onReview 渲染 ReviewBlock。ReviewOutput 含 findings[]{title,body,confidenceScore,priority,codeLocation}、overallCorrectness、overallExplanation、overallConfidenceScore。UI ReviewSummaryCard 折叠卡显示运行/失败/无发现/N 条发现。

### 4.3 工具审批与回滚

**【机制】** 审批块 resolveApproval(blockId,'allow'|'deny')→submitApprovalDecision，按策略可端侧自动决议；rewindAndResend→rewindThread；rollbackWorkspaceToCheckpoint(checkpointId) 回退工作区；request_user_input 经 resolveUserInput 提交/取消（#606 live 门控：仅运行时仍等待的请求才可作答）。

---

## 五、子Agent（Kun Crew）

### 5.1 子Agent 调用可视化（SubagentCallCard）

**【机制】** `SubagentCallCard.tsx`：从工具/审批/用户块的 meta.child（childId/childLabel/childProfile/childStatus/childSeq/parentTurnId）与工具结果 detail JSON 两路读取互相兜底。三条视觉通道：AgentKun **姿态**=角色（general/explore/design-reviewer/over-engineering-reviewer/code-review/compaction/title/summary 映射不同 kun PNG）、**动效**=活跃度（IntersectionObserver 离屏冻结、prefers-reduced-motion 降级）、**圆盘环+状态点**=状态（queued/running/done/failed/awaiting-permission）。useElapsed 实时计时。多兄弟委派以 SwarmHeader 聚合。ExternalLink 按钮 openChild→selectThread(childId) 切到子线程（relation='side'）。运行时元数据还带 childModel/childToolPolicy/prefixReused/inheritedHistoryItems/cacheHitRate/costUsd/costCny。

### 5.2 子Agent 返回栏与子线程浏览

**【机制】** SubagentReturnBar（message-timeline-empty.tsx）：activeThreadRelation==='side' 时渲染，仅提供「返回父对话」（activeThreadParentId→selectThread），不提供发送框。

### 5.3 子Agent 画像与权限配置（SubagentDetailPanel）

**【机制】** `SubagentDetailPanel.tsx`：ProfileDialog 编辑 KunSubagentProfileV1，ModelSelect 据模型能力给推理选项，PermissionsTab 配权限能力目录，RowActions 管增删/启用。运行时能力清单约束可配置范围（subagents{maxParallel,maxChildRuns,defaultToolPolicy,defaultProfile,profiles[]}）。画像可作为新线程/下回合的 agentId 人格（createThread({agentId}) 快照 providerId/model/systemPrompt 到线程）。

---

## 附：贯穿全章的数据闭环

1. **需求**（requirement.md R 块 + 验收标准 + 设计上下文）→ 经 SDD 助手澄清/结构化，转录到 `<unit>/chat`。
2. **设计** → 信息图/设计稿落 `<unit>/img`，HTML 原型落 `<unit>/proto`。
3. **计划** → handleSddNextStep 调 create_plan 生成 `sdd-<uuid>.md`（步骤带 `covers: R-n`），写 trace.json 基线。
4. **编码** → 计划任务 syncPlanTodosFromMarkdown 成线程 Todo，useSddTrace 把 Todo/复选框前进式写回 R 块状态，file_change 进 ChangeInspector。
5. **验收** → `/verify` 逐条核对并标 `{verified}`，`/review` 出结构化审查；需求漂移触发 `/replan` 增量精化，回到第 3 步。
