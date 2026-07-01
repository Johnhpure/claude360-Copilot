# Copilot Native Music Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划不包含 git 提交步骤；每个任务完成后运行验证，提交仅在用户明确要求后执行。

**Goal:** 将 `claude360-music-web` 的 Suno 音乐生成功能迁移为 Claude360 Copilot 原生音乐工作台。

**Architecture:** Renderer 负责表单、任务列表、播放器和本地任务状态；main 进程通过 Claude360 music 分组 Key 调用 `/suno/submit/music` 和 `/suno/fetch`。音乐参数构造、任务状态机和轮询策略优先从 `claude360-music-web` 迁移，删除独立登录和独立 API Key 输入。

**Tech Stack:** Electron main/preload、React 19、TypeScript、Zustand、Vitest、Claude360 `/suno/*`、Suno shim。

---

## File Structure

- Source reference only:
  - `claude360-music-web/src/types.ts`
  - `claude360-music-web/src/lib/suno-params.ts`
  - `claude360-music-web/src/api/suno.ts`
  - `claude360-music-web/src/store/tasks.ts`
  - `claude360-music-web/src/features/create/generate.ts`
  - `claude360-music-web/src/features/player/*`
  - `claude360-music-web/src/features/library/*`

- Create: `claude360-Copilot/src/shared/claude360-music.ts`
  - 音乐表单、Suno 请求、任务、歌曲、状态类型。

- Create: `claude360-Copilot/src/main/services/claude360-music-service.ts`
  - main 进程提交任务、查询任务。

- Create: `claude360-Copilot/src/main/services/claude360-music-service.test.ts`

- Modify: `claude360-Copilot/src/main/ipc/app-ipc-schemas.ts`
  - 音乐提交、查询 payload schema。

- Modify: `claude360-Copilot/src/main/ipc/register-app-ipc-handlers.ts`
  - 注册 `claude360:music:submit`、`claude360:music:fetch`。

- Modify: `claude360-Copilot/src/shared/kun-gui-api.ts`
  - 增加 music IPC 类型。

- Modify: `claude360-Copilot/src/preload/index.ts`
  - 暴露 music IPC。

- Create: `claude360-Copilot/src/renderer/src/music/suno-params.ts`
  - 从 music-web 迁移并适配当前 TS/React 版本。

- Create: `claude360-Copilot/src/renderer/src/music/suno-params.test.ts`

- Create: `claude360-Copilot/src/renderer/src/music/music-task-store.ts`
  - 本地任务列表和状态恢复。

- Create: `claude360-Copilot/src/renderer/src/music/music-task-store.test.ts`

- Create: `claude360-Copilot/src/renderer/src/components/music/MusicWorkbench.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/music/MusicCreatePanel.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/music/MusicTaskList.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/music/MusicPlayer.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/music/LyricsAssistantDrawer.tsx`

- Create tests:
  - `src/renderer/src/components/music/MusicWorkbench.test.tsx`
  - `src/renderer/src/components/music/MusicCreatePanel.test.tsx`
  - `src/renderer/src/components/music/MusicTaskList.test.tsx`
  - `src/renderer/src/components/music/MusicPlayer.test.tsx`

- Modify: `claude360-Copilot/src/renderer/src/store/chat-store-types.ts`
  - 确保 `AppRoute` 包含 `music`。

- Modify: `claude360-Copilot/src/renderer/src/components/Workbench.tsx`
  - 渲染 MusicWorkbench。

- Modify: `claude360-Copilot/src/renderer/src/components/chat/Sidebar.tsx`
  - 增加音乐入口或接入计划 04 的可见入口。

## API Contract

### submit

Renderer:

```ts
window.kunGui.claude360MusicSubmit(payload)
```

Main request:

```http
POST https://claude360.xyz/suno/submit/music
Authorization: Bearer <music group api key>
Content-Type: application/json
```

### fetch

Renderer:

```ts
window.kunGui.claude360MusicFetch(taskId)
```

Main request:

```http
POST https://claude360.xyz/suno/fetch
Authorization: Bearer <music group api key>
Content-Type: application/json
```

任务状态以 `claude360-music-web` 当前 `tasks.ts` 和 `suno.ts` 实际返回为准，不在 Copilot 中发明新状态。

## Task 1: 迁移 shared music 类型

**Files:**

- Create: `src/shared/claude360-music.ts`
- Reference: `../claude360-music-web/src/types.ts`

- [x] **Step 1: 对照源类型列出最小类型集**

保留第一阶段需要的类型：

- create mode。
- form state。
- submit request。
- submit response。
- fetch response。
- task status。
- song item。

不迁移独立 auth 类型。

- [x] **Step 2: 写类型编译测试**

如项目无纯类型测试，创建最小 runtime helper 测试，确保状态枚举包含 submitting/running/succeeded/failed 等实际状态。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run typecheck
```

Expected: FAIL，类型未创建时引用失败。

- [x] **Step 4: 创建 `claude360-music.ts`**

要求：

- 不引入 music-web 的 auth token 字段。
- 不在 shared 类型中存 API Key。
- 状态命名与源项目保持一致，避免转换层复杂化。

- [x] **Step 5: 运行类型检查**

Run:

```bash
cd "claude360-Copilot"
npm run typecheck
```

Expected: PASS 或只剩后续未接入组件错误。

## Task 2: main music service

**Files:**

- Create: `src/main/services/claude360-music-service.ts`
- Test: `src/main/services/claude360-music-service.test.ts`
- Reference: `src/main/services/claude360-token-service.ts`
- Reference: `src/main/services/claude360-api-client.ts`

- [x] **Step 1: 写 submit service 测试**

Mock：

- `tokenService.ensureGroupToken(selectedMusicGroup, 'music')`。
- `secretStore.loadSecret(secretKeyRef)`。
- `apiClient.post('/suno/submit/music', payload, apiKey)`。

断言：

- 使用 music 分组 Key。
- 不把 API Key 返回 renderer。
- 余额/分组错误返回可展示 message。

- [x] **Step 2: 写 fetch service 测试**

断言：

- 调用 `/suno/fetch`。
- taskId 不能为空。
- 网络失败返回 `{ ok: false, retryable: true }` 一类结果。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-music-service.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 service**

接口：

```ts
submitMusic(input: Claude360MusicSubmitPayload): Promise<Claude360MusicSubmitResult>
fetchMusic(taskId: string): Promise<Claude360MusicFetchResult>
```

实现要求：

- 每次请求前确保 music token 可用。
- 若账号未登录，返回登录提示错误。
- 所有日志脱敏 Authorization。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-music-service.test.ts
```

Expected: PASS。

## Task 3: music IPC

**Files:**

- Modify: `src/main/ipc/app-ipc-schemas.ts`
- Modify: `src/main/ipc/app-ipc-schemas.test.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.test.ts`
- Modify: `src/shared/kun-gui-api.ts`
- Modify: `src/preload/index.ts`

- [x] **Step 1: 写 schema 测试**

覆盖：

- prompt/lyrics 至少一项满足源项目规则。
- custom mode 参数必须合法。
- taskId 不能为空。
- style/title 长度遵循 music-web 现有约束。

- [x] **Step 2: 写 handler 测试**

断言：

- `claude360:music:submit` 调用 `musicService.submitMusic`。
- `claude360:music:fetch` 调用 `musicService.fetchMusic`。
- 异常转换为统一错误结果。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 IPC 和 preload**

新增：

```ts
claude360MusicSubmit(payload)
claude360MusicFetch(taskId)
```

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
npm run typecheck
```

Expected: PASS。

## Task 4: 迁移 Suno 参数构造

**Files:**

- Create: `src/renderer/src/music/suno-params.ts`
- Test: `src/renderer/src/music/suno-params.test.ts`
- Reference: `../claude360-music-web/src/lib/suno-params.ts`
- Reference: `../claude360-music-web/src/lib/suno-params.test.ts`

- [x] **Step 1: 复制测试用例而不是重写行为**

从 music-web 迁移关键测试：

- simple mode。
- custom mode。
- instrumental。
- style/title/lyrics 参数。
- 非法输入。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/music/suno-params.test.ts
```

Expected: FAIL。

- [x] **Step 3: 迁移实现**

要求：

- 保持源项目参数输出一致。
- 删除独立 API client/token 依赖。
- 只保留纯函数，方便测试。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/music/suno-params.test.ts
```

Expected: PASS。

## Task 5: 任务 store 和轮询

**Files:**

- Create: `src/renderer/src/music/music-task-store.ts`
- Test: `src/renderer/src/music/music-task-store.test.ts`
- Reference: `../claude360-music-web/src/store/tasks.ts`
- Reference: `../claude360-music-web/src/hooks/usePolling.ts`

- [x] **Step 1: 写任务状态测试**

覆盖：

- submit 后新增 local task。
- fetch succeeded 后写入 songs。
- fetch failed 后标记 failed 并保留错误。
- 刷新恢复时 submitting 超时任务转为 polling 或 failed，不能永久卡住。

- [x] **Step 2: 写本地持久化测试**

如果使用 localStorage 或 browser storage helper，断言：

- 保存最近 N 个任务。
- 不保存 API Key。
- 数据损坏时安全恢复空列表。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/music/music-task-store.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 store**

优先使用 Zustand，与源项目保持相近状态结构。轮询 interval、最大失败次数、超时策略从 music-web 迁移。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/music/music-task-store.test.ts
```

Expected: PASS。

## Task 6: MusicWorkbench UI

**Files:**

- Create: `src/renderer/src/components/music/MusicWorkbench.tsx`
- Create: `src/renderer/src/components/music/MusicCreatePanel.tsx`
- Create: `src/renderer/src/components/music/MusicTaskList.tsx`
- Create: `src/renderer/src/components/music/MusicPlayer.tsx`
- Create: `src/renderer/src/components/music/LyricsAssistantDrawer.tsx`
- Tests listed in File Structure

- [x] **Step 1: 写 MusicWorkbench 渲染测试**

断言：

- 页面直接是音乐创作工作台，不是营销页。
- 有创建表单、任务列表、播放器区域。
- 未登录或无 music 分组时显示进入“我的”页修复入口。

- [x] **Step 2: 写提交交互测试**

Mock `window.kunGui.claude360MusicSubmit`：

- 用户输入 prompt 后点击生成。
- 调用参数来自 `suno-params`。
- 返回 taskId 后任务列表新增任务并开始轮询。

- [x] **Step 3: 写播放和下载测试**

断言成功歌曲显示：

- 标题。
- audio url。
- cover。
- 下载按钮。

- [x] **Step 4: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/music/MusicWorkbench.test.tsx src/renderer/src/components/music/MusicCreatePanel.test.tsx src/renderer/src/components/music/MusicTaskList.test.tsx src/renderer/src/components/music/MusicPlayer.test.tsx
```

Expected: FAIL。

- [x] **Step 5: 实现 UI**

设计要求：

- 工作台密度适中，适合反复创作。
- 表单控件使用 segmented control、switch、slider/input。
- 按钮使用 lucide 图标。
- 不出现独立登录/API Key 配置。

- [x] **Step 6: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/music/MusicWorkbench.test.tsx src/renderer/src/components/music/MusicCreatePanel.test.tsx src/renderer/src/components/music/MusicTaskList.test.tsx src/renderer/src/components/music/MusicPlayer.test.tsx
npm run typecheck
```

Expected: PASS。

## Task 7: 路由接入

**Files:**

- Modify: `src/renderer/src/store/chat-store-types.ts`
- Modify: `src/renderer/src/components/Workbench.tsx`
- Modify: `src/renderer/src/components/chat/Sidebar.tsx`
- Test: `src/renderer/src/store/chat-store-navigation-actions.test.ts`

- [x] **Step 1: 写 route 测试**

断言 `music` route 可打开，返回其他 route 不丢失状态。

- [x] **Step 2: 写 Workbench 渲染测试**

断言 route 为 `music` 时渲染 `MusicWorkbench`。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/music/MusicWorkbench.test.tsx
```

Expected: FAIL。

- [x] **Step 4: 接入路由**

如果计划 04 已添加路由骨架，只补充实际组件渲染。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/music/MusicWorkbench.test.tsx
```

Expected: PASS。

## Task 8: 回归验证

- [x] **Step 1: 运行音乐相关测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-music-service.test.ts src/renderer/src/music/suno-params.test.ts src/renderer/src/music/music-task-store.test.ts src/renderer/src/components/music/MusicWorkbench.test.tsx
```

Expected: PASS。

- [x] **Step 2: 类型检查**

Run:

```bash
cd "claude360-Copilot"
npm run typecheck
```

Expected: PASS。

- [ ] **Step 3: 手动冒烟**

Run:

```bash
cd "claude360-Copilot"
npm run dev
```

Expected:

- 登录后打开音乐工作台。
- 能提交测试音乐任务。
- 任务状态能轮询。
- 成功结果能播放。
- 无 music 分组时提示去“我的”页处理。

## Risk Notes

- 不要把 music-web 的独立登录和 auth store 迁移进 Copilot。
- API Key 必须由 main 进程读取和使用，renderer 不持有。
- 轮询失败必须有上限，避免后台无限请求。
- Suno 返回结构可能变化，service 要保留未知字段但 UI 只依赖稳定字段。
- 本地任务历史不能无限增长。
