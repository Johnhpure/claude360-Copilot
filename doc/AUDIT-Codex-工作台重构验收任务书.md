# Codex 代码审查与功能验收任务书 — 生图/音乐工作台重构

> 面向 Codex 的独立验收提示词。请对本次「生图工作台 + 音乐工作台重构」生成的**全部代码**做功能性审查与验收，产出带编号的问题清单。你无需征求作者在场，按本文件自助完成。

---

## 〇、你的角色与目标

你是一名严格的资深审查者。目标：**验证本次重构的每一处改动在功能上正确、符合既定原型与约束、无回归、无凭据泄露**。不要客气，重点找真实缺陷；同时确认"应该做到的"是否真的做到了。

代码库根目录：`/root/app/claude360agent/claude360-Copilot/`（Electron 34 + React 19 + TS + Vite + Vitest + zod）。
参考项目（本次是"移植"其能力，非原创）：
- `/root/app/claude360agent/infinite-canvas/`（生图能力来源）
- `/root/app/claude360agent/claude360-music-web/`（音乐能力来源）
- `/root/app/claude360agent/newapi/`（Go 后端中转站，**本次约定零改动**）

可视化原型（改动应与之一致）：
- `doc/mockups/canvas-workbench-mockup.html`
- `doc/mockups/music-workbench-mockup.html`

---

## 一、任务背景

把生图 / 音乐两个工作台按已确认的 HTML 原型重构。**核心约束（作者反复强调）：这些功能在 infinite-canvas / claude360-music-web / newapi 里都已实现，本次是"移植"，非必要不新增接口。** 经调研确认：六项新能力 newapi 后端**全部零改动**（图像 `quality/output_format/size` 是 `dto.ImageRequest` 的 known 字段会透传；音乐一句话生成就是 `custom_mode:false`；封面 `image_url` 已端到端；写词助手走已存在的 `/v1/chat/completions`）。所有改动收敛在客户端。

---

## 二、验收红线（务必逐条核验）

1. **后端零改动**：`newapi/` 目录本次不应有任何改动。若发现改了后端，标 Critical。
2. **不新增多余接口**：除"通用文本流式 chat"这一个客户端 IPC（走已存在的 `/v1/chat/completions`）外，不应新增其它 IPC / 后端路由。文本模型下拉、text 分组必须**复用现有** `claude360ModelsByGroup` / `claude360GroupsList`。
3. **无 API Key 泄露**：renderer / shared 类型里绝不出现明文 API Key；Key 只在 main 进程读取使用；持久化（localStorage）绝不含 Key。
4. **与原型一致**：控件、布局、参数集合应与两个 mockup HTML 一致。
5. **门禁全绿**：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 必须全绿（作者自测：typecheck ✅ / lint 0 error 14 既有 warning / test 244 文件 2132 测试 / build ✅）。请你独立复跑确认。

---

## 三、改动文件清单（按层）

### 新增
- `src/shared/lyrics-prompt.ts` — 写词 prompt 纯函数（迁移自 music-web）
- `src/main/services/claude360-chat-service.ts`（+ `.test.ts`）— 通用文本流式 chat 服务
- `src/main/claude360-chat-stream-ipc.ts` — chat 流式 IPC（照 `runtime-sse-ipc.ts` 范式）
- `src/renderer/src/music/music-player-store.ts`（+ `.test.ts`）— 播放器状态机
- `src/renderer/src/music/lyrics-ai.ts`（+ `.test.ts`）— 写词流式生成编排

### 删除
- `src/renderer/src/components/canvas/ImageEditorPanel.tsx`（+ `.test.ts`）— 图像编辑功能已移除

### 修改
**shared**：`claude360-canvas.ts`（size 放开 + 宽高比预设/分辨率/质量/输出格式）、`claude360-music.ts`（mode `simple|standard`→`oneshot|standard`）、`kun-gui-api.ts`（chat 类型+方法）
**main**：`services/claude360-canvas-service.ts`（generate body 白名单加 quality/output_format）、`ipc/app-ipc-schemas.ts`（canvas size 改正则 + quality/output_format + chat schema）、`index.ts`（DI 装配 chat service + 注册 IPC）
**preload**：`index.ts`（chat 流式方法）
**renderer/生图**：`canvas/canvas-store.ts`、`canvas/canvas-workbench-actions.ts`、`components/canvas/ImagePromptPanel.tsx`、`components/canvas/CanvasWorkbench.tsx`
**renderer/音乐**：`music/suno-params.ts`、`components/music/MusicCreatePanel.tsx`、`components/music/MusicPlayer.tsx`、`components/music/MusicWorkbench.tsx`、`components/music/LyricsAssistantDrawer.tsx`
**i18n**：`locales/zh/common.json`、`locales/en/common.json`
**测试**：`app-ipc-schemas.test.ts`、`claude360-canvas-service.test.ts`、`canvas-store.test.ts`、`ImagePromptPanel.test.ts`、`CanvasWorkbench.test.ts`、`suno-params.test.ts`、`music-workbench-actions.test.ts`、`music-components.test.ts`

> 建议先用 `git status` / `git diff` 看全量 diff（基线 commit `95232f1`）。

---

## 四、逐功能验收点

### A. 生图工作台（对照 `canvas-workbench-mockup.html` 与 infinite-canvas）

| # | 功能 | 验收标准 |
|---|---|---|
| A1 | **比例选择** | 改为 10 档**宽高比图标网格**（1:1/16:9/9:16/5:4/4:5/4:3/3:4/3:2/2:3/21:9），数据与 infinite-canvas `web/src/lib/image-size-presets.ts` 的 `IMAGE_SIZE_PRESETS` **逐值一致**。核对 `CLAUDE360_ASPECT_PRESETS` 的像素表是否抄错。 |
| A2 | **分辨率 1K/2K/4K** | segmented；选定后 `size` 由 `resolveImageSizeValue(preset, resolution)` 派生为具体像素串（如 `2048x2048`）。默认 2K。 |
| A3 | **质量档** | 自动/高/中/低（`auto/high/medium/low`），对齐 gpt-image `quality` 取值。 |
| A4 | **输出格式** | png/jpeg/webp，位于质量下方常规字段（非折叠）。 |
| A5 | **参考图** | 可选上传；**有参考图时走 `editImage`(不带 mask)**，否则走 `generateImages`。核对 `CanvasWorkbench` 提交分流逻辑与 `submitEdit` 无 mask 路径。 |
| A6 | **移除项** | 图像编辑模式/mask、风格、背景应已从 UI 移除；`ImageEditorPanel` 已删除且无残留引用。 |
| A7 | **四层贯通** | quality/output_format 从 UI→store→actions payload→IPC schema(`.strict()` 已加字段)→canvas-service body 白名单，逐层是否真的透传到 `/v1/images/generations` 请求体？确认 schema `size` 正则 `^(auto|\d{1,5}x\d{1,5})$` 是否恰当、`.transform` 类型窄化是否安全。 |

### B. 音乐工作台（对照 `music-workbench-mockup.html` 与 claude360-music-web）

| # | 功能 | 验收标准 |
|---|---|---|
| B1 | **移除简单模式** | 仅剩「一句话生成 / 标准」两个 tab；`Claude360MusicCreateMode = 'oneshot'\|'standard'`；全库无 `'simple'` 残留。 |
| B2 | **一句话生成** | 仅「模型 + 一句话描述」；`buildSubmitPayload` oneshot 分支必须是 `{prompt:description, model, custom_mode:false}`，**不含** instrumental/歌词/特殊字段（对照 music-web `suno-params.ts` 确认无 `gpt_description_prompt`）。 |
| B3 | **曲风预设** | 标准模式曲风输入 + `STYLE_PRESETS`(11 项，与 music-web `StandardMode.tsx` 一致) chips，点击 toggle 与 `form.style`(逗号串) 双向联动。 |
| B4 | **negative_tags** | 位于曲风 chips **下方**。 |
| B5 | **vocal_gender** | 位于高级参数折叠区**第一排**，其后才是 style_weight/weirdness/persona。 |
| B6 | **移除项** | 参考音频上传、audio_weight、续写/延长(continue_at/continue_clip_id) 应已从 UI 移除。 |
| B7 | **封面显示** | 作品列表 & 播放器读 `song.imageUrl`（已完成显示回传封面，生成中显示占位）；核对 main `claude360-music-service.ts` mapSong 是否映射 `image_url`。 |
| B8 | **增强播放器** | 进度条可拖动 seek、音量、上/下一首、播放队列；`music-player-store` 状态机（queue/index/playing/currentTime/duration/volume）与容器 `<audio>` 事件桥接是否正确（切歌换 src、onEnded→next、音量同步、seek 写 currentTime）。 |
| B9 | **AI 写词助手** | 「✨ AI 写词助手」按钮 → overlay 模态（文本模型下拉/主题+带入描述/语言/情绪/结构 chips/生成/**流式逐 token 回显**/采用并填入）；对照 music-web `LyricsAiDrawer.tsx`。 |

### C. 流式 chat 通道（新增客户端能力，后端不改）

- C1 `claude360-chat-service.ts`：`streamChat` 是否正确命中 `{baseUrl}/v1/chat/completions`、`stream:true`、`Authorization: Bearer <text 分组 Key>`、SSE 逐行 `data:` 解析取 `choices[0].delta.content`、`[DONE]` 收尾、跨块拆分的行能否正确拼接？
- C2 `claude360-chat-stream-ipc.ts`：start 返回 streamId、三 channel（delta/end/error）、`Map<streamId,AbortController>` 生命周期、stop 中止是否正确？异常是否脱敏（不透栈/凭据）？
- C3 `lyrics-ai.ts` `generateLyrics`：按 streamId 过滤订阅、cancel 中止并 stop、start 失败走 onError 是否正确？是否存在 **delta 早于订阅注册而丢失** 的时序风险（start resolve 后才订阅）？请评估该风险是否可接受。
- C4 四件套一致性：preload / kun-gui-api 类型 / schema `claude360ChatStreamStartPayloadSchema` / handler 是否签名对齐、`.strict()` 是否合理。

---

## 五、审查维度（每处改动都过一遍）

1. **功能正确性**：逻辑是否实现了验收点；边界（空列表、无模型、无分组、越界索引、duration=0、参考图为空）是否正确。
2. **错误处理**：网络失败/HTTP 非 2xx/取消 是否有合理反馈且不泄露内部信息。
3. **回归风险**：删除 ImageEditorPanel、改 mode 枚举、放开 size 类型是否遗留悬空引用或破坏既有用例。
4. **与原型/参考一致**：预设数值、参数集合、控件顺序是否与 mockup 和参考项目一致。
5. **约束遵守**：第二节红线逐条。
6. **测试充分性**：新增/改动的测试是否真正覆盖新逻辑（不是只改断言凑绿）；有无该测未测的关键路径。
7. **可维护性/一致性**：是否沿用仓库既有模式（DI service、`renderToStaticMarkup` 测试范式、i18n key 齐全且 zh/en 对齐）。

---

## 六、请执行的验证命令

```bash
cd /root/app/claude360agent/claude360-Copilot
git --no-pager diff 95232f1 --stat        # 全量改动概览
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# 后端应零改动，可复核：
cd /root/app/claude360agent/newapi && git status && go test ./controller ./router
```

---

## 七、产出格式要求

输出一份 Markdown 报告，包含：

1. **总体结论**：通过 / 有条件通过 / 不通过 + 一句话概述。
2. **门禁复跑结果**：四命令实际输出摘要（是否全绿）。
3. **问题清单**：每条编号，格式：
   ```
   [编号] [严重度: Critical/Important/Minor] [文件:行号]
   问题：<描述>
   证据：<代码片段 / 复现>
   建议：<最小修复>
   ```
   - **Critical**：功能不可用 / 安全（Key 泄露）/ 破坏后端零改动约束。
   - **Important**：功能偏离原型或参考、边界缺陷、错误处理缺失、测试凑绿。
   - **Minor**：文案 / 样式 / 可维护性。
4. **红线核验表**：第二节 5 条逐条 ✅/❌ + 依据。
5. **验收点覆盖表**：第四节 A/B/C 各点 ✅/❌ + 依据。

若某项无法判定，明确写"无法判定 + 原因"，不要臆测通过。
