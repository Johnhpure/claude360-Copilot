# 06 · GUI · Write 写作模式

> 范围：`src/renderer/src/write/`（领域逻辑、编辑器集成、AI 流水线）+ `src/renderer/src/components/write/`（UI 组件）；后端导出与 AI 推理在主进程 `src/main/services/`（详见 04 章）
> 参考：`docs/WRITE_INLINE_COMPLETION_MODES.zh-CN.md`、`WRITE_INLINE_EDIT_RAG.zh-CN.md`、`WRITE_RETRIEVAL_RAG.zh-CN.md`、`WRITE_INLINE_EDIT_RECENT_EDITS.zh-CN.md`、`tiptap-migration.md`

写作模式是「本地写作空间 + 双引擎编辑器（TipTap 富文本 / CodeMirror 源码与实时预览）+ 行内 AI（补全/改写）+ 侧边写作助手 + 多格式导出」的一体化文档工作台。

## 0. 总体架构与坐标系

- **状态枢纽**：`useWriteWorkspaceStore`（Zustand）持有工作空间、文件树、当前文件内容、保存状态、预览模式、选区、引用片段、最近编辑；动作拆到 file-actions 与 settings-actions。
- **视图枢纽**：`WriteWorkspaceView.tsx`（约 1106 行）串起工具栏、文档面板、行内浮层、信息图/导出/保存。
- **双编辑引擎**：富文本（rich，默认）TipTap(ProseMirror) → `tiptap/WriteRichEditor.tsx`；源码/实时预览（source/live）CodeMirror 6 → `WriteMarkdownEditor.tsx`。
- **统一坐标系**：行内 AI 共用「Markdown 投影坐标」——TipTap 文档经 `tiptap/markdown-projection.ts` 投影成与磁盘 Markdown 同构的纯文本，再喂给 CodeMirror 内核的 `buildInlineCompletionRequestContext`，让策略/评分/payload 模块在两引擎零重复复用。
- **AI 后端契约**：渲染端只调 `window.kunGui.requestWriteInlineCompletion`、`generateWriteInfographic`、`exportWriteDocument` 等 IPC；主进程负责真正的 FIM/chat 推理与 RAG。

---

## 1. 工作区与文件树

### 1.1 多写作空间管理
- **功能**：多个本地目录作为写作空间，记录默认/活动/历史列表。
- **入口**：助手面板/空状态「选择目录」→ pickWriteWorkspace() → window.kunGui.pickWorkspaceDirectory。
- **机制**：settings-actions 中 select/add/removeWriteWorkspace 写回 setSettings({write})，compactWorkspaceRoots 去重规范化，normalizeWriteSettings 路径归一化并兜底回默认空间。

### 1.2 文件树加载与展开
- **功能**：懒加载目录树，只展示写作相关条目（md/markdown/mdx/txt/图片/pdf），隐藏 `.deepseek`、`.git`。
- **机制**：loadDirectory 调 listWorkspaceDirectory，filterWriteEntries 过滤，按目录键缓存进 entriesByDir；toggleDirectory 首次展开才加载；refreshWorkspace 并发刷新；initializeWorkspace 切换空间时恢复上次打开文件（localStorage `kun.write.active-file:<root>`）。

### 1.3 文件增删改
- **机制**：createFile 创建后刷新树并自动打开；renameEntry 自动补 Markdown 扩展名并修正受影响的 activeFilePath；deleteEntry 命中当前文件则清空；三类操作前 cancelExternalSyncAnimation()。

### 1.4 打开文件与三种文件种类
- **机制**：openFile 先 flushSave，再按扩展名分流：图片走 readWorkspaceImage（dataUrl），PDF 走 readWorkspacePdf（base64），文本走 readWorkspaceFile（含 truncated）。图片 IPC 缺失回退 file://。

### 1.5 自动保存、磁盘监听与 Agent 改盘红绿审阅
- **自动保存**：saveStatus==='dirty' 时 `WRITE_AUTOSAVE_MS=900ms` 防抖 flushSave（仅 text、非截断、非只读、非审阅中）；卸载时强制 flush。
- **磁盘监听**：startWriteWorkspaceFileWatch 注册 watchWorkspaceFile，盘上变更回调 syncActiveFileFromDisk/syncActiveImageFromDisk。
- **外部同步打字动画**：syncActiveFileFromDisk 在内容增长且 ≤120k 字符时，用 commonPrefixLength 定位公共前缀，以 16ms/帧逐块打字机追加（externalSyncAnimationToken 防并发），让 Agent 写盘像实时书写。
- **Agent 改盘红绿审阅**：带 reviewAsDiff:true 同步时存入 pendingAgentReview 置 reviewActive，调 markdownHandleRef.beginDiffReview 进入 CodeMirror 合并视图（逐块接受/拒绝）。

### 1.6 写作助手会话注册表
- **机制**（write-thread-registry.ts）：localStorage `kun.write.threadRegistry.v1` 存 {workspaces:{root:{activeThreadId, threadIds[]}}}；每空间最多 20 条、共 80 个空间；writeThreadLooksLikeAssistant 通过标题（`Write Assistant` 或 `[写作上下文]` 前缀）+ 工作空间路径匹配识别历史会话。

---

## 2. 编辑器引擎

### 2.1 TipTap 富文本编辑器（rich，默认）
- **功能**：所见即所得 Markdown，磁盘仍是纯 Markdown。
- **机制**（WriteRichEditor.tsx + markdown-manager.ts）：
  - **扩展集**：StarterKit + TableKit + TaskList/TaskItem + 自定义 WriteLocalImage/WritePasteImage/WriteRichInlineCompletion/WriteRichTermPropagation/WriteRichTemplateShortcuts +（SDD 草稿才挂）SddRequirementBadges + Mod-s 保存。
  - **双向转换**：@tiptap/markdown 的 MarkdownManager（marked，GFM），parseWriteMarkdown/serializeWriteMarkdown 不依赖 DOM。
  - **保真门禁**：auditWriteMarkdownFidelity 对每个外部文档跑 parse→serialize→parse→serialize 要求幂等且纯文本无损，否则渲染 fallback（CodeMirror live）+ 顶部琥珀色横幅；文档 >300k 字符直接判不合格。
  - **外部回流**：applyExternalMarkdownToEditor 按顶层块 diff 做最小替换事务，打 writeRichExternalSyncMeta 标记，不进 undo/不触发 onChange，保住光标/选区/decoration。
  - **命令句柄** WriteRichEditorHandle：getProjectionText、applyProjectedReplacement（行内编辑落地含原文校验）、replaceImageBySrc/insertMarkdownAfterImage、toggleInlineFormat、setBlockType。
- **已知限制**：投影不含行内标记（`**`、`` ` ``、链接语法）；代码块为纯 `<pre>` 无 shiki NodeView；@tiptap/* 锁 3.26.0。

### 2.2 Markdown 投影坐标系
- **机制**（markdown-projection.ts）：visitBlock 递归处理标题/代码块/引用/列表/任务列表/表格/分隔线/图片；projectedOffsetForPos/posForProjectedOffset 经二分 + textBetween 坐标互转；WeakMap 缓存按文档节点投影。行内编辑、选区引用、补全 edit-action、术语传播都基于此坐标。

### 2.3 CodeMirror 源码 / 实时预览编辑器
- **功能**：source 纯源码 + live 所见即所得实时预览（同一 WriteMarkdownEditor，靠 appearance 与 live-preview compartment 切换）；也是 rich 兜底与大文件兜底。
- **机制**：用 Compartment 动态切换 theme/live-preview 扩展/可编辑性/merge 视图；updateListener 单次物化文档后并行驱动 onChange 回写、recentEdits 采集、选区发布、确定性术语传播；受控 value 同步用 externalValueSyncAnnotation 防回环；审阅中冻结同步；行内能力 Tab 模板展开、Mod-s 保存、粘贴图片、行内补全扩展。

### 2.4 Live Preview 的 Widget 机制（CodeMirror）
- **功能**：源码上叠加实时渲染装饰：隐藏 Markdown 标记、代码块/表格/图片/分隔线/任务框/列表符渲染成 widget，但光标所在行（active line）自动揭示原始源码可编辑。
- **机制**（markdown-live-preview.ts + markdown-live-widgets.ts）：
  - **active line 揭示**：collectRevealLines 收集选区所在行不隐藏。
  - **块级缓存**：markdownBlockPreviewField 缓存代码块/表格范围，blockStructureMayHaveChanged 用 `` [`~|] `` 标记快速判断是否需全文重扫，否则只 mapPos 平移缓存。
  - **行内标记隐藏**：CONCEAL_MARKS（HeaderMark/EmphasisMark/CodeMark）+ syntaxTree 遍历，hideMark 隐藏，writeMarkdownHighlight 上样式。
  - **Widget 集合**：HrWidget、ListBulletWidget、TaskCheckboxWidget（点击切换 `[ ]`/`[x]`）、ImageWidget（懒加载 + IPC 读本地图）、TableWidget（点击定位回源码列）、CodeBlockWidget（shiki 高亮 + 点击定位）、CodeBlockToolbarWidget（复制）、InfographicPendingWidget、HtmlEmbedWidget。所有 widget mousedown 都 focusSourceAt 跳回源码编辑。

### 2.5 预览模式（rich / source / live / split / preview）
- **入口/快捷键**：工具栏「实时」按钮 + 下拉菜单；setPreviewMode；存 localStorage `kun.write.preview-mode`。
- **机制**：richModeActive=rich+markdown+livePreview 允许+text；split 同时显示编辑器 + WriteMarkdownPreview，preview 只显示预览；**分屏滚动同步** use-write-split-scroll-sync.ts 按 scrollTop/scrollRange 比例双向同步，用 echo 计数防回声、rAF 节流。

### 2.6 静态 Markdown 预览（split/preview 右栏）
- **机制**（WriteMarkdownPreview.tsx，约 535 行）：react-markdown + remark-gfm + rehype-harden（安全 sanitize），preserveRawMarkdownImageSrc 保留原始图片 src，图片走 loadWriteMarkdownImage，代码块走 highlightCodeHtml（shiki），识别 pending 信息图与 HTML 嵌入；大文件用 useDebouncedValue（60→500ms 阶梯）防抖。

### 2.7 渲染安全门（大文件 / 截断）
- **机制**（write-render-safety.ts）：截断文件全只读关预览；非 markdown 关 live/preview；markdown >`WRITE_SAFE_MARKDOWN_RENDER_MAX_CHARS=300_000` 字符进 large-file 安全模式（关 live/preview 仍可编辑源码）。

### 2.8 块类型与行内格式（确定性，非 AI）
- **块类型**（block-type.ts）：8 种（段落/H1-3/引用/无序/有序/代码）。detectWriteBlockTypeFromLine 检测，applyWriteBlockTypeToLines 重写块标记。
- **行内格式**（inline-format.ts）：粗体/斜体/删除线/行内代码 toggle，按段落切分 segments 混合时统一加格式、全已包裹才取消。
- **应用**：rich 走 TipTap 句柄，source/live 走 WriteMarkdownEditorHandle。

---

## 3. 行内补全（Inline Completion）

行内补全是「自动 ghost text」，分 short（短/心流）与 long（灵感长补全）两自动模式，外加复用同一请求承载的手动 edit 模式。

### 3.1 请求上下文构造
- **机制**（inline-completion/context.ts）：buildInlineCompletionRequestContext 从 EditorState 切窗（prefix 1600/suffix 900 字符）而非全量复制，计算当前行前/后缀、上一非空行、缩进、结构信号（list/quote/heading/table）、句末标点、isAtLineEnd、nextCharIsWord、URL 尾部、段落断点机会，并构造 editCandidate（光标处可编辑词/短语，≤80 字符）。TipTap 端先投影成 Markdown 再喂同一 context builder。

### 3.2 短补全（short）
- **触发**（policy.ts shouldRequestInlineCompletion）：补全开 + 无选区 + 光标后非单词字符 + 足够上下文 + 非 URL 尾部 + 空行需有结构上下文或段落机会。
- **默认参数**：debounce 650ms、maxTokens 96、minAcceptScore 0.52、最大可见 220 字符/6 行、RAG 片段 3。

### 3.3 灵感长补全（long）
- **触发**（shouldRequestLongInlineCompletion）：短补全基础上额外要求长补全开 + 光标在行尾 + 当前行后无剩余文本 + 非表格/标题 + 更高信号。
- **默认参数**：debounce 2800ms、maxTokens 256、minAcceptScore 0.36、最大可见 900 字符/14 行、RAG 片段 5。

### 3.4 双计时器调度与请求生命周期
- **机制**（inline-completion/codemirror.ts）：维护 shortTimer/longTimer；每次变化 sequence+=1 清旧 timer 按 should-request 各设 timer；请求返回校验 requestId===sequence + state 未变 + anchor 匹配否则丢弃。
- **节流与冷却**：MIN_REQUEST_INTERVAL（short 1400ms/long 4500ms）；空响应进入按签名 10s 冷却，30s 窗口累计 3 次空响应触发 8s 全局冷却。

### 3.5 候选评分与展示
- **机制**（feedback.ts evaluateInlineCompletionCandidate）：sanitize + 拦截泄漏协议标记；按长度/行数上限、与 suffix 重复、句边界硬拒；以基础分 + 连续性/结构/段落开头加成 − 重复/边界/泛化/长度惩罚，低于 minAcceptScore 则 suppress。
- **接受/拒绝**：Tab 接受（插入或 edit-action 范围替换），Esc 隐藏；都回调 onFeedback。

### 3.6 Ghost text 渲染
- **CodeMirror**：InlineCompletionWidget（普通 ghost）+ InlineEditReplacementWidget（edit-action：原文删除线 + `=>` 箭头 + 替换预览）。
- **TipTap**：ghostWidget/editReplacementWidget，edit-action 经 mapEditActionToDoc 把投影范围映回 PM 并校验原文一致。

### 3.7 Payload 与后端契约
- **机制**（prompt.ts buildInlineCompletionPayload）：组装 prefix/suffix/mode/cursor/context/signals/policy/preview/editCandidate/recentEdits/model；phraseCandidateFromRecentEdits 用 recentEdits 术语扩展可编辑短语；只有存在「行内改写信号」才把 editCandidate 与 scoped recentEdits 放进 payload。
- **后端**（write-inline-completion-service.ts）：纯 short/long（无 edit 信号）走 FIM `/completions`；mode:edit 或「有 editCandidate + recentEdits」走 chat completions 要求返回 `<<<SHORT/LONG/EDIT ...>>>` 标记块。

---

## 4. 行内改写（Inline Edit）与 RAG

### 4.1 选区改写流程
- **入口/快捷键**：选区浮层 WriteInlineAgent 输入框，Enter 应用改写（PDF 等只读选区改为发侧栏）；快速操作 mode:'edit' 的项也走此路径。
- **机制**（inline-edit.ts + submitInlineEdit）：
  - **短选区扩段落**：buildWriteInlineEditDraft 构造 prefix(尾窗 6000)/suffix(头窗 4000)/original/instruction/scope/recentEdits。
  - **请求承载**：buildWriteInlineEditCompletionRequest 复用 write:inline-completion，mode:'edit' 带 editCandidate，要求返回 `<<<EDIT ...>>>`。
  - **应用与防护**：rich 经 richHandle.applyProjectedReplacement（投影坐标 + 原文校验）；source/live 经 beginDiffReview 进红绿 diff 审阅；返回空文本而原选区非空则报错；多选区不支持；返回后重新定位 scope。

### 4.2 跨文本检索 RAG（BM25 + 关键词）
- **目标**：补全/改写前从同空间其他 md/txt 文件低延迟召回术语/事实/风格片段，不依赖向量库。
- **机制**（主进程 write-retrieval-service.ts）：仅 `.md/.markdown/.mdx/.txt`，跳过 `.git/node_modules/dist`；上限 8000 条目/160 文件/单文件 600KB/720 块；排除当前文件；分块以 Markdown 结构切（~900 字符）；分词英文 token + 中文 2–4 字 n-gram；查询权重（当前行光标前 3.0/上一非空行 2.0/上一行 1.4/文档尾 1.0/prefix 尾窗 0.7，最多 36 token，recentEdits 参与）；排序 BM25(k1=1.2,b=0.72)+keywordBoost；30s TTL 缓存。
- **召回数量**：short 最多 3，long/edit 最多 5。
- **注入**：以隐藏 Markdown 注释放在 FIM prompt 前（chat 模式进 messages），声明 reference-only；失败静默降级。
- **设置开关**：inlineCompletion.retrievalEnabled。

### 4.3 最近编辑上下文（Recent Edits）注入
- **目标**：让模型理解「上一秒在怎么改」，读懂「继续这样改/同样替换」弱指令。
- **采集**：CodeMirror recentEditsFromUpdate（iterChanges，排除 external/term-propagation）；TipTap recentEditsFromRichTransaction（坐标转投影坐标）；AI 原地编辑成功后手动记一条 source:'inline-edit'。
- **裁剪**（recent-edits.ts）：最多 48 条、TTL 2 分钟、3s 窗口连续打字合并成一条、单条裁剪。
- **筛选排序**（recentEditsForInlineEdit）：只取当前文件，按「越新 + 离编辑范围越近 + inline-edit 来源加成」打分，最多注入 8 条。
- **注入**：主进程 buildRecentEditsPromptBlock 加入 prompt，系统约束明确「冲突时优先当前指令」。

### 4.4 确定性同段术语传播
- **功能**：一次性把短语 A 改成 B 时，自动把同自然段其他 A 同步替换（如 `deepseek gui → DeepSeek GUI`），不依赖模型的刚性一致性层。
- **机制**（term-propagation.ts）：buildWriteTermPropagationChanges 用删除/插入文本作种子，限定在 paragraphRangeAt（不跨空行/标题/围栏/分隔线）做大小写不敏感同短语替换，hasSafeTermShape + hasBoundary 防误伤；buildWriteCanonicalTermPropagationChanges 从触碰 token 周围最多 4 token 推断规范术语候选统一大小写；上限单段 6000 字符、最多 16 处变更。
- **接入**：CodeMirror 在 updateListener 派发（打 termPropagationAnnotation）；TipTap 用 WriteRichTermPropagation（appendTransaction）。

---

## 5. 选区浮层、快捷操作、模板与选区引用

### 5.1 选区浮层（WriteInlineAgent）
- **功能**：选中文字后浮现的工具条，聚合块类型、行内格式、AI 改写输入框、快速操作、写作 Agent 切换、引用、信息图。
- **机制**：useLayoutEffect 测高决定上/下方放置；ToolbarButton 阻止 mousedown 防折叠选区；输入框聚焦时 selectionBeforeFocusRef 冻结选区。Enter 改写 / Cmd+Enter 发送侧栏 / askOnly（PDF）只发送。

### 5.2 快速操作（Quick Actions）
- **功能**：内置「润色/解释/重排版/提炼/更有力/更克制/批判」可配置动作，分 edit（原地改写）与 chat（引用 + 发侧栏）。
- **机制**（quick-actions.ts）：resolveWriteQuickActions 填本地化默认；runQuickAction：edit→submitInlineEdit，chat→submitInlineAgent；read-only/非 text 文件过滤 edit 类。

### 5.3 写作 Agent 人设预设
- **机制**（agent-presets.ts）：命名写作助手人设（学术润色/营销文案），人设折进 prompt 上下文不在气泡显示；活动预设 id 存 assistantAgentPresetId。

### 5.4 模板快捷展开
- **机制**（template-shortcuts.ts）：输入 `@date` + Tab 展开为当前日期（formatWriteTemplateDate `YYYY-MM-DD`）。

### 5.5 选区引用（Quoted Selection）
- **功能**：把编辑器/PDF 选区作为引用片段加入写作助手，框定 AI 上下文。
- **机制**（quoted-selection.ts）：quotedSelectionFromEditor 生成引用（文本带行号、PDF 带页号/rects）；composeWritePrompt 把 `[写作上下文]` + `[引用片段]` + `[相关文献上下文]`（RAG）+ 用户输入拼成 prompt；WRITE_ASSISTANT_INTERACTION_RULE 内置「改稿必须用 edit/write 工具落盘，用户红绿 diff 审阅」约定。

### 5.6 选区状态语义比较
- **机制**（write-selection.ts）：writeSelectionStatesEqual 深比较选区快照，打字时空选区不触发无谓订阅重渲染。

---

## 6. 图片附件、信息图与 HTML 嵌入

### 6.1 本地图片渲染与粘贴
- **渲染**：markdown-image.ts loadWriteMarkdownImage 解析相对路径经 readWorkspaceImage 读为 dataUrl，TipTap WriteLocalImage NodeView、CodeMirror ImageWidget、静态预览三处共用。
- **粘贴**：剪贴板图片经 saveWorkspaceClipboardImage 存入工作空间，插入相对路径图片标记。
- **图片选区识别**：selected-image.ts 识别单张本地栅格图被选中，浮层切换图片专属动作。

### 6.2 异步信息图占位
- **功能**：选中文字点「生成信息图」，立即插入动画占位，后台生成，完成替换真实图片。
- **机制**（infographic-pending.ts + *-dom.ts）：用 `kun-pending-infographic://<id>` 协议 src 写占位；三处渲染面（rich NodeView/live widget/静态预览）画「画笔作画」SVG 动画；completeInfographicGeneration 调 generateWriteInfographic，resolveInfographicPlaceholder 用 replaceImageBySrc（rich，保 undo）或 replacePendingInfographicInText（source）替换；文档切走时直接 patch 磁盘。

### 6.3 HTML 原型嵌入
- **功能**：生成的 HTML 原型（`![alt](../proto/x.html)`）以封面卡呈现，点「运行原型」才挂载 webview。
- **机制**（html-embed-dom.ts）：仅点击后经 authorizeWritePrototype 授权路径再设 webview src（独立非持久 kun-proto 分区、sandbox）；isHtmlEmbedSrc 识别，三处渲染面共用。

---

## 7. 导出与富文本复制

- **格式**（shared/write-export.ts）：`WRITE_EXPORT_FORMATS = ['html','pdf','doc','docx']` + 复制为富文本到剪贴板。
- **入口**：工具栏导出下拉菜单 → exportCurrentFile(format)/copyCurrentFileAsRichText()。
- **机制**：渲染端把 fileContent 经 exportWriteDocument IPC 传主进程；主进程 react-markdown + remark-gfm + renderToStaticMarkup 渲染带内置 CSS（A4）的 HTML，PDF 经离屏 BrowserWindow printToPDF，docx 经 html-to-docx；导出仅对 text 文件可用，结果以 exportNotice（`WRITE_EXPORT_NOTICE_MS=3600ms` 自动消失）提示。

---

## 8. 侧边写作助手与字号控制

- **写作助手**（WriteAssistantPanel.tsx）：复用 MessageTimeline + FloatingComposer，带工作空间覆盖、引用片段托盘（quotedSelections）、空状态快捷卡（总结/大纲/润色选区）；发送 prompt 由 composeWritePrompt 注入写作上下文/引用/RAG/Agent 人设。
- **字号控制**（WriteFontSizeControl.tsx）：调节 `--write-editor-font-size` CSS 变量。
- **保存状态/审阅角标**（WriteWorkspaceToolbar.tsx）：saved/dirty/saving/error/只读/审阅中多态角标。

---

## 9. 测试覆盖速览

写作模块自带大量单测（与源码同名 `.test.ts`），覆盖：补全 short/long 触发与评分、edit-action 解析、RAG 片段注入与中英文分词、recent-edits 的 TTL/合并/当前文件过滤、同段术语传播与词边界、live preview 块扫描与揭示、TipTap markdown 往返保真、quoted-selection 拼装、thread-registry 识别、render-safety 门控、infographic 占位替换等。`docs/` 下 5 篇中文技术说明与本章一一对应。
