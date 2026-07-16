import { describe, expect, it } from 'vitest'
import {
  createCrashContextRegistry,
  createCrashRecordFactory
} from './crash-context'

describe('crash context registry', () => {
  it('stores only a workspace basename and one-way hash', () => {
    const registry = createCrashContextRegistry()

    expect(
      registry.updateRenderer({
        route: '/chat',
        workspaceRoot: '/home/alice/company/private-project',
        activeThreadId: 'thread-1',
        currentTurnId: 'turn-2',
        busy: true,
        task: { id: 'task-3', status: 'running' }
      })
    ).toBe(true)

    const snapshot = registry.snapshot()
    expect(snapshot.renderer).toMatchObject({
      route: '/chat',
      workspace: {
        basename: 'private-project',
        hash: expect.stringMatching(/^[a-f0-9]{64}$/)
      },
      threadId: 'thread-1',
      turnId: 'turn-2',
      busy: true,
      task: { id: 'task-3', status: 'running' }
    })
    expect(JSON.stringify(snapshot)).not.toContain('/home/alice')
  })

  it('keeps collecting when one synchronous provider throws', () => {
    const registry = createCrashContextRegistry()
    registry.registerProvider('startupPhases', () => ({ 'main:app-ready': 42 }))
    registry.registerProvider('runtime', () => {
      throw new Error('provider unavailable')
    })

    expect(registry.snapshot()).toMatchObject({
      startupPhases: { 'main:app-ready': 42 },
      runtime: null,
      details: { providerErrors: ['runtime'] }
    })
  })
})

describe('createCrashRecordFactory', () => {
  it('redacts secrets and bounds error text before building the record', () => {
    const registry = createCrashContextRegistry()
    registry.registerProvider('runtime', () => ({
      state: 'failed',
      Authorization: 'Bearer runtime-secret'
    }))
    const createRecord = createCrashRecordFactory({
      context: registry,
      getAppVersion: () => '0.1.0',
      getElectronVersion: () => '34.2.0',
      getNodeVersion: () => '22.14.0',
      getChromeVersion: () => '132.0.0.0',
      getAppMetrics: () => [],
      getMemoryUsage: () => ({ rss: 1, heapUsed: 2, heapTotal: 3, external: 4 }),
      getSystemMemory: () => ({ totalBytes: 8_192, freeBytes: 4_096 }),
      now: () => new Date('2026-07-15T08:00:00.000Z'),
      randomId: () => 'fixed-id',
      pid: 321,
      processType: 'browser',
      getUptimeMs: () => 2_000,
      platform: 'linux',
      arch: 'x64',
      packaged: false
    })

    const record = createRecord({
      kind: 'uncaught-exception',
      severity: 'fatal',
      error: new Error(`token=top-secret ${'x'.repeat(3_000)}`),
      details: { password: 'detail-secret', safe: 'visible' }
    })
    const serialized = JSON.stringify(record)

    expect(record.id).toBe('fixed-id')
    expect(record.error.message.length).toBeLessThanOrEqual(2_048)
    expect(serialized).not.toContain('top-secret')
    expect(serialized).not.toContain('runtime-secret')
    expect(serialized).not.toContain('detail-secret')
    expect(serialized).toContain('<redacted>')
    expect(serialized).toContain('visible')
  })
})
