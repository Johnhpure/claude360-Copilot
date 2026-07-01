# Codex 审查整改方案与 Claude Code 执行提示词

> 目的：把 Codex 对 Claude360 Copilot 二开项目的代码审查结果整理为可执行整改任务书，便于直接转发给 Claude Code 进行修改。
>
> 范围：
> - 客户端：`/root/app/claude360agent/claude360-Copilot`
> - 后端：`/root/app/claude360agent/newapi`
>
> 硬约束：
> - 不执行 `git commit`、`git push`、`git reset --hard`、新建/切换分支。
> - 不修改 `doc/codex-plan/` 正文。
> - 不回滚用户已有未提交改动。
> - 明文 `cli_token` / API Key 只能在 main 进程使用，除显式 reveal 外不得下发 renderer、不得落 settings、不得进入日志。

## 1. 当前验收结论

结论：阻塞，需修复后再交付。

本轮 Codex 闸门结果：

| 命令 | 结果 | 关键输出 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | exit 0，无错误输出 |
| `npm run lint` | 通过 | `0 errors, 14 warnings`，均为既有 `react-hooks/exhaustive-deps` warning |
| `npm test` | 失败 | `1 failed | 238 passed`，失败在 `src/main/services/local-whisper-service.test.ts:55` |
| `npm run build` | 通过 | exit 0，仅 Vite dynamic import/chunk 警告 |
| `go test ./controller ./router` | 通过 | `ok github.com/QuantumNous/new-api/controller`，`ok .../router` |

## 2. 必修阻塞项

### P0-1. 生图/音乐分组未持久化，原生工作台默认不可用

严重度：Critical  
类别：真实缺陷  
置信度：95

证据：
- `src/shared/app-settings-claude360.ts:25-28` 默认 `selectedImageGroup` / `selectedMusicGroup` 为空。
- `src/main/services/claude360-canvas-service.ts:143-151` 生图服务读取 `selectedImageGroup`，为空即返回“尚未选择生图分组”。
- `src/main/services/claude360-music-service.ts:119-128` 音乐服务读取 `selectedMusicGroup`，为空即返回“尚未选择音乐分组”。
- `src/main/ipc/register-app-ipc-handlers.ts:630-635` `claude360:models:refresh` 只写 `provider.providers` 和 `claude360.modelCache`，没有写入 selected group。
- `src/renderer/src/components/my/MyPage.tsx:67-112` “我的”页刷新只更新组件 state，没有写 settings 的分组选择。

影响：
- 登录/刷新模型后，即使后端返回 image/music 分组，服务层仍会因为 selected group 为空而拒绝提交。
- UI 提示“到我的页选择分组”，但当前没有生产路径完成这个选择。

修复要求：
1. 在模型刷新链路中保留每个 tool 的分组清单和推荐分组信息：
   - `/api/cli/groups?tool=codex`
   - `/api/cli/groups?tool=image`
   - `/api/cli/groups?tool=music`
2. `claude360:models:refresh` 写 settings 时，自动补齐：
   - `selectedTextGroup`
   - `selectedImageGroup`
   - `selectedMusicGroup`
3. 选择规则：
   - 如果当前已选分组仍在对应 tool 分组列表中，保留用户选择。
   - 否则优先使用后端 `recommended === true` 的分组。
   - 否则使用该 tool 返回的第一个可用分组。
   - 如果没有分组，保持空字符串并让 UI 显示明确修复提示。
4. 如实现成本可控，在“我的”页展示当前 image/music/text 分组，并提供选择控件；否则第一阶段至少自动选择可用分组。

测试要求：
- 增加 `Claude360ModelService.refreshGroupsAndModels` 或 IPC handler 单测，覆盖 image/music 分组写入 settings。
- 增加空分组场景测试，确保不会写入不存在的分组。
- 保持现有 `canvas/music service` 单测通过。

### P0-2. `tokenRefs` 按 purpose 保存，导致同 purpose 多 group 复用错误 API Key

严重度：Critical  
类别：真实缺陷  
置信度：95

证据：
- `src/main/services/claude360-model-service.ts:65-91` 遍历多个 group 并调用 `ensureGroupRef(group, purpose)`。
- `src/main/services/claude360-token-service.ts:111-118` 只读取 `settings.tokenRefs[purpose]`，没有校验 `existing.group` 是否等于请求 group。
- `src/main/services/claude360-token-service.ts:133` 写回仍使用 `[purpose]: ref`。
- `src/shared/claude360.ts:106` `Claude360TokenPurpose = 'text' | 'image' | 'music'`，purpose 不是 group 维度。

影响：
- 当 `/api/cli/groups?tool=codex` 返回 `auto` 和 `vip` 两个 text 分组时，`vip/text` 可能复用 `auto/text` token。
- `claude360:vip` provider 的 `apiKeyRef` 会指向错误分组，运行时可能 401、计费走错组或模型不可用。

修复要求：
1. 将 token ref 存储维度改成 `purpose + group`，例如稳定 key：`${purpose}:${group}`。
2. 保留旧数据兼容：
   - 读取时如果存在 legacy `tokenRefs[purpose]`，只有 `legacy.group === group` 才允许复用。
   - 如果 legacy group 不匹配，必须忽略该 ref，继续查列表或创建对应 group token。
3. `ensureInflight` 仍按 `group|purpose` 去重。
4. `writeClaude360` 写入新的 group-scoped key，不再让不同 group 互相覆盖。

测试要求：
- 新增“同 purpose 多 group 不复用 ref”的单测：
  - 初始 `tokenRefs.text = { tokenId: 1, group: 'auto' }`
  - 调用 `ensureGroupToken('vip', 'text')`
  - 期望不会返回 tokenId 1，而是查列表/创建 vip token。
- 保留“同 group|purpose 并发只建一次 token”的测试。
- 保留 legacy group 匹配时可复用旧 ref 的测试。

### P0-3. newapi 不支持 `tool=music`，客户端音乐分组同步失败

严重度：Critical  
类别：真实缺陷  
置信度：95

证据：
- 客户端固定请求 `tool=music`：`src/main/services/claude360-model-service.ts:65-66`。
- 后端 `cliGroupMatchesTool` 只处理 `claude_code`、`codex`、`image`：`controller/cli.go:488-507`。
- `CliListModels` 只对 `tool == "image"` 特判：`controller/cli.go:742-748`。
- 后端现有分组 HTTP 测试只覆盖 codex/image：`controller/cli_models_http_test.go:197`、`:262`。

影响：
- `/api/cli/groups?tool=music` 会返回空列表或错误过滤结果。
- 客户端无法自动同步 music 分组，进而无法设置 `selectedMusicGroup`。

修复要求：
1. 在 newapi 添加 music 工具过滤能力。
2. 优先使用模型/端点元数据判断音乐能力；如果当前代码库没有 music endpoint 常量，则先实现窄范围名称/标签判断，并用注释说明后续迁移到端点能力。
3. `CliListGroups` 支持 `tool=music`。
4. `CliListModels` 如接收 `tool=music`，也应过滤到音乐模型，保持接口契约一致。

测试要求：
- 增加 `TestCliGroupsHTTPFiltersByMusicTool`。
- 增加 `TestCliListModelsHTTPFiltersByMusicTool`，或至少覆盖 `CliListGroups` 的 music 分组返回。
- 保持 `go test ./controller ./router` 通过。

### P0-4. `npm test` 失败：Whisper runner 资源缺失

严重度：Critical  
类别：验收阻塞  
置信度：100

证据：
- `src/main/services/local-whisper-service.test.ts:44-58` 要求四个平台 runner：
  - `darwin-arm64`
  - `win32-x64`
  - `linux-x64`
  - `linux-arm64`
- 当前仓库只存在：
  - `resources/whisper/win32-x64/runner.json`
  - `resources/whisper/win32-x64/whisper-cli.exe`

修复要求：
1. 先确认产品策略：仓库是否应随源码跟踪所有平台 runner。
2. 如果应跟踪全部 runner：补齐缺失目录和二进制资源。
3. 如果 runner 不应全部进仓库：调整测试和准备脚本，使 `npm test` 在当前环境可稳定通过，但不要弱化运行时资源校验。可选方案：
   - 测试改为校验当前平台 runner，并为 release/packaging 增加单独资源校验脚本。
   - 或在 test 前由脚本准备当前平台 runner，跨平台 runner 交给 release pipeline 校验。
4. 最终必须让 `npm test` 在当前仓库根目录通过。

## 3. 安全与稳定性修复

### P1-1. main logger 未统一脱敏

严重度：Important  
类别：真实缺陷  
置信度：90

证据：
- `src/main/logger.ts:83-115` `logError/logWarn` 对 detail 直接 `safeStringify`。
- `src/shared/secret-redaction.ts:1-35` 已有 `redactSecrets` / `redactSecretText`，但 logger 没用。
- `src/main/ipc/register-app-ipc-handlers.ts:1574-1577` renderer 可调用 `log:error` 并传 detail。

修复要求：
1. 在 `src/main/logger.ts` 中统一调用 `redactSecrets` / `redactSecretText`。
2. 字符串 detail 先脱敏再截断。
3. 对象 detail 先深度脱敏，再 stringify，再截断。
4. 异常 fallback `String(value)` 也要脱敏。

测试要求：
- 增加 logger 单测，覆盖：
  - `{ Authorization: 'Bearer sk-xxx' }`
  - `{ apiKey: 'sk-xxx' }`
  - 字符串 `"Authorization: Bearer sk-xxx"`
  - 嵌套对象和数组。

### P1-2. Claude360 API 请求无超时，UI 状态可能长期卡住

严重度：Important  
类别：真实缺陷  
置信度：85

证据：
- `src/main/services/claude360-api-client.ts:78-208` 三类 fetch 均无 `AbortSignal` / timeout。
- `src/renderer/src/components/music/MusicWorkbench.tsx:101-113` `submitting` 在 await 后才恢复。
- `src/renderer/src/canvas/canvas-store.ts:148-167` pending 仅 success/failure 清理。

修复要求：
1. `Claude360ApiClient` 增加统一请求超时，建议默认 120s。
2. 使用 `AbortController`，超时后返回中性错误，例如“请求超时，请稍后重试”。
3. 不把 URL、header、Authorization 或 body 写入错误消息。
4. music/canvas renderer 提交逻辑补 `try/finally`，保证同步异常或立即失败时恢复本地按钮态。
5. 长任务只要求 submit/fetch 请求本身有超时，不要把整个生成任务做成单次长连接等待。

测试要求：
- `claude360-api-client` 增加 fetch 永不 resolve 的超时测试。
- music/canvas actions 或组件测试覆盖失败后 pending 状态恢复。

### P1-3. reveal 后明文 key 在 renderer state 中长期驻留

严重度：Important  
类别：安全硬化缺口  
置信度：75

证据：
- `src/renderer/src/components/my/MyPage.tsx:35` 用 `revealed` state 保存明文 key。
- `src/renderer/src/components/my/MyPage.tsx:123-127` reveal 后写入 state。
- `src/renderer/src/components/my/MyTokenGroupsTable.tsx:68-76` 明文直接显示。

修复要求：
1. 保留显式 reveal 例外，但明文不应长期驻留。
2. 推荐实现：
   - reveal 后显示短 TTL，例如 60 秒。
   - 复制后立即清除该 tokenId 的明文。
   - 离开页面或刷新列表时清空 `revealed`。
3. 不把明文写入 localStorage、settings 或日志。

测试要求：
- 表格默认不显示明文。
- reveal 后显示。
- 调用 copy 后清除，或 TTL 到期后清除。

## 4. 产品与白牌化修复

### P1-4. 可见主路径文案仍残留 Kun / DeepSeek

严重度：Important  
类别：真实缺陷  
置信度：85

证据示例：
- `src/renderer/src/locales/zh/common.json:3-7` 运行时状态显示 Kun。
- `src/renderer/src/locales/zh/common.json:1347` `Kun 不可用...kun serve`。
- `src/renderer/src/locales/zh/common.json:1567-1571` 运行时错误含 Kun / DeepSeek API Key / `kun serve`。
- `src/renderer/src/locales/zh/common.json:1626-1627` 离线 hero 显示 Kun。
- 英文同位置：`src/renderer/src/locales/en/common.json:3-7`、`:1347`、`:1567-1571`、`:1626-1627`。
- 设置页：`src/renderer/src/locales/zh/settings.json:206,899-904,1114`，英文同位置仍有 Kun / DeepSeek。

修复要求：
1. 只替换用户可见主路径文案，不改内部运行时保留边界。
2. 保留以下内部命名：
   - `window.kunGui`
   - `kun-runtime`
   - `KUN_*`
   - `AgentKun`
   - `KunStateFigure`
   - `KunHeroStage`
   - `kun_*.png`
   - R2 release 前缀
   - legacy migration 常量
3. 主路径文案建议替换为：
   - `Kun` -> `Claude360 Copilot` 或 `本地智能体`
   - `DeepSeek API Key` -> `Claude360 API Key`
   - `kun serve` -> 如确为内部命令且用户无需执行，改为“本地运行时”；如果必须展示命令，保留但说明这是本地运行时命令。
4. 隐藏入口的 claw/plugins/workflow 文案可保留，不作为本轮强制修改。

测试要求：
- `rg -n "Kun|DeepSeek|kun serve" src/renderer/src/locales/{zh,en}/{common,settings}.json`
- 对命中的结果逐项分类：主路径必须替换，隐藏入口/内部保留可留下并记录原因。

### P2-1. newapi Rule 5 响应包装不完全一致

严重度：Minor  
类别：规范缺口  
置信度：80

证据：
- `controller/cli.go:382,392,399,411,446,591,612,618` 等位置仍用 `c.JSON(http.StatusOK, gin.H{"success": false, ...})` 直写。

修复要求：
1. 新增/本轮触及的 CLI 路由错误响应统一改为 `common.ApiErrorMsg` 或项目通用包装。
2. 不为了风格大改历史无关代码。
3. 保持 HTTP 行为和客户端解析兼容。

## 5. 架构张力与可延后项

这些项不一定阻塞本轮 P0，但应尽量在本次修改中处理或明确记录：

1. `claude360:models:refresh` 覆盖整个 `provider.providers`：
   - 证据：`src/main/ipc/register-app-ipc-handlers.ts:630-635`
   - 当前因 `SHOW_MANUAL_PROVIDER_CONFIG=false` 风险较低，但迁移遗留自定义 provider 仍可能丢。
   - 建议：只替换 Claude360 自动生成 provider，保留非 Claude360 provider。

2. 多任务轮询 miss 误计：
   - 证据：`src/renderer/src/music/music-workbench-actions.ts:77-90`；`src/renderer/src/music/music-task-store.ts:83-93`
   - 当多个在途任务中一个网络失败、另一个成功时，失败任务可能被当成“未返回”累计 miss。
   - 建议：`pollActiveTasksOnce` 只把成功 fetch 的 taskId 对应结果传入 reducer，并让 reducer 知道本轮实际请求成功的 id 集合；网络失败不应计 miss。

3. 图标仍是占位：
   - 证据：`electron-builder.config.cjs:174-176,186-193,214-217`
   - 后续替换真实 Claude360 设计资源。

## 6. 最终验收要求

客户端仓库 `/root/app/claude360agent/claude360-Copilot`：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

后端仓库 `/root/app/claude360agent/newapi`：

```bash
go test ./controller ./router
```

通过标准：
- `typecheck` 0 error。
- `lint` 0 error；既有 exhaustive-deps warning 可接受，但不得新增 error。
- `npm test` 必须全绿。
- `build` exit 0。
- `go test ./controller ./router` 全绿。

## 7. 可直接发给 Claude Code 的提示词

请把下面整段发送给 Claude Code：

```text
你是资深工程师，请在两个仓库中按下面要求修复 Codex 审查发现的问题。

仓库路径：
- 客户端：/root/app/claude360agent/claude360-Copilot
- 后端：/root/app/claude360agent/newapi

硬约束：
- 不执行 git commit、git push、git reset --hard，不新建/切换分支。
- 不修改 doc/codex-plan/ 正文。
- 不回滚用户已有未提交改动。
- 明文 cli_token / API Key 只能在 main 进程使用；除用户显式 reveal 外不得下发 renderer、不得落 settings、不得进入日志。
- 保留内部运行时边界命名：window.kunGui、kun-runtime、KUN_*、AgentKun、KunStateFigure、KunHeroStage、kun_*.png、R2 release 前缀、legacy migration 常量。

请优先修复 P0，再修 P1。每个修复都要补单测或更新现有测试。完成后运行：

客户端：
cd /root/app/claude360agent/claude360-Copilot
npm run typecheck
npm run lint
npm test
npm run build

后端：
cd /root/app/claude360agent/newapi
go test ./controller ./router

必须修复的问题：

1. 生图/音乐分组未持久化。
- 当前 selectedImageGroup / selectedMusicGroup 默认空，canvas/music service 因此拒绝提交。
- 在 claude360:models:refresh 链路中，基于 /api/cli/groups?tool=codex|image|music 的返回自动选择并持久化 selectedTextGroup、selectedImageGroup、selectedMusicGroup。
- 选择规则：保留仍有效的当前选择；否则用 recommended；否则用第一个可用分组；无分组则保持空并给 UI 明确提示。
- 补测试覆盖 image/music 分组写入 settings。

2. tokenRefs 按 purpose 保存导致跨 group 误复用。
- 修改 src/main/services/claude360-token-service.ts，使 tokenRef 存储维度为 purpose + group，例如 `${purpose}:${group}`。
- 兼容旧 tokenRefs[purpose]：只有 legacy.group === requested group 时才能复用，否则忽略。
- 保持 ensureInflight 按 group|purpose 去重。
- 补“同 purpose 多 group 不复用 ref”的测试。

3. newapi 支持 tool=music。
- 修改 /root/app/claude360agent/newapi/controller/cli.go。
- CliListGroups 支持 tool=music。
- CliListModels 对 tool=music 保持一致过滤。
- 优先使用模型/端点元数据判断音乐能力；若现有代码无 music endpoint 常量，先实现窄范围名称/标签判断并加注释。
- 增加 music tool HTTP 测试。

4. 修复 npm test 中 Whisper runner 资源失败。
- 当前 src/main/services/local-whisper-service.test.ts 要求 darwin-arm64、win32-x64、linux-x64、linux-arm64 runner，但 resources/whisper 只存在 win32-x64。
- 确认项目策略后修复：要么补齐资源，要么调整测试/准备脚本，使 npm test 在当前 Linux 仓库环境稳定通过，同时保留 release/packaging 资源校验。
- 最终 npm test 必须全绿。

5. main logger 统一脱敏。
- 修改 src/main/logger.ts，引入并使用 shared/secret-redaction.ts 中的 redactSecrets/redactSecretText。
- logError/logWarn 的 detail 无论字符串、对象还是 fallback String 都必须脱敏后再写日志。
- 补 logger 单测覆盖 Authorization、Bearer、apiKey、token、password、嵌套对象。

6. Claude360 API 请求增加超时。
- 修改 src/main/services/claude360-api-client.ts。
- get/post/postSunoRaw/postImagesRaw/postImagesMultipart 都要有统一超时，建议默认 120s。
- 使用 AbortController，超时返回中性错误，不泄露 URL/header/body/token。
- renderer 的 music/canvas 提交逻辑补 try/finally，保证失败时 pending/submitting 恢复。
- 补超时测试。

7. reveal 后明文 key 不要长期驻留 renderer。
- 修改 MyPage/MyTokenGroupsTable 相关逻辑。
- 保留显式 reveal 功能，但 reveal 后设置短 TTL，复制后立即清除，离开页面或刷新列表时清空。
- 不写 localStorage/settings/log。
- 补测试。

8. 替换主路径可见 Kun/DeepSeek 文案。
- 重点处理 src/renderer/src/locales/zh/common.json、en/common.json、zh/settings.json、en/settings.json 中运行时状态、离线错误、开机启动、API Key 等主路径文案。
- 不要改内部保留边界和隐藏入口文案。
- 替换后用 rg 检查残留，并在最终说明中列出保留原因。

9. 尽量处理 provider 覆盖问题。
- 当前 claude360:models:refresh 直接覆盖 provider.providers。
- 改为只替换 Claude360 自动 provider，保留非 Claude360 provider，避免迁移遗留自定义 provider 被丢。

请按 KISS/YAGNI 原则实现，优先复用现有类型、settings merge、zod schema、测试风格。最终输出请说明改动文件、测试结果、仍未处理的 OPEN 项。
```

