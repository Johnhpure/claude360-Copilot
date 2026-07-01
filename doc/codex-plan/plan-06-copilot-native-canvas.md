# Copilot Native Canvas Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划不包含 git 提交步骤；每个任务完成后运行验证，提交仅在用户明确要求后执行。

**Goal:** 在 Claude360 Copilot 中实现第一阶段原生生图工作台 MVP，支持文本生图、单图编辑、历史、下载和复制。

**Architecture:** 不嵌入旧 infinite-canvas 页面，不迁移完整后端。main 进程使用 Claude360 image 分组 Key 调用 OpenAI-compatible image endpoints；renderer 实现轻量画布工作台、图片结果网格、编辑面板和本地历史。旧 infinite-canvas 仅作为交互和请求结构参考。

**Tech Stack:** Electron main/preload、React、TypeScript、Zustand、Vitest、Claude360 `/v1/images/generations`、`/v1/images/edits`、existing workspace/clipboard services。

---

## File Structure

- Source reference only:
  - `infinite-canvas/handler/ai.go`
  - `infinite-canvas/service/claude360_auth.go`
  - `infinite-canvas/web` 中图片生成相关组件和状态
  - `infinite-canvas/docs/canvas-data-structure.md`

- Create: `claude360-Copilot/src/shared/claude360-canvas.ts`
  - 生图请求、编辑请求、图片结果、历史、错误类型。

- Create: `claude360-Copilot/src/main/services/claude360-canvas-service.ts`
  - main 进程文本生图、图片编辑。

- Create: `claude360-Copilot/src/main/services/claude360-canvas-service.test.ts`

- Modify: `claude360-Copilot/src/main/ipc/app-ipc-schemas.ts`
  - 生图/编辑 IPC payload schema。

- Modify: `claude360-Copilot/src/main/ipc/register-app-ipc-handlers.ts`
  - 注册 `claude360:canvas:generate`、`claude360:canvas:edit`。

- Modify: `claude360-Copilot/src/shared/kun-gui-api.ts`
  - 增加 canvas IPC 类型。

- Modify: `claude360-Copilot/src/preload/index.ts`
  - 暴露 canvas IPC。

- Create: `claude360-Copilot/src/renderer/src/canvas/canvas-store.ts`
  - 画布状态、历史和选择状态。

- Create: `claude360-Copilot/src/renderer/src/canvas/canvas-store.test.ts`

- Create: `claude360-Copilot/src/renderer/src/canvas/image-result-utils.ts`
  - base64/data URL/url 结果归一化、文件名、下载辅助。

- Create: `claude360-Copilot/src/renderer/src/canvas/image-result-utils.test.ts`

- Create: `claude360-Copilot/src/renderer/src/components/canvas/CanvasWorkbench.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/canvas/CanvasToolbar.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/canvas/ImagePromptPanel.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/canvas/ImageResultGrid.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/canvas/ImageEditorPanel.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/canvas/ImageHistoryPanel.tsx`

- Create tests:
  - `src/renderer/src/components/canvas/CanvasWorkbench.test.tsx`
  - `src/renderer/src/components/canvas/ImagePromptPanel.test.tsx`
  - `src/renderer/src/components/canvas/ImageResultGrid.test.tsx`
  - `src/renderer/src/components/canvas/ImageEditorPanel.test.tsx`

- Modify: `claude360-Copilot/src/renderer/src/store/chat-store-types.ts`
  - 确保 `AppRoute` 包含 `canvas`。

- Modify: `claude360-Copilot/src/renderer/src/components/Workbench.tsx`
  - 渲染 CanvasWorkbench。

- Modify: `claude360-Copilot/src/renderer/src/components/chat/Sidebar.tsx`
  - 增加生图入口或接入计划 04 的可见入口。

## MVP Scope

第一阶段必须做：

- 文本生图。
- 单图编辑。
- 模型下拉来自 Claude360 image 模型。
- 尺寸/数量等基础参数。
- 结果历史。
- 下载。
- 复制图片或复制图片 URL。
- 低余额/无 image 分组提示去“我的”页。

第一阶段不做：

- 无限画布节点系统。
- 云同步。
- 复杂 workflow。
- 素材市场。
- 排行榜。
- 会员系统。
- admin。
- 多人协作。

## API Contract

### 文本生图

Main request:

```http
POST https://claude360.xyz/v1/images/generations
Authorization: Bearer <image group api key>
Content-Type: application/json
```

Body:

```json
{
  "model": "image-model",
  "prompt": "image prompt",
  "size": "1024x1024",
  "n": 1
}
```

### 图片编辑

Main request:

```http
POST https://claude360.xyz/v1/images/edits
Authorization: Bearer <image group api key>
Content-Type: multipart/form-data
```

Body fields:

- `model`
- `prompt`
- `image`
- optional `mask`
- optional `size`

实际字段以 Claude360/newapi image endpoint 兼容能力为准。

## Task 1: shared canvas 类型

**Files:**

- Create: `src/shared/claude360-canvas.ts`

- [x] **Step 1: 定义最小类型**

需要类型：

```ts
export type Claude360CanvasMode = 'generate' | 'edit'
export type Claude360ImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto'
export type Claude360CanvasImage = {
  id: string
  source: 'url' | 'base64'
  url?: string
  b64Json?: string
  mimeType: string
  prompt: string
  model: string
  createdAt: string
}
```

- [x] **Step 2: 运行类型检查**

Run:

```bash
cd "claude360-Copilot"
npm run typecheck
```

Expected: PASS until referenced by following tasks。

## Task 2: main canvas service

**Files:**

- Create: `src/main/services/claude360-canvas-service.ts`
- Test: `src/main/services/claude360-canvas-service.test.ts`
- Reference: `src/main/services/claude360-token-service.ts`
- Reference: `src/main/services/claude360-api-client.ts`

- [x] **Step 1: 写文本生图测试**

Mock：

- `tokenService.ensureGroupToken(selectedImageGroup, 'image')`。
- secret store 返回 image API Key。
- fetch `/v1/images/generations` 返回 OpenAI images 格式。

断言：

- 使用 image 分组 Key。
- Authorization 不返回 renderer。
- 输出图片归一化为 `Claude360CanvasImage[]`。

- [x] **Step 2: 写图片编辑测试**

断言：

- 传入 image buffer/data URL 后使用 multipart form。
- prompt/model 必填。
- 返回结果归一化。

- [x] **Step 3: 写错误测试**

覆盖：

- 未登录。
- 无 image 分组。
- 余额不足。
- 后端返回非 JSON。
- 图片文件过大或格式不支持。

- [x] **Step 4: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-canvas-service.test.ts
```

Expected: FAIL。

- [x] **Step 5: 实现 service**

接口：

```ts
generateImages(input: Claude360ImageGeneratePayload): Promise<Claude360ImageResult>
editImage(input: Claude360ImageEditPayload): Promise<Claude360ImageResult>
```

实现要求：

- 请求前确保 image token。
- 文本生图 JSON 请求。
- 图片编辑 multipart 请求。
- 支持 url 和 b64_json 两类 OpenAI-compatible 返回。
- 日志脱敏。

- [x] **Step 6: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-canvas-service.test.ts
```

Expected: PASS。

## Task 3: canvas IPC

**Files:**

- Modify: `src/main/ipc/app-ipc-schemas.ts`
- Modify: `src/main/ipc/app-ipc-schemas.test.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.test.ts`
- Modify: `src/shared/kun-gui-api.ts`
- Modify: `src/preload/index.ts`

- [x] **Step 1: 写 schema 测试**

覆盖：

- generate prompt 必填。
- model 必填。
- n 范围限制，例如 1-4。
- size 必须在允许集合。
- edit image 必填。

- [x] **Step 2: 写 IPC handler 测试**

断言：

- `claude360:canvas:generate` 调用 `canvasService.generateImages`。
- `claude360:canvas:edit` 调用 `canvasService.editImage`。
- 错误返回统一 `{ ok: false, message }`。

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
claude360CanvasGenerate(payload)
claude360CanvasEdit(payload)
```

Renderer 上传本地图片时，可复用 `window.kunGui.getPathForFile` 和现有文件读取 IPC，避免 renderer 直接使用 Node API。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
npm run typecheck
```

Expected: PASS。

## Task 4: canvas store 与历史

**Files:**

- Create: `src/renderer/src/canvas/canvas-store.ts`
- Test: `src/renderer/src/canvas/canvas-store.test.ts`
- Create: `src/renderer/src/canvas/image-result-utils.ts`
- Test: `src/renderer/src/canvas/image-result-utils.test.ts`

- [x] **Step 1: 写状态 reducer 测试**

覆盖：

- 设置 prompt/model/size。
- generate pending/success/failure。
- edit pending/success/failure。
- 选择 active image。
- history 添加和截断。

- [x] **Step 2: 写结果工具测试**

覆盖：

- b64_json 转 data URL。
- url 结果保留。
- 文件名从 prompt/model/date 生成安全名称。
- 损坏数据安全失败。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/canvas/canvas-store.test.ts src/renderer/src/canvas/image-result-utils.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 store 和工具**

要求：

- 历史最多保留固定数量，例如 100 条。
- 不保存大体积 base64 到无限增长的 localStorage；如需保存，限制数量和大小。
- 图片下载使用现有 browser/download 能力或 `<a download>`。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/canvas/canvas-store.test.ts src/renderer/src/canvas/image-result-utils.test.ts
```

Expected: PASS。

## Task 5: CanvasWorkbench UI

**Files:**

- Create: `src/renderer/src/components/canvas/CanvasWorkbench.tsx`
- Create: `src/renderer/src/components/canvas/CanvasToolbar.tsx`
- Create: `src/renderer/src/components/canvas/ImagePromptPanel.tsx`
- Create: `src/renderer/src/components/canvas/ImageResultGrid.tsx`
- Create: `src/renderer/src/components/canvas/ImageEditorPanel.tsx`
- Create: `src/renderer/src/components/canvas/ImageHistoryPanel.tsx`
- Tests listed in File Structure

- [x] **Step 1: 写工作台渲染测试**

断言：

- 首屏是生图工作台，不是营销页。
- 有 prompt 输入、模型选择、尺寸控制、生成按钮。
- 有结果区域和历史区域。

- [x] **Step 2: 写文本生图交互测试**

Mock `window.kunGui.claude360CanvasGenerate`：

- 输入 prompt。
- 选择模型和尺寸。
- 点击生成。
- 成功后结果网格显示图片。

- [x] **Step 3: 写图片编辑交互测试**

Mock：

- 上传图片。
- 输入编辑 prompt。
- 点击编辑。
- 成功后历史新增编辑结果。

- [x] **Step 4: 写下载/复制测试**

断言：

- url 图片可复制 URL。
- base64 图片可复制图片或下载。
- 按钮有图标和 tooltip。

- [x] **Step 5: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/canvas/CanvasWorkbench.test.tsx src/renderer/src/components/canvas/ImagePromptPanel.test.tsx src/renderer/src/components/canvas/ImageResultGrid.test.tsx src/renderer/src/components/canvas/ImageEditorPanel.test.tsx
```

Expected: FAIL。

- [x] **Step 6: 实现 UI**

设计要求：

- 工具型布局，避免营销式 hero。
- 控件稳定尺寸，避免生成状态造成布局跳动。
- 模型下拉来自 Claude360 image 模型 cache。
- 无 image Key 时显示去“我的”页创建/修复。
- 低余额时显示充值入口。

- [x] **Step 7: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/canvas/CanvasWorkbench.test.tsx src/renderer/src/components/canvas/ImagePromptPanel.test.tsx src/renderer/src/components/canvas/ImageResultGrid.test.tsx src/renderer/src/components/canvas/ImageEditorPanel.test.tsx
npm run typecheck
```

Expected: PASS。

## Task 6: 路由接入

**Files:**

- Modify: `src/renderer/src/store/chat-store-types.ts`
- Modify: `src/renderer/src/components/Workbench.tsx`
- Modify: `src/renderer/src/components/chat/Sidebar.tsx`
- Test: `src/renderer/src/store/chat-store-navigation-actions.test.ts`

- [x] **Step 1: 写 route 测试**

断言 `canvas` route 可打开，且不会误进入旧 infinite-canvas iframe。

- [x] **Step 2: 写 Workbench 渲染测试**

断言 route 为 `canvas` 时渲染 `CanvasWorkbench`。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/canvas/CanvasWorkbench.test.tsx
```

Expected: FAIL。

- [x] **Step 4: 接入路由**

如果计划 04 已添加路由骨架，只补充实际组件渲染。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/canvas/CanvasWorkbench.test.tsx
```

Expected: PASS。

## Task 7: 与 image 模型和分组联动

**Files:**

- Modify: `src/main/services/claude360-model-service.ts`
- Modify: `src/main/services/claude360-token-service.ts`
- Modify: `src/renderer/src/components/canvas/ImagePromptPanel.tsx`
- Test: `src/main/services/claude360-model-service.test.ts`
- Test: `src/renderer/src/components/canvas/ImagePromptPanel.test.tsx`

- [x] **Step 1: 写 image 模型过滤测试**

断言：

- 只展示 image endpoint 或 image tag 模型。
- 没有 image 模型时显示错误态。
- 默认模型来自后端 recommended 或第一个 image 模型。

- [x] **Step 2: 写 image Key ensure 测试**

断言提交前调用 image group token，不能使用 text key。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-model-service.test.ts src/renderer/src/components/canvas/ImagePromptPanel.test.tsx
```

Expected: FAIL。

- [x] **Step 4: 实现联动**

Canvas UI 不硬编码 `gpt-image-2`。如果后端没有返回 image 模型，可显示“暂无可用生图模型”并提供刷新模型按钮。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-model-service.test.ts src/renderer/src/components/canvas/ImagePromptPanel.test.tsx
```

Expected: PASS。

## Task 8: 回归验证

- [x] **Step 1: 运行生图相关测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-canvas-service.test.ts src/renderer/src/canvas/canvas-store.test.ts src/renderer/src/canvas/image-result-utils.test.ts src/renderer/src/components/canvas/CanvasWorkbench.test.tsx
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

- 登录后打开生图工作台。
- image 模型下拉来自 Claude360。
- 文本生图成功返回图片。
- 单图编辑成功返回图片。
- 下载和复制按钮可用。
- 无 image 分组或余额不足时提示明确。

## Risk Notes

- 第一阶段不要迁移 infinite-canvas 的后端、用户系统、素材库、排行榜和 workflow。
- 图片 base64 体积大，历史持久化必须限量。
- 图片编辑 multipart 在 Electron main 进程实现时要确认 Node fetch/FormData 兼容性；若当前 Electron Node 版本不稳定，使用标准 `Blob`/`FormData` 前先写测试。
- 不要在 renderer 暴露 image API Key。
- 下载/复制跨平台行为需要在 Windows/macOS/Linux 抽样验证。
