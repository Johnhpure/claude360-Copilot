# Copilot Models And My Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划不包含 git 提交步骤；每个任务完成后运行验证，提交仅在用户明确要求后执行。

**Goal:** 将 Code、写作、API Key 分组、模型列表、余额充值和 token 用量统一收口到 Claude360，并交付“我的”页面。

**Architecture:** main 进程新增 token/model/billing services，负责获取 Claude360 分组、Key、模型、余额、充值和用量；settings 中保存脱敏 token ref 和模型缓存；renderer 新增“我的”页展示和操作入口。现有 provider profile 仍作为 Kun runtime 兼容层存在，但只由 Claude360 自动生成，不再暴露给用户手动配置。

**Tech Stack:** Electron main/preload、React、TypeScript、Zustand、Vitest、newapi `/api/cli/tokens`、`/api/cli/groups`、`/api/cli/models`、`/api/cli/topup/*`、`/api/cli/token_stats`。

---

## File Structure

- Create: `claude360-Copilot/src/main/services/claude360-token-service.ts`
  - 拉取、创建、reveal、ensure group token。

- Create: `claude360-Copilot/src/main/services/claude360-model-service.ts`
  - 拉取分组和模型，生成 Claude360 provider profiles。

- Create: `claude360-Copilot/src/main/services/claude360-billing-service.ts`
  - `me`、充值选项、微信充值订单、订单状态、token stats。

- Modify: `claude360-Copilot/src/shared/claude360.ts`
  - 增加 token/group/model/topup/stat 类型。

- Modify: `claude360-Copilot/src/shared/app-settings-provider.ts`
  - 增加 Claude360 provider profile 构造或 normalize helper。

- Modify: `claude360-Copilot/src/main/upstream-models.ts`
  - 优先返回 Claude360 model cache 和 provider groups。

- Modify: `claude360-Copilot/src/main/upstream-models.test.ts`
  - 覆盖 Claude360 模型源。

- Modify: `claude360-Copilot/src/main/services/write-inline-completion-service.ts`
  - 写作补全 provider 解析只接受 Claude360 自动生成 profile。

- Modify: `claude360-Copilot/src/main/services/write-inline-completion-service.test.ts`
  - 覆盖 Claude360 provider 和屏蔽自定义 provider。

- Modify: `claude360-Copilot/src/main/ipc/app-ipc-schemas.ts`
  - 增加 token/model/billing IPC schema。

- Modify: `claude360-Copilot/src/main/ipc/register-app-ipc-handlers.ts`
  - 注册 `claude360:tokens:*`、`claude360:models:*`、`claude360:billing:*`。

- Modify: `claude360-Copilot/src/shared/kun-gui-api.ts`
  - 增加 typed IPC 方法。

- Modify: `claude360-Copilot/src/preload/index.ts`
  - 暴露对应方法。

- Modify: `claude360-Copilot/src/renderer/src/store/chat-store-types.ts`
  - 增加 `AppRoute` 的 `my`。

- Modify: `claude360-Copilot/src/renderer/src/store/chat-store.ts`
  - 支持 `my` 路由状态。

- Create: `claude360-Copilot/src/renderer/src/components/my/MyPage.tsx`
  - “我的”页主组件。

- Create: `claude360-Copilot/src/renderer/src/components/my/MyAccountOverview.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/my/MyBillingPanel.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/my/MyTokenGroupsTable.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/my/MyModelGroupsTable.tsx`
- Create: `claude360-Copilot/src/renderer/src/components/my/MyUsagePanel.tsx`

- Modify: `claude360-Copilot/src/renderer/src/components/Workbench.tsx`
  - 渲染 `my` 路由。

- Modify: `claude360-Copilot/src/renderer/src/components/chat/Sidebar.tsx`
  - 左下角增加“我的”入口，后续计划 04 替换小鸟区域。

- Modify: `claude360-Copilot/src/renderer/src/components/chat/FloatingComposerModelPicker.tsx`
  - 空模型或配置按钮跳到“我的 / 模型与 Key”，不跳供应商设置。

- Modify: `claude360-Copilot/src/renderer/src/components/settings-section-providers.tsx`
  - 隐藏用户新增自定义 provider 的入口，或改为只读展示 Claude360 provider。

- Modify: `claude360-Copilot/src/renderer/src/components/settings-section-write.tsx`
  - 写作模型选项来自 Claude360 模型缓存。

- Create tests:
  - `src/main/services/claude360-token-service.test.ts`
  - `src/main/services/claude360-model-service.test.ts`
  - `src/main/services/claude360-billing-service.test.ts`
  - `src/renderer/src/components/my/MyPage.test.tsx`
  - `src/renderer/src/components/my/MyTokenGroupsTable.test.tsx`

## Data Flow

```text
Login success
  -> claude360SyncAccount()
  -> get /api/cli/me
  -> get /api/cli/groups?tool=codex
  -> get /api/cli/groups?tool=image
  -> get /api/cli/groups?tool=music
  -> ensure text/image/music token as needed
  -> get /api/cli/models
  -> write Claude360 provider profiles
  -> restart runtime if provider profile changed
```

Provider profile ID 使用稳定格式：

```ts
const providerId = `claude360:${groupName}`
```

用户不可编辑这些 profile；如果用户要换分组，通过“我的”页选择功能默认分组。

## Task 1: Token service

**Files:**

- Create: `src/main/services/claude360-token-service.ts`
- Test: `src/main/services/claude360-token-service.test.ts`
- Reference: `src/main/services/claude360-api-client.ts`
- Reference: `src/main/services/claude360-secret-store.ts`

- [x] **Step 1: 写 token list/create/reveal 测试**

Mock API:

- `GET /api/cli/tokens`
- `POST /api/cli/tokens`
- `POST /api/cli/tokens/:id/reveal`

断言：

- list 返回脱敏 token refs。
- create 返回明文 key 后立即加密保存，settings 只写 `secretKeyRef`。
- reveal 只在用户显式操作或 ensure 缺少 secret 时调用。

- [x] **Step 2: 写 ensure group token 测试**

覆盖：

- 已有同 group token 且 secret 可读取时直接返回。
- 已有 token 但 secret 缺失时 reveal 后保存。
- 没有 token 时创建 `Claude360 Copilot / <purpose>`。
- 分组不可用时返回明确错误。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-token-service.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 `Claude360TokenService`**

核心接口：

```ts
ensureGroupToken(group: string, purpose: 'text' | 'image' | 'music'): Promise<Claude360TokenRef>
listTokens(): Promise<Claude360TokenRef[]>
createToken(group: string, name: string): Promise<Claude360TokenRef>
revealToken(tokenId: number): Promise<string>
```

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-token-service.test.ts
```

Expected: PASS。

## Task 2: Model service 与 provider profile 映射

**Files:**

- Create: `src/main/services/claude360-model-service.ts`
- Modify: `src/shared/app-settings-provider.ts`
- Modify: `src/shared/claude360.ts`
- Test: `src/main/services/claude360-model-service.test.ts`
- Test: `src/shared/app-settings-provider.test.ts`

- [x] **Step 1: 写模型映射测试**

输入：

- groups: `auto`、`vip`、`image-group`。
- models: Claude、GPT/Codex、image generation。

断言：

- 输出 provider ID 为 `claude360:<group>`。
- baseUrl 固定为 `https://claude360.xyz`。
- endpointFormat 使用现有 OpenAI-compatible chat completions 格式。
- image 模型带 image capability。
- text 模型默认支持 tool calling。

- [x] **Step 2: 写缓存刷新测试**

断言：

- `refreshModelCache()` 写入 `settings.claude360.modelCache`。
- provider profiles 被整体替换为 Claude360 自动生成 profile。
- 不保留旧自定义 provider。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-model-service.test.ts src/shared/app-settings-provider.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 model service**

核心接口：

```ts
refreshGroupsAndModels(): Promise<Claude360ModelSyncResult>
buildProviderProfiles(input: Claude360ModelCache, tokens: Record<string, string>): ModelProviderProfileV1[]
```

实现要求：

- 分组按 `/api/cli/groups?tool=codex`、`tool=image`、`tool=music` 拉取，不硬编码音乐/图片分组名。
- 模型按 `/api/cli/models?group=<group>` 或 `/api/cli/models?tool=<tool>` 拉取。
- 若后端返回 tags/endpoints，优先用元数据；否则用保守推断。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-model-service.test.ts src/shared/app-settings-provider.test.ts
```

Expected: PASS。

## Task 3: Billing service

**Files:**

- Create: `src/main/services/claude360-billing-service.ts`
- Test: `src/main/services/claude360-billing-service.test.ts`
- Reference: `newapi/controller/cli.go`

- [x] **Step 1: 写账号余额测试**

Mock `GET /api/cli/me`，断言 service 返回：

- username/displayName/email。
- balance display。
- today token/request usage。
- low balance flag。

- [x] **Step 2: 写充值测试**

Mock：

- `GET /api/cli/topup/options`
- `POST /api/cli/topup/wechat`
- `GET /api/cli/topup/order`

断言：

- 金额必须来自后端 options 或满足 min_topup。
- 订单轮询只接收当前订单。
- 失败 message 可展示。

- [x] **Step 3: 写 token stats 测试**

Mock `GET /api/cli/token_stats`，断言参数转发并返回聚合数据。

- [x] **Step 4: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-billing-service.test.ts
```

Expected: FAIL。

- [x] **Step 5: 实现 billing service**

核心接口：

```ts
getMe(): Promise<Claude360Me>
getTopupOptions(): Promise<Claude360TopupOptions>
createWechatTopup(input: Claude360WechatTopupInput): Promise<Claude360TopupOrder>
getTopupOrder(orderId: string): Promise<Claude360TopupOrderStatus>
getTokenStats(input: Claude360TokenStatsQuery): Promise<Claude360TokenStat[]>
```

- [x] **Step 6: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-billing-service.test.ts
```

Expected: PASS。

## Task 4: IPC 接入 token/model/billing

**Files:**

- Modify: `src/main/ipc/app-ipc-schemas.ts`
- Modify: `src/main/ipc/app-ipc-schemas.test.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.ts`
- Modify: `src/main/ipc/register-app-ipc-handlers.test.ts`
- Modify: `src/shared/kun-gui-api.ts`
- Modify: `src/preload/index.ts`

- [x] **Step 1: 写 IPC schema 测试**

覆盖：

- create token payload 的 group/name 校验。
- reveal token id 必须为正整数。
- topup amount 必须为正数。
- token stats 时间戳可选。

- [x] **Step 2: 写 IPC handler 测试**

Mock services，断言 channels 调用正确方法：

- `claude360:tokens:list`
- `claude360:tokens:ensure`
- `claude360:tokens:create`
- `claude360:tokens:reveal`
- `claude360:models:refresh`
- `claude360:models:list`
- `claude360:billing:me`
- `claude360:billing:topup-options`
- `claude360:billing:topup-wechat`
- `claude360:billing:topup-order`
- `claude360:billing:token-stats`

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 IPC 和 preload**

保持返回值为 `{ ok: true, ... } | { ok: false, message }` 风格，renderer 不接收 API Key 明文，除非用户显式 reveal 并复制。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts
npm run typecheck
```

Expected: PASS。

## Task 5: Code 和写作模型源收口

**Files:**

- Modify: `src/main/upstream-models.ts`
- Modify: `src/main/upstream-models.test.ts`
- Modify: `src/renderer/src/components/chat/FloatingComposerModelPicker.tsx`
- Modify: `src/renderer/src/components/chat/FloatingComposer.test.ts`
- Modify: `src/main/services/write-inline-completion-service.ts`
- Modify: `src/main/services/write-inline-completion-service.test.ts`
- Modify: `src/renderer/src/components/settings-section-write.tsx`
- Modify: `src/renderer/src/components/settings-section-write.test.ts`

- [x] **Step 1: 写 upstream models 测试**

断言：

- Claude360 model cache 存在时返回 Claude360 groups。
- 无 Claude360 登录时返回空或明确错误，不回落到 DeepSeek 默认模型。
- `defaultModelId` 来自推荐模型或 cache 第一个模型。

- [x] **Step 2: 写写作补全 provider 测试**

断言：

- `resolveWriteInlineCompletionApiKey` 只能解析 `claude360:*` profile。
- 旧 custom provider 被忽略或迁移清理。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/upstream-models.test.ts src/main/services/write-inline-completion-service.test.ts src/renderer/src/components/settings-section-write.test.ts
```

Expected: FAIL。

- [x] **Step 4: 修改模型读取逻辑**

实现：

- `fetchUpstreamModelIds` 从 Claude360 cache/provider profiles 读取。
- composer model picker 的配置按钮跳到 `my`。
- 写作设置不展示自定义 provider 文案和输入。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/upstream-models.test.ts src/main/services/write-inline-completion-service.test.ts src/renderer/src/components/settings-section-write.test.ts src/renderer/src/components/chat/FloatingComposer.test.ts
```

Expected: PASS。

## Task 6: “我的”页路由和 UI

**Files:**

- Modify: `src/renderer/src/store/chat-store-types.ts`
- Modify: `src/renderer/src/store/chat-store.ts`
- Modify: `src/renderer/src/store/chat-store-navigation-actions.test.ts`
- Modify: `src/renderer/src/components/Workbench.tsx`
- Modify: `src/renderer/src/components/chat/Sidebar.tsx`
- Create: `src/renderer/src/components/my/MyPage.tsx`
- Create: components listed in File Structure
- Test: `src/renderer/src/components/my/MyPage.test.tsx`

- [x] **Step 1: 写路由测试**

断言 `setRoute('my')` 合法，`settingsReturnRoute` 支持从“我的”页回到工作台。

- [x] **Step 2: 写 MyPage 渲染测试**

Mock `window.kunGui`：

- `claude360BillingMe`
- `claude360TokensList`
- `claude360ModelsList`
- `claude360BillingTokenStats`

断言页面显示：

- 账号。
- 余额。
- 今日 tokens/requests。
- API Key 分组。
- 分组倍率。

- [x] **Step 3: 写创建 Key 测试**

断言点击创建按钮调用 `claude360TokensEnsure` 或 `claude360TokensCreate`，成功后刷新列表。

- [x] **Step 4: 写充值测试**

断言：

- 充值 options 渲染金额。
- 微信充值成功展示二维码。
- 订单轮询成功后刷新余额。

- [x] **Step 5: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/my/MyPage.test.tsx
```

Expected: FAIL。

- [x] **Step 6: 实现 UI**

设计要求：

- 左下角入口使用账号/用户图标，不使用小鸟形象。
- 操作按钮使用 lucide 图标和简短文案。
- API Key 明文默认不显示；reveal 后只短暂展示或直接复制。
- 低余额状态显示充值入口。

- [x] **Step 7: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/my/MyPage.test.tsx
npm run typecheck
```

Expected: PASS。

## Task 7: 隐藏自定义供应商入口

**Files:**

- Modify: `src/renderer/src/components/settings-section-providers.tsx`
- Modify: `src/renderer/src/components/settings-section-agents.tsx`
- Modify: `src/renderer/src/components/settings-section-agents.test.ts`
- Modify: `src/renderer/src/components/provider-model-editor.test.ts`

- [x] **Step 1: 写 UI 测试**

断言：

- 设置页不显示“新增供应商”“导入模型供应商”“Base URL”“API Key”给普通用户配置。
- Claude360 provider 可只读展示或从“我的”页进入。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/settings-section-agents.test.ts src/renderer/src/components/provider-model-editor.test.ts
```

Expected: FAIL 或旧断言需更新。

- [x] **Step 3: 隐藏或只读化供应商配置**

保留底层 provider profile 解析，不删除代码。只隐藏用户手动配置入口，避免破坏 runtime。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/settings-section-agents.test.ts src/renderer/src/components/provider-model-editor.test.ts
```

Expected: PASS。

## Task 8: 回归验证

- [x] **Step 1: 运行本计划相关测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/services/claude360-token-service.test.ts src/main/services/claude360-model-service.test.ts src/main/services/claude360-billing-service.test.ts src/main/upstream-models.test.ts src/main/services/write-inline-completion-service.test.ts src/renderer/src/components/my/MyPage.test.tsx src/renderer/src/components/settings-section-write.test.ts
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

- 登录后模型下拉出现 Claude360 模型。
- 点击左下角“我的”能打开页面。
- 不出现手动供应商配置入口。
- 未登录时模型调用不可继续。

## Risk Notes

- 自动创建 Key 可能触发用户 Key 数量上限，必须展示后端错误并提供网页管理入口。
- 分组名不能硬编码，尤其是 music/image。
- reveal API Key 必须是用户显式动作，不能页面加载时自动 reveal 全部 Key。
- 关闭自定义 provider 时不要删除底层 settings 字段，避免 runtime 和测试大面积回归。
- 模型 cache 需要手动刷新入口，避免后端模型变更后客户端长时间不更新。
