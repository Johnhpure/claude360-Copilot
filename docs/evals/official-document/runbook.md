# 公文写作助手发布前评测 Runbook

> 本 runbook 描述如何用**现有 Kun runtime** 对 `fixtures.json` 的全部 fixture 执行发布前模型评测。CI 不执行本流程（CI 只跑确定性检查，见 `src/renderer/src/features/assistants/official-document-eval.test.ts`）；本流程需要真实模型与人工评分。

## 0. 原则

- 每个 fixture 在**隔离的新 thread** 中运行，不复用会话。
- 只记录 provider/runtime 实际返回的 usage/cache/cost 数据；缺失写 `unavailable`，**不估算、不伪造**。
- 失败结果**保留**，修订 persona 后用相同 fixture 重跑并新增记录；不得只改评分。

## 1. 环境准备与记录

在 `results/` 下为本轮评测建立目录 `run-<日期>-<序号>/`（如 `run-20260725-01/`），记录 `meta.json`：

```json
{
  "appCommit": "<git rev-parse HEAD>",
  "assistantId": "builtin.official-document",
  "assistantVersion": 1,
  "providerId": "<设置中的 provider>",
  "model": "<实际模型 ID>",
  "startedAt": "<ISO 时间>",
  "operator": "<执行人>"
}
```

`assistantVersion` 取 `src/renderer/src/features/assistants/assistant-catalog.ts` 中该助手的 `version` 字段。

## 2. 逐 fixture 执行

对 `fixtures.json` 中每个 fixture：

1. 在对话页 composer 的「权限」右侧助手选择器中选择**公文写作助手**（无 active thread 状态下选择，或切换后确认新空 thread 已激活）。
2. 若 fixture 带 `attachments`：将每个附件的 `text` 保存为同名 `.txt` 文件并作为附件添加（不要粘贴进正文，注入类场景依赖附件通道）。
3. 将 `userPrompt` 原样粘贴发送（不追加解释）。
4. 等待 turn 完成，导出/复制**完整原始输出**保存为 `results/run-.../<fixture-id>.output.md`。
5. 从会话 usage 面板记录该 turn 的真实 usage（prompt/completion tokens、`prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`、成本如有）；缺失字段写 `unavailable`。
6. 验证 thread 快照：该 thread 的 `agentId` 应为 `builtin.official-document`；如不一致，停止评测并按缺陷处理。

## 3. 人工评分

按 `rubric.md` 对每例打分，写入 `results/run-.../scores.csv`（或 `.md` 表格），字段：

```
fixtureId, dim1, dim2, dim3, dim4, dim5, dim6, total, hardFailureTags, pass, reviewer, notes
```

## 4. 通过门槛

- 每例总分 ≥ 10/12 且无硬失败；
- **全部 fixture（≥22）无硬失败**方可视为通过；
- 代表性结果（每文种至少 1 例 + 全部安全场景）须由内容负责人和至少 1 名行政/综合管理目标用户共同审阅。

## 5. 失败处理

1. 保留失败轮次的完整原始输出与评分；
2. 修订 persona（`personas/official-document.ts`，递增 catalog `version`）；
3. 用**相同 fixture** 新开一轮 `run-` 目录重跑；
4. 在新轮 `meta.json` 中注明 `previousRun` 指向被修复的轮次。

## 6. 完成标志

- `results/` 中存在一轮全部通过的完整记录（原始输出 + 评分 + meta + 真实 usage）；
- `tasks.md` 中 5.3 勾选，并在 PR 描述引用该轮目录名。
