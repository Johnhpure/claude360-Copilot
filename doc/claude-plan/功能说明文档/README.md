# Kun 功能说明文档（总纲）

> 文档类型：项目功能说明书（最小颗粒度全量覆盖）
> 适用版本：`kun-gui` v0.1.0 / 运行时 Kun
> 编制日期：2026-06-30
> 源码根：`/root/app/claude360agent/claude360-Copilot`（仓库目录名 `claude360-Copilot`，产品名 **Kun**）

> **版本边界**：本目录是“原 Kun 基线能力说明”，用于理解改造前代码结构，不等同于 Claude360 Copilot 改造后的目标态。P2 完成后，UI 插件、形象工坊、Retroma、iKun 相关能力会被删除；相关章节仅保留为历史参考。

本文件是 Kun 全部功能说明文档的**总入口**。功能细节按子系统拆分为 7 份分章文档（见下方「文档导航」），本总纲负责给出项目定位、技术架构、模块总览与跨模块数据闭环，便于先建立全局认知再下钻细节。

---

## 一、项目定位

Kun 是一款探索 **「需求先行（Requirement-First）coding 范式」** 的跨平台 AI Agent 桌面应用。它不是把聊天框贴进 IDE，而是把 **需求澄清 → 设计稿/原型 → 实施计划 → Agent 编码 → 变更审查 → 验收** 串成一条连续的 GUI 工作流。

核心产品主张：

- **需求先行**：从需求草稿、AI 澄清、结构化需求块、验收标准开始，再进入计划、Todo、编码、验收，形成「需求 ↔ 计划 ↔ 代码」可追溯闭环。
- **极致性价比的完整 Agent 能力**：默认围绕 **DeepSeek / Xiaomi MiMo / MiniMax** 三家高性价比模型组合，覆盖文本、推理、视觉、语音、图片、音乐、视频；也支持任意 OpenAI/Anthropic 兼容自定义 Provider。
- **本地优先**：会话、日志、偏好、运行时数据默认存本机；模型调用走用户自己的 Provider 凭据。
- **可控**：工具审批、文件系统权限模式、内联 diff、变更审查面板、Git 检查点回滚。
- **一体化**：同一应用内含 Code 工作台、Write 写作工作区、可视化工作流 Loop、定时任务、IM 远程入口。

| 你想要 | Kun 提供 |
| --- | --- |
| 探索下一代 coding 范式 | 需求澄清 → 需求文档 → 设计稿 → 计划 → Agent 编码 → 验收 |
| 极致性价比的完整 Agent 能力 | DeepSeek / Xiaomi MiMo / MiniMax 为核心，覆盖文本/推理/视觉/语音/图片/音乐/视频 |
| 让 AI 面向真实项目工作 | 绑定本地工作区，读写文件、搜索代码、执行命令、查看工具调用与结果 |
| 把需求推进到可执行计划 | 新建需求、`/plan`、Todo、`/goal`、旁支对话、会话压缩、分叉、归档 |
| 让改动保持可控 | 工具审批、权限模式、内联 diff、变更审查面板、`/review` |
| 在同一个应用里写作 | Markdown 文件树、Live/Source/Split/Preview、多格式导出、选区 inline agent |
| 离开电脑也能触发任务 | 飞书/Lark/微信/Telegram 连接、本地 webhook/relay、一次性或周期性定时任务 |
| 把重复流程沉淀成工作流 | 可视化「创建 Loop」节点编排，多步 Agent 流程可画、可跑、可复用 |

---

## 二、整体技术架构

Kun 采用 **「桌面 GUI（Electron）+ 本地单运行时（kun serve）」** 双层解耦架构。GUI 只做展现与本地资源托管，**全部 Agent 逻辑（loop、工具、上下文、缓存纪律）收敛在 `kun serve` 运行时内部**，二者通过本地 HTTP + SSE 通信。

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron 桌面应用                          │
│  ┌──────────────┐   IPC(白名单+Zod)   ┌────────────────────┐  │
│  │  Renderer     │ ◄─────────────────► │  Main Process       │  │
│  │ (React 19)    │                     │  - 窗口/生命周期     │  │
│  │  - Code 工作台 │                     │  - Git/Whisper/导出  │  │
│  │  - Write 写作  │                     │  - 运行时进程托管     │  │
│  │  - 工作流/设置 │                     │  - 终端(node-pty)    │  │
│  └──────┬───────┘                     └─────────┬──────────┘  │
└─────────┼──────────────────────────────────────┼─────────────┘
          │  HTTP REST + SSE 事件流 (Bearer Token) │ spawn/健康看门狗
          ▼                                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 Kun 本地运行时 (kun serve)                     │
│  HTTP/SSE Server → AgentLoop → 工具系统 → 模型 Provider        │
│  上下文压缩 / 缓存纪律 / 模型路由 / 委派子Agent / Hook / 审查   │
│  会话&事件 仅追加日志(JSONL) + SQLite 索引 + 用量遥测           │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 关键技术 |
| --- | --- |
| 桌面框架 | Electron 34、electron-vite、electron-updater、electron-store |
| 渲染层 | React 19、Zustand、Tailwind、i18next、Lucide |
| 编辑器 | TipTap(ProseMirror) 富文本、CodeMirror 6 源码/实时预览、Shiki 高亮 |
| 工作流画布 | @xyflow/react（React Flow） |
| 终端 | @xterm/xterm + node-pty |
| 运行时 | Node 原生 http、better-sqlite3、@modelcontextprotocol/sdk、Claude Agent SDK |
| 媒体/语音 | 本地 Whisper（whisper-cli）、pdfjs-dist、jimp、html-to-docx |
| IM 接入 | @larksuiteoapi/node-sdk（飞书/Lark）、@tencent-weixin/openclaw-weixin（微信）、Telegram Bot |
| 校验 | Zod（IPC payload、运行时配置、结构化输出） |

### 进程边界与安全基线

- **渲染层完全沙箱化**：`contextIsolation:true` + `sandbox:true` + `nodeIntegration:false`，仅通过 preload 白名单 `contextBridge` 暴露约 110 个 IPC 方法。
- **输入边界防线**：所有 IPC payload 经 Zod `.strict()` 校验；`runtime:request` 额外对端点做白名单 `refine`，渲染层无法越权打到运行时任意端点。
- **运行时鉴权**：除 `/health` 外全部 `/v1/*` 路由需 Bearer Token。
- **多层工具闸门**：沙箱模式 → PreToolUse Hook → 读前置守卫 → 运行时策略 → 审批 → 执行 → PostToolUse Hook → 限流归一化。

---

## 三、功能模块总览

下表为全量功能模块清单，每行对应一个可独立理解的能力域，详见对应分章。

### A. 本地运行时（kun/）

| 模块 | 关键能力 | 详见 |
| --- | --- | --- |
| Agent Loop | 回合编排、多步循环、工具派发与并发、用户输入闸门 | [01](01-运行时-AgentLoop与上下文管理.md) |
| 上下文管理 | 长会话压缩、历史愈合、请求边界卫生、累计预算、图片封顶、工具风暴抑制 | [01](01-运行时-AgentLoop与上下文管理.md) |
| 模型路由 | `auto` Flash-router 自动选型、推理深度调节、模型上下文画像 | [01](01-运行时-AgentLoop与上下文管理.md) |
| 缓存纪律 | 不可变前缀指纹、工具目录指纹、前缀挥发检测、缓存诊断 | [01](01-运行时-AgentLoop与上下文管理.md) |
| 订阅引擎融合 | Claude Agent SDK 回合委派（计入用户 Claude 订阅） | [01](01-运行时-AgentLoop与上下文管理.md) |
| 工具系统 | read/write/edit/bash/grep/find/ls/lsp/verify + 后台 shell | [02](02-运行时-工具系统.md) |
| 扩展工具 | MCP（含动态搜索）、Skill、Memory、委派、Web、图片/语音/音乐/视频生成、computer_use | [02](02-运行时-工具系统.md) |
| HTTP/SSE 服务端 | 全量 REST API、SSE 事件流、组合根装配、事件循环监控 | [03](03-运行时-服务端与子系统.md) |
| 业务服务 | Thread/Turn/Usage/Review 服务、事件记录、LLM 调试缓冲、后台 shell 运行时 | [03](03-运行时-服务端与子系统.md) |
| Hook 引擎 | 6 个生命周期阶段、命令/工作流/内置 hook | [03](03-运行时-服务端与子系统.md) |
| 委派子系统 | 4 个内置子 Agent profile、工作区 overlay、子 Agent 执行器 | [03](03-运行时-服务端与子系统.md) |
| 代码审查 | /review 隔离审查器、审查目标解析、结构化 JSON 输出 | [03](03-运行时-服务端与子系统.md) |
| 技能/记忆/质量 | 技能注入、长期记忆检索、前端设计质量检测 | [03](03-运行时-服务端与子系统.md) |
| 配置/CLI/遥测 | 配置 Schema、密钥脱敏、serve/run/chat/exec 命令、用量与缓存遥测 | [03](03-运行时-服务端与子系统.md) |

### B. 桌面 GUI（src/）

| 模块 | 关键能力 | 详见 |
| --- | --- | --- |
| 主进程与本地服务 | 窗口/生命周期、运行时托管与自愈、终端、Git/检查点/worktree、工作区文件、Skill、语音、Write 导出/RAG；UI 插件为 P2 删除前历史能力 | [04](04-GUI-主进程与本地服务.md) |
| Code 对话工作台 | 运行时对接、会话状态切片、工作台编排、压缩/分叉/旁支/归档 | [05](05-GUI-对话需求先行与计划.md) |
| 需求先行 SDD | 需求草稿、R 块/验收标准/状态机、需求 AI 助手、设计稿/原型生成、需求-计划-代码追溯、验收/重规划 | [05](05-GUI-对话需求先行与计划.md) |
| 计划与 Todo | create_plan 工具、计划面板、计划↔Todo 同步、/goal 目标 | [05](05-GUI-对话需求先行与计划.md) |
| 变更审查 | ChangeInspector 内联 diff、/review 审查卡、工具审批与检查点回滚 | [05](05-GUI-对话需求先行与计划.md) |
| 子 Agent（Kun Crew） | 委派可视化卡片、子线程浏览、子 Agent 画像与权限配置 | [05](05-GUI-对话需求先行与计划.md) |
| Write 写作模式 | 多写作空间、双引擎编辑器、5 种预览、行内补全双模式、行内改写 + RAG、术语传播、信息图/原型嵌入、多格式导出 | [06](06-GUI-Write写作模式.md) |
| 可视化工作流 Loop | 25 种节点、Loop 循环节点、节点配置、运行历史、Agent 钩子触发器 | [07](07-GUI-自动化扩展与设置.md) |
| 定时任务 | 一次性/周期任务、客户端/IM 模式、全局默认、worktree 隔离、任务依赖 | [07](07-GUI-自动化扩展与设置.md) |
| IM 远程入口 claw | 飞书/Lark/微信扫码、Telegram Bot、连接手机、渠道与会话管理 | [07](07-GUI-自动化扩展与设置.md) |
| MCP 管理 | 结构化编辑 mcp.json、三种传输、信任与可见域 | [07](07-GUI-自动化扩展与设置.md) |
| 设置中心 | 基线含 16 个区块；P2 后移除“形象/形象工坊”区块 | [07](07-GUI-自动化扩展与设置.md) |
| 插件市场 | MCP/Skill 安装、GitHub 导入、OAuth 连接器；UI 形象插件为 P2 删除前历史能力 | [07](07-GUI-自动化扩展与设置.md) |
| 初始设置向导 + 媒体生成 | 首启引导与能力自动接线、图片/语音/音乐/视频生成设置 | [07](07-GUI-自动化扩展与设置.md) |

---

## 四、跨模块数据闭环（需求先行范式）

Kun 最核心的产品线是「需求 → 设计 → 计划 → 编码 → 验收」可追溯闭环，贯穿 SDD、Plan、Todo、Review 多个模块：

1. **需求**：`.kunsdd/requirements/<uuid>/requirement.md` 的 `R-n` 需求块 + 验收标准 + 设计上下文，经需求 AI 助手澄清/结构化，对话转录到 `<unit>/chat/`。
2. **设计**：信息图/设计稿落 `<unit>/img/`，交互式 HTML 原型落 `<unit>/proto/`。
3. **计划**：`handleSddNextStep` 调 `create_plan` 工具生成 `.kunsdd/plan/sdd-<uuid>.md`，每个步骤以 `(covers: R-1, R-3)` 标注覆盖的需求 id，并写 `trace.json` 作为漂移基线。
4. **编码**：计划任务经 `syncPlanTodosFromMarkdown` 同步为线程 Todo；`useSddTrace` 把 Todo/复选框状态前进式写回需求块状态（`draft→planned→building→done→verified`，只前进）；文件改动进入 ChangeInspector 内联 diff。
5. **验收**：`/verify` 逐条核对验收标准并标 `{verified}`；`/review` 产出结构化代码审查；需求漂移时 `/replan` 只把变更块喂回 refine，回到第 3 步。

---

## 五、文档导航

| 序号 | 文档 | 范围 |
| --- | --- | --- |
| 01 | [运行时 - Agent Loop 与上下文管理核心](01-运行时-AgentLoop与上下文管理.md) | loop/cache/agent-sdk：回合编排、压缩、路由、缓存纪律、订阅融合 |
| 02 | [运行时 - 工具系统](02-运行时-工具系统.md) | adapters/tool：全部内置工具 + 扩展 Provider + 注册发现机制 |
| 03 | [运行时 - 服务端与运行时子系统](03-运行时-服务端与子系统.md) | server/services/hooks/delegation/review/skills/memory/quality/config/cli/domain |
| 04 | [GUI - 主进程与本地服务](04-GUI-主进程与本地服务.md) | src/main：窗口、运行时托管、终端、Git、工作区、Skill、语音、Write 服务；UI 插件为历史参考 |
| 05 | [GUI - Code 对话、需求先行与计划](05-GUI-对话需求先行与计划.md) | 对话工作台、SDD 需求工作流、计划/Todo、变更审查、子 Agent |
| 06 | [GUI - Write 写作模式](06-GUI-Write写作模式.md) | 编辑器、行内补全、行内改写 RAG、术语传播、信息图、导出 |
| 07 | [GUI - 自动化、扩展与设置](07-GUI-自动化扩展与设置.md) | 工作流 Loop、定时任务、IM、MCP 管理、设置中心、插件市场、初始向导、媒体生成 |

---

## 六、参考资料（仓库内）

- `README.md` / `README.en.md`：产品介绍
- `DESIGN.zh-CN.md`：设计文档（1373 行）
- `AGENTS.md`：Agent 协作约定
- `kun/README.zh-CN.md`：运行时、CLI、环境变量、HTTP API
- `docs/kun-architecture.md`：单运行时架构与 GUI 集成
- `docs/kun-cache-optimization.md`：缓存优化与 token economy
- `docs/kun-hooks.md`：Hook 生命周期
- `docs/KUN_CONFIG.md`：运行时配置项
- `docs/workflow-loop.md`：Loop 循环节点
- `docs/model-provider-presets.md`：模型 Provider 预设
- `docs/UI_PLUGINS.md`：UI 形象插件（P2 后删除，仅历史参考）
- `docs/WRITE_*` 系列：Write 行内补全/检索 RAG/最近编辑
