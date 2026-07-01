# Claude360 Copilot Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本仓库当前约束：不得主动执行 `git commit`、`git push`、`git reset` 或创建分支；提交只在用户明确要求后执行。

**Goal:** 将 Kun 二次开发为 Claude360 用户专属的原生桌面客户端第一阶段可交付版本。

**Architecture:** 第一阶段按后端 CLI 支撑、客户端账号核心、模型与“我的”页、品牌入口、音乐、生图六个可独立验证的子系统推进。Renderer 只处理界面和短生命周期展示数据；main 进程负责 Claude360 API、密钥加密、模型映射和功能工作台请求；newapi 提供缺失的 CLI 登录与用量接口。

**Tech Stack:** Electron、React、TypeScript、Zustand、Vitest、Go、Gin、GORM、newapi、Claude360 OpenAI-compatible API、Suno shim。

---

## 计划边界

本目录仅存放 Codex 生成的实施计划，不修改上级 `doc/` 编号文档。

第一阶段只规划和实施开发，不连接生产服务器，不做生产数据库操作，不做部署。涉及生产环境、数据库结构变更、批量删除、权限变更、核心依赖升级等高风险动作时，必须单独向用户确认。

## 子计划顺序

1. `plan-01-newapi-cli-auth-token-stats.md`
   - 目标：补齐客户端登录和“我的”页用量展示需要的 newapi 接口。
   - 阻塞：客户端账号核心依赖 `/api/cli/auth/password`、`/api/cli/auth/password/2fa`；“我的”页依赖 `/api/cli/token_stats`。

2. `plan-02-copilot-claude360-account-core.md`
   - 目标：建立客户端 Claude360 settings、secret store、main service、IPC、登录弹窗。
   - 阻塞：后续模型、API Key、“我的”、音乐、生图都依赖统一账号态和密钥态。

3. `plan-03-copilot-models-my-page.md`
   - 目标：接入 Claude360 分组 Key、模型列表、余额充值、用量统计和“我的”页。
   - 阻塞：Code、写作、音乐、生图都必须从这里拿到功能分组 Key 和模型能力。

4. `plan-04-copilot-brand-route-hide.md`
   - 目标：完成 Claude360 Copilot 品牌、appId、路由骨架、隐藏非第一阶段入口、移除左下角小鸟渲染。
   - 说明：可和计划 03 部分并行，但最终验收必须在模型收口之后做回归。

5. `plan-05-copilot-native-music.md`
   - 目标：迁移 `claude360-music-web` 核心逻辑为 Copilot 原生音乐工作台。
   - 依赖：计划 02 的账号 IPC、计划 03 的 music 分组 Key。

6. `plan-06-copilot-native-canvas.md`
   - 目标：实现第一阶段原生生图工作台 MVP。
   - 依赖：计划 02 的账号 IPC、计划 03 的 image 分组 Key 和 image 模型列表。

## 全局文件责任

- `newapi/router/api-router.go`：CLI 接口路由统一入口。
- `newapi/controller/cli.go`：CLI 设备授权、账号、Key、分组、模型、充值和后续新增 CLI 登录/用量聚合。
- `claude360-Copilot/src/shared/*`：跨 main/preload/renderer 的类型和 settings 契约。
- `claude360-Copilot/src/main/services/claude360-*`：Claude360 API、认证、Key、模型、账单、音乐、生图服务。
- `claude360-Copilot/src/main/ipc/*`：IPC schema 与 main handler。
- `claude360-Copilot/src/preload/index.ts`：`window.kunGui` 扩展点，后续可保留变量名但新增 Claude360 方法。
- `claude360-Copilot/src/renderer/src/components/*`：登录弹窗、Workbench、Sidebar、设置页和新增工作台。
- `claude360-Copilot/src/renderer/src/store/*`：路由、工作台状态和必要的本地 UI 状态。

## 全局验收命令

在对应子计划执行完成后，按影响范围运行：

```bash
cd "newapi"
go test ./controller ./router
```

预期：相关 controller/router 测试通过。

```bash
cd "claude360-Copilot"
npm run typecheck
npm run test
```

预期：TypeScript 类型检查通过，Vitest 测试通过。

```bash
cd "claude360-Copilot"
npm run build
```

预期：Electron/Vite 构建通过。打包验证只在品牌计划或最终联调阶段运行。

## 全局非目标

- 不迁移旧 infinite-canvas 完整后端。
- 不做插件市场改造。
- 不做 Claw 手机连接、Schedule、Workflow 的第一阶段可见入口。
- 不保存用户名密码。
- 不在 renderer localStorage 长期保存 `cli_token` 或 API Key 明文。
- 不主动提交 git。

## 执行原则

- KISS：优先复用现有 settings、IPC、service、Vitest 和 Go test 模式。
- YAGNI：第一阶段只做登录、账号、Key、模型、我的页、音乐、生图 MVP。
- DRY：newapi 复用 `ensureUserAccessToken`、Token CRUD、`model.GetUserTokenStats`；音乐复用 `claude360-music-web` 的参数构造和任务状态模型。
- SOLID：Claude360 API client、auth、token、model、billing、music、canvas 分离，renderer 不直接承担密钥和远程 API 责任。

## 最终验收清单

- 首次启动进入 Claude360 登录弹窗。
- 用户可选择账号密码登录或网页授权登录。
- 登录成功后重启可恢复登录态，登出后清理本地敏感凭据。
- Code 和写作模型下拉只来自 Claude360。
- 用户看不到自定义供应商新增、Base URL、API Key 配置入口。
- “我的”页可查看账号、余额、今日用量、token stats、充值、API Key 分组和倍率。
- 音乐工作台可提交、轮询、播放、下载 Suno 作品。
- 生图工作台可文本生图、单图编辑、查看历史、下载、复制。
- 插件、手机连接、计划任务、Workflow 第一阶段入口隐藏。
- 左下角小鸟、形象工坊、iKun cameo、celebration 不再渲染。
- 构建产物名称、productName、appId 属于 Claude360 Copilot。
