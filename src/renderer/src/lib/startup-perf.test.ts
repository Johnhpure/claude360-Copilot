import { describe, expect, it } from 'vitest'
import {
  buildRendererStartupMarks,
  extractNavTiming,
  shortenResourceName,
  summarizeScriptResources,
  type ResourceTimingLike
} from './startup-perf'

describe('extractNavTiming', () => {
  it('rounds the key navigation milestones', () => {
    expect(
      extractNavTiming([{ domContentLoadedEventEnd: 123.6, loadEventEnd: 456.4 }])
    ).toEqual({ domContentLoadedMs: 124, loadEventEndMs: 456 })
  })

  it('returns undefined when there is no entry or the page has not loaded yet', () => {
    expect(extractNavTiming([])).toBeUndefined()
    expect(extractNavTiming([{ domContentLoadedEventEnd: 0, loadEventEnd: 0 }])).toBeUndefined()
  })
})

describe('shortenResourceName', () => {
  it('keeps only the final path segment and strips query/hash', () => {
    expect(shortenResourceName('http://localhost:5173/assets/index-abc123.js?v=1#x')).toBe(
      'index-abc123.js'
    )
    expect(shortenResourceName('index.js')).toBe('index.js')
  })

  it('caps the length at 128 chars', () => {
    expect(shortenResourceName(`http://x/${'a'.repeat(300)}.js`)).toHaveLength(128)
  })
})

describe('summarizeScriptResources', () => {
  const entries: ResourceTimingLike[] = [
    { name: 'http://localhost/assets/index.js', initiatorType: 'script', duration: 30.4 },
    { name: 'http://localhost/assets/vendor.mjs?v=2', initiatorType: 'other', duration: 70.2 },
    { name: 'http://localhost/assets/styles.css', initiatorType: 'link', duration: 500 },
    { name: 'http://localhost/api/data', initiatorType: 'fetch', duration: 900 }
  ]

  it('aggregates script-like resources only (initiatorType script or .js/.mjs urls)', () => {
    expect(summarizeScriptResources(entries)).toEqual({
      count: 2,
      totalDurationMs: 101,
      maxDurationMs: 70,
      maxName: 'vendor.mjs'
    })
  })

  it('returns undefined when no script resources exist', () => {
    expect(summarizeScriptResources([])).toBeUndefined()
    expect(
      summarizeScriptResources([
        { name: 'http://localhost/a.css', initiatorType: 'link', duration: 10 }
      ])
    ).toBeUndefined()
  })

  it('treats non-finite durations as 0 instead of corrupting the totals', () => {
    expect(
      summarizeScriptResources([
        { name: 'a.js', initiatorType: 'script', duration: Number.NaN },
        { name: 'b.js', initiatorType: 'script', duration: 25 }
      ])
    ).toEqual({ count: 2, totalDurationMs: 25, maxDurationMs: 25, maxName: 'b.js' })
  })
})

describe('buildRendererStartupMarks', () => {
  it('copies epoch marks and preload timestamps, attaching summaries only when present', () => {
    const payload = buildRendererStartupMarks({
      epochMarks: { 'module-eval': 1_000, interactive: 2_000 },
      preload: { startedAtEpochMs: 500, readyAtEpochMs: 520 },
      navEntries: [{ domContentLoadedEventEnd: 80, loadEventEnd: 120 }],
      resourceEntries: [{ name: 'x.js', initiatorType: 'script', duration: 12 }]
    })

    expect(payload).toEqual({
      epochMarks: { 'module-eval': 1_000, interactive: 2_000 },
      preload: { startedAtEpochMs: 500, readyAtEpochMs: 520 },
      navTiming: { domContentLoadedMs: 80, loadEventEndMs: 120 },
      scriptResources: { count: 1, totalDurationMs: 12, maxDurationMs: 12, maxName: 'x.js' }
    })
  })

  it('omits optional summaries entirely when timing data is unavailable', () => {
    const payload = buildRendererStartupMarks({
      epochMarks: {},
      preload: { startedAtEpochMs: 0, readyAtEpochMs: 0 }
    })

    expect(payload).toEqual({
      epochMarks: {},
      preload: { startedAtEpochMs: 0, readyAtEpochMs: 0 }
    })
    expect('navTiming' in payload).toBe(false)
    expect('scriptResources' in payload).toBe(false)
  })
})
