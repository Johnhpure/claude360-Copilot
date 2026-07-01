# 01 · 运行时核心：Agent Loop 与上下文管理

> 范围：`kun/src/loop/`、`kun/src/runtime/agent-sdk/`、`kun/src/cache/`
> 设计参考：`docs/kun-architecture.md`、`docs/kun-cache-optimization.md`

本章对 Kun 本地运行时的「Agent Loop 与上下文管理核心」做最小颗粒度分析。Kun 采用 ports & adapters 架构，本层属于 `loop/`（编排）、`cache/`（前缀缓存纪律）与 `runtime/agent-sdk/`（订阅引擎融合）三块。整体遵循「稳定前缀追求复用、动态历史只允许追加并按需压缩」的 cache-first 设计。

---

## 一、Agent Loop 主调度器（AgentLoop）

### 1.1 回合生命周期编排（runTurn）

- **作用说明**：以 `runTurn(threadId, turnId)` 为入口端到端驱动一个回合，捕获全部异常并返回 `completed | failed | aborted` 三态，保证回合资源清理。
- **实现机制/触发方式**：
  - 先取 `turns.getAbortController(turnId)`；无 controller 直接 `failTurn`，已 abort 直接 `finishTurn('aborted')`。
  - **订阅引擎分流**：若注入了 `sdkRuntime` 且其 `handlesProvider(thread.providerId)` 为真，整个回合委派给 Claude Agent SDK 运行时（见第七节），不进入原生 loop。
  - 顺序记录 pipeline 阶段 `setup → pre_start → post_start`；按需创建 turn 级 `ToolStormBreaker`；跑 `runTurnStartLifecycleHooks`（TurnStart/UserPromptSubmit 钩子，UserPromptSubmit 可拒绝回合或注入 `<hook-context>` 用户消息）；`drainSteering` 注入转向消息；再进入 `loop`。
  - 回合完成且 `status === completed` 时 fire-and-forget 调 `maybeGenerateThreadTitle`。
  - `finally` 块统一收尾：结束 goal 计时器、`evaluateGoalResume` 决策跨回合目标续跑、清理所有 turn 级 Map/Set、跑 TurnEnd 钩子。
  - catch 块做诊断增强：把 model、provider（脱敏 baseUrl）、错误栈前 3 行拼成 `[Kun turn failed]` 结构化消息。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`AgentLoop.runTurn`、`runTurnStartLifecycleHooks`、`runTurnEndHooks`、`failTurn`）

### 1.2 多步循环与单步模型推理（loop / modelStep）

- **作用说明**：`loop` 是无限步进循环；`modelStep` 是单次「准备请求 → 调模型 → 流式处理 → 派发工具」的完整模型步骤，返回 `continue | stop | failed | aborted`。
- **实现机制/触发方式**：
  - `loop`：`for (step=0;;step++)`，每步先检查 abort、`drainSteering`，再 `modelStep`；`stop→completed`，`failed/aborted` 直接返回。
  - `modelStep` 关键流程（按 pipeline 阶段）：
    1. **前缀漂移校验**：`shouldVerifyImmutablePrefix()` 为真时 `verifyImmutablePrefix(prefix)`（开发期或 `KUN_VERIFY_IMMUTABLE_PREFIX=1`）。
    2. **plan 上下文解析**：从 turn.guiPlan 或 `activePlanContext` 取候选，`isStalePlanContext` 检测 workspace 不匹配（fork 带入）则丢弃。
    3. **成本预算闸门**：`checkBudgetGate`，blocked 时标记 `goalResumeSuppressedByTurn` 并 stop。
    4. **历史装载与愈合**：`sessionStore.loadItems`；仅 `stepIndex===0` 时跑 `healLoadedHistoryItems`，有变更则 `rewriteItems`。
    5. **有效历史**：`effectiveHistoryAfterLatestCompaction` + `repairModelHistoryItems`。
    6. **模型路由**：`resolveTurnModel`（候选优先级 turn.model → thread.model → opts.model.model；`auto` 走 flash-router）。
    7. **能力解析、附件解析、技能解析、记忆检索、目标/待办指令构建、工具清单与指纹**。
    8. **工具目录漂移**：`recordToolCatalogFingerprint` → 若 `breaking` 直接 stop（保护缓存假设）。
    9. **plan 工具裁剪**：`resolvePlanModeToolSpecs`。
    10. **按需压缩**：`compactIfNeeded`。
    11. **组装 baseRequest**：systemPrompt（thread persona 追加在 immutable prefix 之后）、modeInstruction、contextInstructions、prefix.fewShots、`capToolResultImages` 后的 history、tools、requiredToolName、reasoningEffort。
    12. **token economy + history hygiene**：`applyTokenEconomyToRequest` 再 `applyRequestHistoryHygiene`，记录节省量。
    13. **流式消费**：处理 `assistant_text_delta`/`assistant_reasoning_delta`、`tool_call_complete`（修复参数、持久化、发 `tool_call_ready`）、`usage`、`completed`、`error`。
    14. **回合后续判定**（无工具调用时）：requiredToolName 缺失处理、空响应+文件变更的恢复重试、goal 续跑的无工具重复检测、length 截断告警等。
  - **进度标记**：派发非 goal-status 工具时 `turnMadeProgress.add(turnId)`。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`AgentLoop.loop`、`AgentLoop.modelStep`）

### 1.3 工具调用派发（dispatchToolCalls）与并发策略

- **作用说明**：把模型本回合产出的工具调用顺序/批量执行，落盘结果按调用顺序写入历史。
- **实现机制/触发方式**：
  - 逐个调用先经 `ToolStormBreaker.inspect`，suppress 则 `persistSuppressedToolCall` 写错误 tool_result 并跳过。
  - **并发判定 `isParallelSafeToolCall`**：`always/untrusted/never` 审批策略禁止并发；委托子任务（`delegate_task` 且 provider kind `delegation`）允许并发（信号量限并发）；否则仅 `read/grep/find/ls` 四个只读工具、`toolKind` 为 `tool_call`、provider 为 `built-in` 才并发。
  - **批量上限**：委托批用 `calls.length`，只读批用 `MAX_PARALLEL_TOOL_CALLS=3`；批内保持同质。`Promise.allSettled` 执行，结果仍按 batch index 顺序 `persistToolCallResult` 落盘。
  - 全部被 storm 抑制返回 `all_suppressed`（→ stop）。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`dispatchToolCalls`、`isParallelSafeToolCall`、`PARALLEL_READ_ONLY_TOOL_NAMES`、`MAX_PARALLEL_TOOL_CALLS`）

### 1.4 工具执行与结果持久化

- **作用说明**：在 inflight 追踪下执行单个工具，崩溃降级为 error tool_result（不杀回合），并持久化结果、触发 plan 同步。
- **实现机制/触发方式**：`executeToolCall` 用 `inflight.run` 包裹；可恢复派发错误（unknown tool/is not provided by/is disabled by policy 等）转 `tool_dispatch_rejected`；非 abort 崩溃转 `tool_execution_failed`；`persistToolCallResult` 更新 item 状态写 tool_result，`create_plan` 成功时回调 `onPlanWritten` 同步 plan checklist 到 thread todos。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`executeToolCall`、`executeToolCallSafely`、`persistToolCallResult`、`afterToolResultPersisted`）

### 1.5 用户输入闸门

- **作用说明**：让 `user_input`/`request_user_input` 工具暂停回合等待 GUI 回答，回合 abort 时取消等待。
- **实现机制**：`awaitUserInput` 持久化 user_input item、发 `user_input_requested`、`waitForUserInput` 通过 `userInputGate.request` 等待；IM/headless 回合 `disableUserInput` 时不挂等待，相关工具被隐藏。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`awaitUserInput`、`waitForUserInput`、`createToolContext`）

---

## 二、上下文压缩与历史管理

### 2.1 上下文压缩器（ContextCompactor）

- **功能**：长会话上下文折叠压缩——把过长历史折叠为单个 `compaction` 摘要 item，保留固定约束、技能 pin 和近期若干 item。
- **机制**：
  - **触发阈值**：估算 token = 估算历史 token + overheadTokens，与可信 provider `promptTokens` 取 `Math.max`。低于 `softThreshold` 不压缩。
  - **压缩模式分档**：`tokens >= hardThreshold → force`；`>= soft+0.6*(hard-soft) → aggressive`；否则 `normal`。`keepRecent` 分别为 force=1、aggressive=2、normal=4。
  - **promptTokens 可信判定**：provider 报告超本地估算 `PROMPT_TOKEN_TRUST_FACTOR=6` 倍时视为缓存读折算膨胀（如 MiniMax-M3 约 25 倍），丢弃回退估算，按 model key 每 60s 限频告警。
  - **压缩执行**：`trimTrailingToolCalls` 去掉无 result 的尾部 tool_call；`repairTailStartForToolResults` 修复孤儿 tool_result；对 head 算 `sourceDigest` 生成 `digestMarker`；摘要为模型摘要或启发式摘要；返回 `[frozen, summaryItem, ...tail]`。
- **关键文件**：`kun/src/loop/context-compactor.ts`

### 2.2 启发式压缩摘要（buildCompactionSummary）

- **机制**：摘要含 Reason/Mode/Budget、固定约束清单、skill pin、逐 item 摘要行；`selectSummaryLines` 超 20 行保头 4 尾 14、中间省略；`fitLinesToBudget` 按字符预算（默认 4000）裁剪；末尾追加 digest marker。
- **关键文件**：`kun/src/loop/context-compactor.ts`

### 2.3 模型驱动压缩摘要（summarizeCompactionWithModel）

- **机制**：`summaryMode==='model'` 时用专用 `COMPACTION_SYSTEM_PROMPT`（移植自 opencode），真实对话作为消息喂入；丢弃主 agent 前缀/few-shot，`temperature:0`、`reasoningEffort:'off'`、`maxTokens` 默认 2048、超时 15000ms；失败降级启发式。压缩模型不降级到小模型（handoff 需同等能力）。
- **关键文件**：`kun/src/loop/compaction-summary.ts`

### 2.4 压缩在 loop 中的接入（compactIfNeeded）

- **机制**：冷启动补水 prompt pressure；估 overhead → `planCompaction`；有 PreCompact 钩子先跑；`compact` 后 model 模式二次摘要 override 重压；`replacedTokens>0` 时重排可见历史、清 read tracker、`rewriteItems` 落盘、`placeCompactionsAtTurnEnd` 适配 renderer、发 `compaction_completed`。
- **关键文件**：`kun/src/loop/agent-loop.ts`、`compaction-history.ts`、`compaction-marker.ts`

### 2.5 历史愈合（history-healing）

- **机制**：装载磁盘历史时一次性修复畸形 item（缺 id/callId/toolName、未配对的 tool_call/result），按 identity 检测变更避免每回合两次全量 stringify 阻塞事件循环；仅 `stepIndex===0` 调用一次。
- **关键文件**：`kun/src/loop/history-healing.ts`

### 2.6 请求边界历史卫生（request-history-hygiene）

- **功能**：只压缩发给模型的历史，不改磁盘完整结果，以提高热前缀占比、防止上下文失控。
- **机制**：
  - **单结果上限**：`maxToolResultLines=320`、`maxToolResultBytes=32KB`、`maxToolResultTokens=8000`；超限保头 25% + 尾 35% + signal 行（最多 48 行）。
  - **长参数**：超 8KB/2000 token 替换为占位 + preview。
  - **base64/数组**：base64 占位；数组超 80 项保头 75% + 尾。
  - **累计预算**：`maxCumulativeToolResultTokens`（默认 120000）跨全部 tool_result，最近 `keepRecentToolResults` 个永远全保真，超出折叠为单行 digest。
  - **图片豁免**：model-visible 图片保留 base64，按 `IMAGE_TOOL_RESULT_TOKEN_ESTIMATE=1200` 计费。
  - token 估算内置 CJK-aware 算法。
- **关键文件**：`kun/src/loop/request-history-hygiene.ts`

### 2.7 工具结果图片路由（tool-result-image）

- **机制**：`MODEL_VISIBLE_IMAGE_KINDS={image, computer_screenshot}`（`generate_image` 排除）；`capToolResultImages` 保留最近 `MAX_FORWARDED_TOOL_IMAGES=3` 张，旧的折叠占位。
- **关键文件**：`kun/src/loop/tool-result-image.ts`

### 2.8 工具风暴抑制（tool-storm-breaker）

- **机制**：turn-scoped，窗口 `windowSize=8`、阈值 `threshold=3`：第三次完全相同 `(toolName, arguments)` 调用被 suppress 并引导收窄查询；变更类工具清掉之前只读记录；`request_user_input` 豁免。
- **关键文件**：`kun/src/loop/tool-storm-breaker.ts`

### 2.9 工具参数修复（tool-call-repair）

- **机制**：`repairDispatchToolArguments` 解包 `{arguments:"{...}"}` 包装、`scavengeSingleJsonString`、`truncateOversizedStrings`（超 512KB 截断，file_change 类保留长串）。
- **关键文件**：`kun/src/loop/tool-call-repair.ts`

---

## 三、Token 经济与上下文估算

### 3.1 Token 经济（token-economy）

- **功能**：可选模式（默认关），压缩工具描述、工具结果、指示模型简洁回复。
- **机制**：`historyHygiene` 无条件运行（安全网，累计 120000 token）；`compactToolSpec` 压缩工具描述；仅压缩**当前回合**的 tool_call/tool_result；`compressProse` 去 filler 但 `protectTechnicalSegments` 保护代码/URL/路径；`compactToolOutput` 按工具名差异化压缩；`recordTokenEconomySavings` 记入 usage。
- **关键文件**：`kun/src/loop/token-economy.ts`

### 3.2 上下文估算器与请求开销估算

- **机制**：`context-estimator.ts` 偏好 reported usage，文本退化用 CJK-aware 算法（ASCII 4 字符/token，非 ASCII 约 1 token/字符）；`model-request-estimator.ts` 估算每回合系统提示+few-shot+工具 schema 开销，作为无 usage 路径下压缩触发的安全地板。
- **关键文件**：`kun/src/loop/context-estimator.ts`、`model-request-estimator.ts`

---

## 四、模型路由与推理深度

### 4.1 自动模型路由（auto-model-router）

- **功能**：`model='auto'` 时用 flash 模型做分类器，在 `deepseek-v4-flash`（廉价）与 `deepseek-v4-pro`（强）间选型并推荐 thinking 深度。
- **机制**：`AUTO_MODEL_ROUTER_MODEL=deepseek-v4-flash` 返回 `{"model":...,"thinking":"off|high|max"}`；琐碎/对话→flash，编码/调试/多步/高风险→pro；`maxTokens:96`、`temperature:0`、超时 4000ms；输入含最近 6 条非当前回合 item（每条截 900 字符）；降级走启发式；结果按 `threadId:turnId` 缓存。
- **关键文件**：`kun/src/loop/auto-model-router.ts`

### 4.2 回合模型解析与推理深度归一

- **机制**：候选 `[turn.model, thread.model, opts.model.model]` 取首个非空；`auto` 走 flash-router（带缓存）；`reasoning-effort.ts` 把非法/缺失推理深度归一为 `off`，避免廉价默认意外升级 title/summary/review。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`resolveTurnModel`）、`reasoning-effort.ts`

### 4.3 模型上下文画像（model-context-profile）

- **功能**：为每个模型解析上下文窗口、soft/hard 压缩阈值、能力元数据。
- **机制**：内置 `deepseek-v4-pro/flash` 画像，窗口 1,000,000，soft/hard 比例 0.75/0.85（100% 前压缩）；无画像回退 soft 96000/hard 108800；安全帽强制不超窗口 75%/85%；能力元数据含模态、工具调用、reasoning 协议（`deepseek-chat-completions`）。
- **关键文件**：`kun/src/loop/model-context-profile.ts`

---

## 五、目标续跑、转向与回合附属能力

### 5.1 目标自动续跑协调器（goal-resume-coordinator）

- **功能**：goal 模式回合结束但目标仍 active 时自动重启续跑；无进展失败有指数退避上限，耗尽则把目标移出 active。
- **机制**：全部副作用注入；`madeProgress` 重置 attempts，否则 +1；超 `maxNoProgressAttempts=5` 返回 `exhausted`（转 blocked）；退避 `2000 * 2^(attempts-1)` 封顶 60000ms；`resumeInterrupted` 在运行时重启后续跑被搁浅目标；timer `unref` 不阻塞退出。
- **关键文件**：`kun/src/loop/goal-resume-coordinator.ts`、`agent-loop.ts`（`evaluateGoalResume`）

### 5.2 目标/待办续跑指令与无进展判定

- **机制**：`goalContinuationInstruction` 仅 active 时生成（含 objective、token 预算、严格 blocked 审计：连续 ≥3 回合同一阻塞才可标 blocked）；无工具重复检测用 char-bigram Dice 相似度 ≥0.85；空响应恢复重试上限 1；`todoContinuationInstruction` 列最多 50 条待办、最多 1 个 in_progress。
- **关键文件**：`kun/src/loop/agent-loop.ts`

### 5.3 转向队列（steering-queue）

- **机制**：turn-scoped buffer，回合运行中 renderer 投递转向文本，在安全边界（模型响应后、下次请求前）注入为 `item_steered` 用户消息；支持 `displayText`、`messageSource:'background_shell'`。
- **关键文件**：`kun/src/loop/steering-queue.ts`

### 5.4 其它回合附属能力

- **Inflight 追踪**（`inflight-tracker.ts`）：追踪运行中 model/tool，保证成功/错误/abort 下清理 id，是 SSE 事件流权威来源。
- **标题生成**（`title-generator.ts`）：首个完成回合后基于首条用户意图生成单行标题，≤50 字符、超时 12000ms，占位标题才可升级。
- **会话摘要**（`session-summary.ts`）：一次性 LLM 调用生成约 1 段中性摘要，超时 20000ms。
- **仅追加会话日志**（`append-only-session-log.ts`）：`windowSize=1000` 内存窗口 + 全量磁盘回放。
- **成本预算闸门**（`checkBudgetGate`）：`>=budget` 写 `budget_limited` 阻断，`>=80%` 一次性 `budget_warning`。
- **运行时上下文注入**：`buildRuntimeContextInstruction`（项目路径+本地时间）、`PLAN_MODE_INSTRUCTION`、记忆注入（limit 8）、图生图参考、验证建议等，均追加在稳定前缀之后不污染缓存。

---

## 六、缓存前缀纪律（cache/）

### 6.1 不可变前缀与指纹（immutable-prefix）

- **功能**：管理 systemPrompt、tools、pinnedConstraints、fewShots，生成稳定指纹，开发期暴露静默漂移。
- **机制**：`normalizeTools` 按 name 排序、schema 递归 canonicalize；`fewShotCacheShape` 只计真正发给模型的内容，不计 id/turnId/时间戳；每次 mutate 重算 fingerprint + revision+1；`verifyImmutablePrefix` 重算不符则抛 `fingerprint drift`（非 production 或 `KUN_VERIFY_IMMUTABLE_PREFIX=1` 时校验）。
- **关键文件**：`kun/src/cache/immutable-prefix.ts`

### 6.2 工具目录指纹（tool-catalog-fingerprint）

- **机制**：对发送工具按 name 排序、canonicalize 算 sha256 前 16 位指纹与每工具 hash；按 scope 比对快照，`isAdditiveToolCatalogChange`（仅新增）为 additive（继续），否则 breaking（停回合提示新建线程）。
- **关键文件**：`kun/src/cache/tool-catalog-fingerprint.ts`

### 6.3 前缀挥发检测（prefix-volatility）

- **机制**：纯检测器，结构化解析 UUID/ISO8601/hex hash/JWT（不用正则），在 `input_cached` 阶段写入 pipeline details，仅诊断不阻断。
- **关键文件**：`kun/src/cache/prefix-volatility.ts`

### 6.4 缓存诊断（cache-diagnostics）

- **机制**：签名含 model/providerId/endpointFormat/prefixFingerprint/toolCatalogFingerprint/activeSkillIds；要求 hit 与 miss 计数都存在才信任 provider telemetry；`cacheableTokenHitRate = hit/(hit+miss)`；给出 miss 原因与建议。
- **关键文件**：`kun/src/cache/cache-diagnostics.ts`

### 6.5 LRU 与 TTL-LRU 缓存

- **机制**：`LruCache` 基于 Map 插入序，满则淘汰最旧，never throw；`TtlLruCache` 在 LRU 上加 TTL，过期视为 miss。
- **关键文件**：`kun/src/cache/lru-cache.ts`、`ttl-lru-cache.ts`

---

## 七、Claude Agent SDK 订阅引擎融合（runtime/agent-sdk/）

### 7.1 SDK 运行时编排（agent-sdk-runtime）

- **功能**：当线程 provider 为 `agent-sdk` 时，整个回合委派给官方 Claude Agent SDK 的 `query()`（计入用户 Claude 订阅），同时注入 Kun 的 persona、专属工具、权限，并把 SDK 事件流重投影为 Kun 原生事件。
- **机制**：`loadTurnContext` 取上下文；bridge Kun 专属工具为 in-process MCP server；`assembleSdkOptions` 组装选项；`composeSdkPromptText` 拼 prompt（有图片用结构化 user 消息 stream）；驱动 `sdk.query()` 流，每条经 `SdkEventMapper.map` 转 RuntimeEventDraft，里程碑 item 才 applyItem；按 `mapper.getFinal()` finishTurn。
- **关键文件**：`kun/src/runtime/agent-sdk/agent-sdk-runtime.ts`

### 7.2 SDK 上下文装配（sdk-context-assembler）

- **机制**：Kun 持有权威历史，每个 SDK 回合无状态——`buildHistoryTranscript`（排除当前回合，默认上限 48KB）作前导，故意不用 SDK in-memory resume；`composeSdkPromptText`：`<prior_conversation>` → 指令块 → `Current request:`（最显著放最后），空段省略以保 prompt-cache 友好。
- **关键文件**：`kun/src/runtime/agent-sdk/sdk-context-assembler.ts`

### 7.3 SDK 工具桥接（sdk-tool-bridge）

- **机制**：把 Kun 专属工具暴露为 SDK 的 `mcp__kun__<tool>`；与 Claude Code 内置重叠的（read/bash/edit/write/grep/find/ls）不桥接用 SDK 原生；`user_input/request_user_input` 故意桥接用 Kun GUI；`jsonSchemaToZodShape` 转 Zod；`toSdkMcpServer` 创建 `kun` MCP server。
- **关键文件**：`kun/src/runtime/agent-sdk/sdk-tool-bridge.ts`

### 7.4 SDK 选项装配（sdk-options-builder）

- **机制**：`allowedTools` = SDK 内置 + bridged `mcp__kun__*`，`disallowedTools=['AskUserQuestion']`；权限模式映射（plan→plan、auto→bypassPermissions、其余→default）；`canUseTool` 经 Kun 审批引擎裁决；`buildScopedEnv` 剥离会盖过订阅 token 的 env、注入 `CLAUDE_CODE_OAUTH_TOKEN`；非 Claude 模型回退默认 Claude 模型。
- **关键文件**：`kun/src/runtime/agent-sdk/sdk-options-builder.ts`

### 7.5 SDK 事件映射（sdk-event-mapper）

- **机制**：纯但有状态-确定性；流式契约对齐原生 loop（`content_block_delta`→增量 delta，完整 `assistant`→单个 item_created 避免双渲染）；usage 映射 `promptTokens = input + cache_read + cache_creation`、`cacheHitTokens=cache_read`。
- **关键文件**：`kun/src/runtime/agent-sdk/sdk-event-mapper.ts`

### 7.6 SDK 协议层与运行时工厂

- **机制**：`sdk-protocol.ts` 解耦重声明所消费的 SDK 类型切片（不直接 import，让纯模块在不装 SDK 包时也能 typecheck/单测）；`agent-sdk-runtime-factory.ts` 字符串动态 import 懒加载 SDK，`handlesProvider` 判定接管，`makeAwaitUserInput` 桥到 GUI 面板。
- **关键文件**：`kun/src/runtime/agent-sdk/sdk-protocol.ts`、`agent-sdk-runtime-factory.ts`

---

## 八、Pipeline 可观测性

- **机制**：每个 modelStep 沿固定阶段记录 `pipeline_stage` 事件：`setup → pre_start → post_start → input_received → input_cached（含前缀挥发检测）→ input_routed → input_compressed → input_remembered → pre_send（model/provider 诊断、history/tool count）→ post_send → response_received（stopReason/toolCallCount）`。工具目录漂移、storm 抑制、token economy 节省、usage、compaction 完成均有独立 runtime 事件。
- **关键文件**：`kun/src/loop/agent-loop.ts`（`recordPipelineStage`、`PIPELINE_STAGE_LABELS`）

---

## 设计意图归纳

本层全部机制服务于「提高每 token ROI」：稳定可缓存前缀（immutable prefix + 指纹 + 工具 canonical 排序 + 挥发检测）、压缩动态历史（compaction + history hygiene + 累计预算 + 历史愈合）、控制工具输出（token economy + 大结果/长参数标记化 + 图片封顶 + 风暴抑制）、可信统计（provider 原生 hit/miss 优先、`hit/(hit+miss)` 口径、重启 carryover）。GUI 不实现 agent 逻辑，全部缓存纪律收敛在 `kun serve` 运行时内部。
