# Codex 二次验收整改提示词 — 工作台重构

> 用途：把 Codex 对「生图工作台 + 音乐工作台重构」的二次验收问题整理成 Claude Code 可直接执行的修复任务。
>
> 适用代码库：
> - 客户端：`/root/app/claude360agent/claude360-Copilot`
> - 后端参考目录：`/root/app/claude360agent/newapi`
>
> 关键约束：
> - 不执行 `git commit`、`git push`、`git reset --hard`、新建/切换分支。
> - 不用 `git checkout --` 回退文件；按代码补丁方式做最小修改。
> - 不改无关功能，不做架构扩展。
> - 用户已选择方案 2：保留新增的 Claude360 分组 Key 管理能力，因此接受 `newapi` 为该能力新增 DELETE token 路由。

## 可直接发送给 Claude Code 的提示词

```text
你是 Claude Code，请在以下仓库中修复 Codex 二次验收发现的问题：

客户端根目录：/root/app/claude360agent/claude360-Copilot
后端目录：/root/app/claude360agent/newapi

严格遵守：
1. 不执行 git commit、git push、git reset --hard、新建/切换分支。
2. 不使用 git checkout 回退文件；用最小代码补丁恢复正确状态。
3. 保留新增 Claude360 分组 Key 管理能力：
   - 保留 newapi 的 DELETE /api/cli/tokens/:id 路由。
   - 保留客户端 claude360:tokens:delete / claude360:groups:list / claude360:models:by-group IPC。
   - 保留设置页分组模型与 Key 管理 UI。
4. Key 管理 UI 允许显式 reveal/copy 明文 Key，但不得持久化到 localStorage/settings，不得写日志；复制后应尽快清理 renderer state。
5. 不新增超出 Key 管理和 AI 写词 chat stream 之外的接口。
6. AI 写词助手必须保留，但要修复 stream-start 后才订阅导致 delta/end 事件丢失的竞态。
7. 音乐工作台已移除参考音频上传和 audio_weight UI，合同层也必须移除 audio_weight/audioWeight 残留。
8. 修复后运行并记录：
   cd /root/app/claude360agent/claude360-Copilot
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   cd /root/app/claude360agent/newapi
   git status --short
   go test ./controller ./router

输出修复摘要、实际命令结果、仍有风险。
```

## 验收结论

结论：方案 2 下有条件通过，需修复剩余两个真实缺陷：

- AI 写词流式订阅竞态。
- 音乐 `audio_weight/audioWeight` 合同层残留。
- `newapi` DELETE token 路由、Key 管理 IPC、分组 Key 管理 UI 已作为用户确认保留的新增能力，不再按原零改动红线处理。

已复跑命令结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过，0 error / 14 warning |
| `pnpm test` | 通过，244 files / 2132 tests |
| `pnpm build` | 通过 |
| `cd newapi && git status --short` | 方案 2 接受 `controller/cli.go`、`router/api-router.go`、`controller/cli_token_delete_http_test.go` 变更 |
| `cd newapi && go test ./controller ./router` | 通过 |

## 问题与修改方案

### Accepted-1. 保留后端 DELETE token 路由

状态：用户确认保留

证据：

- `/root/app/claude360agent/newapi/controller/cli.go` 新增 `CliDeleteToken`。
- `/root/app/claude360agent/newapi/router/api-router.go` 新增 `DELETE /api/cli/tokens/:id`。
- `/root/app/claude360agent/newapi/controller/cli_token_delete_http_test.go` 为新增测试文件。

保留要求：

- `CliDeleteToken` 必须继续按 `(id, userId)` 做归属校验。
- 路由必须经过 `CliAccessTokenAuth` 和 `CriticalRateLimit`。
- HTTP 契约测试必须覆盖未授权、删除本人 Key、拒绝越权删除。

### Accepted-2. 保留客户端 Key 管理 IPC

状态：用户确认保留

证据：

- `src/main/ipc/register-app-ipc-handlers.ts`
  - `claude360:tokens:delete`
  - `claude360:groups:list`
  - `claude360:models:by-group`
- `src/preload/index.ts`
  - `claude360TokensDelete`
  - `claude360GroupsList`
  - `claude360ModelsByGroup`
- `src/shared/kun-gui-api.ts`
  - 对应新增 API 类型。

保留要求：

- IPC schema 保持 `.strict()`。
- renderer 不直接拼后端 URL，不接触 cli token。
- 删除 Key 后需清理本地 secret-store 对应缓存。
- `claude360:chat:stream-start` / `claude360:chat:stream-stop` 继续独立保留。

建议重点检查文件：

- `src/main/ipc/app-ipc-schemas.ts`
- `src/main/ipc/register-app-ipc-handlers.ts`
- `src/main/services/claude360-api-client.ts`
- `src/main/services/claude360-model-service.ts`
- `src/main/services/claude360-token-service.ts`
- `src/preload/index.ts`
- `src/shared/kun-gui-api.ts`
- `src/renderer/src/components/settings-section-groups-keys.tsx`
- `src/renderer/src/components/GroupKeyPromptModal.tsx`
- `src/renderer/src/lib/group-key-ensure.ts`
- `src/renderer/src/store/group-key-prompt-store.ts`

### Accepted-3. 保留显式 reveal/copy Key 管理交互

状态：用户确认保留

证据：

- `src/shared/kun-gui-api.ts` 中 `claude360TokensReveal` 返回 `{ key: string }` 给 renderer。
- `src/renderer/src/components/settings-section-groups-keys.tsx`：
  - 调用 `window.kunGui.claude360TokensReveal({ tokenId })`。
  - 将返回 `key` 写入 `revealed` state。
  - 在表格中展示明文并允许复制。

保留要求：

- 明文 Key 仅响应用户显式 reveal 后短暂进入 renderer state。
- 不写入 localStorage、settings、日志。
- 复制后立即清理对应明文 state；页面卸载/刷新列表时清理 reveal state。

### P1-1. AI 写词流式订阅存在竞态

严重度：Important

证据：

- `src/renderer/src/music/lyrics-ai.ts` 先调用 `claude360ChatStreamStart`，在 Promise resolve 后才注册 `onClaude360ChatDelta/onEnd/onError`。
- `src/main/claude360-chat-stream-ipc.ts` 在返回 `{ streamId }` 前已启动异步 `chatService.streamChat()`，上游快响应时可能先发送 delta/end。

影响：

- 首 token 或 end 事件可能丢失。
- UI 可能出现歌词开头缺字，甚至 busy 状态无法结束。

最小修复：

1. renderer 预生成 `streamId`，例如 `lyrics_${Date.now()}_${Math.random().toString(36).slice(2)}`。
2. 先注册 `delta/end/error` 监听。
3. 再调用 `claude360ChatStreamStart({ model, system, user, streamId })`。
4. `cancel()` 必须 cleanup 并调用 `claude360ChatStreamStop(streamId)`。
5. `start` 失败时 cleanup，并调用 `onError`。

建议测试：

- 在 `src/renderer/src/music/lyrics-ai.test.ts` 增加竞态测试：
  - mock `claude360ChatStreamStart` 在返回前同步触发已注册的 delta/end 回调。
  - 期望 delta 不丢失，`onEnd` 被调用。

### P1-2. `audio_weight` 合同层残留

严重度：Important

证据：

- `src/shared/claude360-music.ts` 仍有 `audioWeight` / `audio_weight`。
- `src/main/ipc/app-ipc-schemas.ts` 仍允许 `audio_weight`。
- `src/renderer/src/music/suno-params.ts` 仍会在 `form.audioWeight > 0` 时发 `audio_weight`。

影响：

- UI 虽移除了参考音频权重入口，但 payload 合同仍允许该字段，偏离“参考音频上传、audio_weight 应已移除”的验收标准。

最小修复：

- 从 `Claude360MusicCreateForm` 删除 `audioWeight`。
- 从 `Claude360MusicSubmitPayload` 删除 `audio_weight`。
- 从 `emptyForm()` 删除 `audioWeight` 默认值。
- 从 `buildSubmitPayload()` 删除 `audio_weight` 构造。
- 从 `claude360MusicSubmitPayloadSchema` 删除 `audio_weight`。
- 更新相关测试断言，增加“不发送 audio_weight”的测试。

### P2-1. 测试命名仍残留 simple-mode

严重度：Minor

证据：

- `src/main/ipc/app-ipc-schemas.test.ts` 中存在测试名：`accepts a simple-mode submit with a prompt`。

影响：

- 功能上不阻塞，但与“全库无 simple 残留”的验收口径不一致。

最小修复：

- 将测试名改为 `accepts a oneshot submit with a prompt` 或 `accepts a non-custom submit with a prompt`。
- 确认 `rg -n "simple-mode|mode === 'simple'|mode: 'simple'|['\\\"]simple['\\\"]" src` 无业务残留。

## 建议执行顺序

### Task 1: 验证保留 newapi Key 删除路由

保留：

- `newapi/controller/cli.go`
- `newapi/router/api-router.go`
- `newapi/controller/cli_token_delete_http_test.go`

验证：

```bash
cd /root/app/claude360agent/newapi
go test ./controller ./router
```

期望：

- Go 测试通过。
- `git status --short` 允许显示上述三个文件，因为用户已确认保留 Key 管理扩展。

### Task 2: 验证保留客户端 Key 管理 IPC 与 UI

保留：

- `src/main/ipc/app-ipc-schemas.ts`
- `src/main/ipc/register-app-ipc-handlers.ts`
- `src/main/services/claude360-api-client.ts`
- `src/main/services/claude360-model-service.ts`
- `src/main/services/claude360-token-service.ts`
- `src/preload/index.ts`
- `src/shared/kun-gui-api.ts`
- `src/renderer/src/components/settings-section-groups-keys.tsx`
- `src/renderer/src/components/GroupKeyPromptModal.tsx`
- `src/renderer/src/lib/group-key-ensure.ts`
- `src/renderer/src/store/group-key-prompt-store.ts`

注意：

- 保留 chat stream IPC。
- 保留 `tokens:list/ensure/create/reveal/delete` 和分组/模型查询能力。
- 明文 Key 只允许显式 reveal 后短暂进入 renderer state；不得持久化到 localStorage/settings/log。

验证：

```bash
cd /root/app/claude360agent/claude360-Copilot
rg -n "claude360:tokens:delete|claude360:groups:list|claude360:models:by-group|claude360TokensDelete|claude360GroupsList|claude360ModelsByGroup" src
rg -n "settings-section-groups-keys|GroupKeyPromptModal|group-key-ensure|group-key-prompt-store" src
```

期望：

- 上述引用存在，且类型/preload/main/renderer 调用链一致。

### Task 3: 修复 AI 写词流式竞态

修改：

- `src/renderer/src/music/lyrics-ai.ts`
- `src/renderer/src/music/lyrics-ai.test.ts`

验证：

```bash
cd /root/app/claude360agent/claude360-Copilot
pnpm test src/renderer/src/music/lyrics-ai.test.ts
```

期望：

- 新增竞态测试通过。

### Task 4: 清理 `audio_weight`

修改：

- `src/shared/claude360-music.ts`
- `src/main/ipc/app-ipc-schemas.ts`
- `src/main/ipc/app-ipc-schemas.test.ts`
- `src/renderer/src/music/suno-params.ts`
- `src/renderer/src/music/suno-params.test.ts`
- 其它 TypeScript 报错指向文件。

验证：

```bash
cd /root/app/claude360agent/claude360-Copilot
rg -n "audio_weight|audioWeight" src/shared src/main src/renderer
pnpm test src/renderer/src/music/suno-params.test.ts src/main/ipc/app-ipc-schemas.test.ts
```

期望：

- 业务源码无 `audio_weight/audioWeight` 残留。
- 测试通过。

### Task 5: 全量门禁

验证：

```bash
cd /root/app/claude360agent/claude360-Copilot
pnpm typecheck && pnpm lint && pnpm test && pnpm build

cd /root/app/claude360agent/newapi
go test ./controller ./router
```

期望：

- 客户端四项门禁全绿。
- 后端指定测试通过。

## 修复完成后的验收标准

- `newapi/` 保留 DELETE token 路由及其测试，`go test ./controller ./router` 通过。
- 客户端保留 Key 管理 IPC 与设置页调用链。
- renderer 的明文 Key reveal/copy 仅短暂驻留，不持久化。
- AI 写词助手流式事件无订阅竞态。
- `audio_weight/audioWeight` 从本次音乐工作台合同层彻底移除。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全绿。
- `go test ./controller ./router` 通过。
