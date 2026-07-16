import { describe, expect, it } from 'vitest'
import {
  autoModelHeuristic,
  fixedModelFromCandidates,
  parseAutoRouteRecommendation,
  providerSupportsAutoModelRoute,
  recentAutoRouterContext,
  resolveAutoModelRoute
} from '../src/loop/auto-model-router.js'
import { makeAssistantTextItem, makeToolResultItem, makeUserItem } from '../src/domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'

describe('auto model router', () => {
  it('parses trusted router model recommendations', () => {
    expect(parseAutoRouteRecommendation('{"model":"pro","thinking":"max"}')).toEqual({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max'
    })
    expect(parseAutoRouteRecommendation('noise {"model":"v4-flash"} tail')).toEqual({
      model: 'deepseek-v4-flash'
    })
    expect(parseAutoRouteRecommendation('{"model":"auto"}')).toBeNull()
    expect(parseAutoRouteRecommendation('not json')).toBeNull()
  })

  it('falls back to the heuristic routing shape', () => {
    expect(autoModelHeuristic('hello')).toBe('deepseek-v4-flash')
    expect(autoModelHeuristic('please debug this failing migration')).toBe('deepseek-v4-pro')
    expect(autoModelHeuristic('x'.repeat(501))).toBe('deepseek-v4-pro')
    expect(autoModelHeuristic('x'.repeat(200))).toBe('deepseek-v4-flash')
  })

  it('builds recent context without the active turn', () => {
    const items = [
      makeUserItem({ id: 'u1', threadId: 'thr_1', turnId: 'turn_1', text: 'hello' }),
      makeAssistantTextItem({ id: 'a1', threadId: 'thr_1', turnId: 'turn_1', text: 'hi', status: 'completed' }),
      makeToolResultItem({
        id: 'r1',
        threadId: 'thr_1',
        turnId: 'turn_2',
        callId: 'call_1',
        toolName: 'read',
        output: 'file content'
      }),
      makeUserItem({ id: 'u2', threadId: 'thr_1', turnId: 'turn_3', text: 'latest' })
    ]

    expect(recentAutoRouterContext(items, 'turn_3')).toContain('user: hello')
    expect(recentAutoRouterContext(items, 'turn_3')).toContain('assistant: hi')
    expect(recentAutoRouterContext(items, 'turn_3')).toContain('tool: [tool result] file content')
    expect(recentAutoRouterContext(items, 'turn_3')).not.toContain('latest')
  })

  it('detects DeepSeek-capable providers for the auto route (#codex-model)', () => {
    expect(providerSupportsAutoModelRoute({ configuredModel: 'deepseek-v4-pro' })).toBe(true)
    expect(providerSupportsAutoModelRoute({ configuredModel: 'DeepSeek-V4-Flash' })).toBe(true)
    expect(providerSupportsAutoModelRoute({ providerBaseUrl: 'https://api.deepseek.com' })).toBe(true)
    expect(providerSupportsAutoModelRoute({ providerBaseUrl: 'https://api.deepseek.com/v1' })).toBe(true)

    // Claude360 分组（如 Codex）不提供 deepseek 模型：路由必须回退。
    expect(
      providerSupportsAutoModelRoute({
        configuredModel: 'gpt-5.6-terra',
        providerBaseUrl: 'https://claude360.xyz'
      })
    ).toBe(false)
    expect(providerSupportsAutoModelRoute({})).toBe(true)
    // 宽松字符串匹配不放行非 deepseek 官方域名。
    expect(
      providerSupportsAutoModelRoute({ providerBaseUrl: 'https://deepseek.example.com' })
    ).toBe(false)
  })

  it('extracts the first explicit model from mode candidates', () => {
    expect(fixedModelFromCandidates(['auto', 'grok-4.5', 'gpt-5.6-terra'])).toBe('grok-4.5')
    expect(fixedModelFromCandidates([undefined, ' AUTO ', 'gpt-5.6-terra'])).toBe('gpt-5.6-terra')
    expect(fixedModelFromCandidates(['auto', '', undefined])).toBeNull()
  })

  it('uses the short JSON response path without advertising tools', async () => {
    let seenRequest: ModelRequest | null = null
    const modelClient: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenRequest = request
        yield { kind: 'assistant_text_delta', text: '{"model":"deepseek-v4-flash","thinking":"off"}' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }

    await resolveAutoModelRoute({
      modelClient,
      threadId: 'thr_1',
      turnId: 'turn_1',
      latestRequest: 'hello',
      recentContext: '',
      selectedModelMode: 'auto',
      abortSignal: new AbortController().signal
    })

    const capturedRequest = seenRequest as ModelRequest | null
    expect(capturedRequest?.tools).toEqual([])
    expect(capturedRequest?.responseFormat).toBe('json_object')
  })
})
