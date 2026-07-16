import { describe, expect, it } from 'vitest'
import {
  crashRecordV1Schema,
  rendererCrashContextPayloadSchema
} from './crash-types'

function validCrashRecord(): unknown {
  return {
    schemaVersion: 1,
    id: 'crash-record-1',
    kind: 'uncaught-exception',
    severity: 'fatal',
    occurredAt: '2026-07-15T08:00:00.000Z',
    process: {
      pid: 123,
      type: 'browser',
      uptimeMs: 1_500
    },
    versions: {
      app: '0.1.0',
      electron: '34.2.0',
      node: '22.14.0',
      chrome: '132.0.0.0'
    },
    system: {
      platform: 'linux',
      arch: 'x64',
      packaged: false
    },
    memory: {
      rss: 10,
      heapUsed: 20,
      heapTotal: 30,
      external: 40,
      systemTotalKb: 1_024,
      systemFreeKb: 512,
      appMetrics: [{ type: 'Browser', pid: 123, workingSetSizeKb: 64 }]
    },
    error: {
      name: 'Error',
      message: 'boom',
      stack: 'Error: boom\n    at test.ts:1:1'
    },
    context: {
      startupPhases: { 'main:module-eval': 0 },
      runtime: null,
      renderer: null,
      recentIpc: [
        {
          channel: 'settings:get',
          at: '2026-07-15T08:00:00.000Z',
          durationMs: 4,
          failed: false
        }
      ]
    }
  }
}

describe('CrashRecordV1 contract', () => {
  it('accepts a complete versioned crash record', () => {
    expect(crashRecordV1Schema.parse(validCrashRecord())).toEqual(validCrashRecord())
  })

  it('rejects unknown fields and oversized error text', () => {
    expect(
      crashRecordV1Schema.safeParse({
        ...(validCrashRecord() as Record<string, unknown>),
        prompt: 'must never be persisted'
      }).success
    ).toBe(false)

    const oversized = validCrashRecord() as {
      error: { name: string; message: string; stack?: string }
    }
    oversized.error.message = 'x'.repeat(2_049)
    expect(crashRecordV1Schema.safeParse(oversized).success).toBe(false)
  })
})

describe('rendererCrashContextPayloadSchema', () => {
  it('accepts only bounded identifiers and the raw workspace boundary field', () => {
    const payload = {
      route: '/chat/thread-1',
      workspaceRoot: '/home/alice/private-project',
      activeThreadId: 'thread-1',
      currentTurnId: 'turn-2',
      busy: true,
      task: { id: 'task-3', status: 'running' }
    }

    expect(rendererCrashContextPayloadSchema.parse(payload)).toEqual(payload)
    expect(
      rendererCrashContextPayloadSchema.safeParse({ ...payload, prompt: 'secret prompt' }).success
    ).toBe(false)
  })
})
