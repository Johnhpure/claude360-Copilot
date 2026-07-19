import { describe, expect, it } from 'vitest'
import { isKunHealthResponseBody, resolvePreSpawnProbeTimeoutMs } from './kun-health'

describe('isKunHealthResponseBody', () => {
  it('accepts Kun serve health responses', () => {
    expect(isKunHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'kun',
      mode: 'serve'
    }))).toBe(true)
  })

  it('rejects generic or legacy runtime health responses', () => {
    expect(isKunHealthResponseBody(JSON.stringify({ status: 'ok' }))).toBe(false)
    expect(isKunHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'codewhale',
      mode: 'serve'
    }))).toBe(false)
  })
})

// 07-19-startup-perf-optimization P2：冷启动短探测决策。
describe('resolvePreSpawnProbeTimeoutMs', () => {
  it('shortens the pre-spawn probe to 200ms on a cold start', () => {
    expect(resolvePreSpawnProbeTimeoutMs({ everSpawned: false, childRunning: false })).toBe(200)
  })

  it('keeps the full 2s probe once a child has ever been spawned', () => {
    expect(resolvePreSpawnProbeTimeoutMs({ everSpawned: true, childRunning: false })).toBe(2_000)
    expect(resolvePreSpawnProbeTimeoutMs({ everSpawned: true, childRunning: true })).toBe(2_000)
  })

  it('keeps the full 2s probe while a child is running', () => {
    expect(resolvePreSpawnProbeTimeoutMs({ everSpawned: false, childRunning: true })).toBe(2_000)
  })
})
