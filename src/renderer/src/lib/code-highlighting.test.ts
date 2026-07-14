import { afterEach, describe, expect, it } from 'vitest'
import {
  clearHighlightCodeCache,
  hasCachedHighlightCode,
  highlightCodeCacheSize,
  highlightCodeHtml,
  MAX_HIGHLIGHT_CACHE_ENTRIES
} from './code-highlighting'

describe('code highlighting cache', () => {
  afterEach(() => {
    clearHighlightCodeCache()
  })

  it('raises the LRU capacity to 400 (07-14-timeline-performance R3)', () => {
    expect(MAX_HIGHLIGHT_CACHE_ENTRIES).toBe(400)
  })

  it('caps cached highlighted blocks', async () => {
    for (let index = 0; index < MAX_HIGHLIGHT_CACHE_ENTRIES + 5; index += 1) {
      await highlightCodeHtml(`line-${index}`, 'text')
    }

    expect(highlightCodeCacheSize()).toBe(MAX_HIGHLIGHT_CACHE_ENTRIES)
    expect(hasCachedHighlightCode('line-0', 'text')).toBe(false)
    expect(hasCachedHighlightCode('line-4', 'text')).toBe(false)
    expect(hasCachedHighlightCode('line-5', 'text')).toBe(true)
  })

  it('refreshes cache entries when they are reused', async () => {
    await highlightCodeHtml('line-0', 'text')
    for (let index = 1; index < MAX_HIGHLIGHT_CACHE_ENTRIES; index += 1) {
      await highlightCodeHtml(`line-${index}`, 'text')
    }

    await highlightCodeHtml('line-0', 'text')
    await highlightCodeHtml(`line-${MAX_HIGHLIGHT_CACHE_ENTRIES}`, 'text')

    expect(highlightCodeCacheSize()).toBe(MAX_HIGHLIGHT_CACHE_ENTRIES)
    expect(hasCachedHighlightCode('line-1', 'text')).toBe(false)
    expect(hasCachedHighlightCode('line-0', 'text')).toBe(true)
  })

  it('streaming prefixes (persist: false) never enter the cache', async () => {
    // 模拟流式增长中的代码块：每个前缀都会请求一次高亮
    for (const prefix of ['const a', 'const a =', 'const a = 1']) {
      await highlightCodeHtml(prefix, 'text', { persist: false })
    }

    expect(highlightCodeCacheSize()).toBe(0)
    expect(hasCachedHighlightCode('const a = 1', 'text')).toBe(false)

    // 完成态（默认 persist）照常入缓存
    await highlightCodeHtml('const a = 1', 'text')
    expect(hasCachedHighlightCode('const a = 1', 'text')).toBe(true)
    expect(highlightCodeCacheSize()).toBe(1)
  })

  it('persist: false still reads existing cache entries', async () => {
    const cached = await highlightCodeHtml('shared-code', 'text')
    const reread = await highlightCodeHtml('shared-code', 'text', { persist: false })
    expect(reread).toBe(cached)
    expect(highlightCodeCacheSize()).toBe(1)
  })
})
