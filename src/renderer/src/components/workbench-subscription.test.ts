import { describe, expect, it } from 'vitest'
import WorkbenchSource from './Workbench.tsx?raw'

/**
 * AC2 守卫（07-14-timeline-performance R2）：装配层 Workbench 的宽 useShallow
 * 订阅不得包含高频流式字段。这些字段每 100ms SSE 批（或旁聊流式）变化，
 * 订阅进装配层意味着 3000 行组件树整体重渲染。消费点已下沉：
 * - blocks / liveAssistant / liveReasoning → ChatTimelineRegion /
 *   DevBrowserRegion / ChangeInspectorRegion / *AssistantPanelRegion 自行订阅
 * - 派生值 → 稳定引用选择器（selectLatestTurnDevPreviewState /
 *   selectComposerChangeSummary / conversationHasVisionAttachmentsCached /
 *   selectLatestSuccessfulPlanToolBlock）
 */
describe('Workbench 订阅面（AC2）', () => {
  const selectorMatch = WorkbenchSource.match(/useShallow\(\(s\) => \(\{([\s\S]*?)\}\)\)/)

  it('宽订阅选择器存在且不含高频流式字段', () => {
    expect(selectorMatch).toBeTruthy()
    const selectorBody = selectorMatch![1]
    expect(selectorBody).not.toContain('s.blocks')
    expect(selectorBody).not.toContain('s.liveAssistant')
    expect(selectorBody).not.toContain('s.liveReasoning')
    expect(selectorBody).not.toContain('s.sideConversations')
  })

  it('高频字段消费点存在于下沉的 Region 组件中', () => {
    expect(WorkbenchSource).toContain('function ChatTimelineRegion(')
    expect(WorkbenchSource).toContain('function DevBrowserRegion(')
    expect(WorkbenchSource).toContain('function ChangeInspectorRegion(')
    expect(WorkbenchSource).toContain('function WriteAssistantPanelRegion(')
    expect(WorkbenchSource).toContain('function SddAssistantPanelRegion(')
  })

  it('派生消费走稳定引用选择器', () => {
    expect(WorkbenchSource).toContain('selectLatestTurnDevPreviewState(s.blocks, s.liveAssistant)')
    expect(WorkbenchSource).toContain('selectComposerChangeSummary(s.blocks')
    expect(WorkbenchSource).toContain('conversationHasVisionAttachmentsCached(s.blocks)')
  })
})
