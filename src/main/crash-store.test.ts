import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CrashRecordV1 } from '../shared/crash-types'
import { createCrashStore } from './crash-store'

const testDirectories: string[] = []

function makeDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude360-crash-store-'))
  testDirectories.push(directory)
  return directory
}

function crashRecord(index: number): CrashRecordV1 {
  return {
    schemaVersion: 1,
    id: `record-${index}`,
    kind: index % 2 === 0 ? 'unhandled-rejection' : 'renderer-error',
    severity: 'error',
    occurredAt: new Date(Date.UTC(2026, 6, 15, 8, 0, index)).toISOString(),
    process: { pid: 123, type: 'browser', uptimeMs: index * 100 },
    versions: { app: '0.1.0', electron: '34.2.0', node: '22.14.0' },
    system: { platform: 'linux', arch: 'x64', packaged: false },
    memory: { rss: 1, heapUsed: 2, heapTotal: 3, external: 4 },
    error: { name: 'Error', message: `failure-${index}` },
    context: {
      startupPhases: {},
      runtime: null,
      renderer: null,
      recentIpc: []
    }
  }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('CrashStore', () => {
  it('writes a fatal record synchronously with no temporary file left behind', () => {
    const directory = makeDirectory()
    const store = createCrashStore({ directory })

    const fileName = store.writeFatal(crashRecord(1))

    expect(fileName).toMatch(/^crash-\d{17}-123-record-1\.json$/)
    expect(JSON.parse(readFileSync(join(directory, fileName), 'utf8'))).toEqual(crashRecord(1))
    expect(readdirSync(directory).some((entry) => entry.includes('.tmp'))).toBe(false)
    expect(readdirSync(directory)).not.toContain('crash-index.json')
  })

  it('serializes concurrent writes and retains only the newest index entries', async () => {
    const directory = makeDirectory()
    const store = createCrashStore({ directory, maxRecords: 3 })

    await Promise.all([
      store.enqueue(crashRecord(1)),
      store.enqueue(crashRecord(2)),
      store.enqueue(crashRecord(3)),
      store.enqueue(crashRecord(4))
    ])

    expect((await store.readIndex()).map((entry) => entry.id)).toEqual([
      'record-2',
      'record-3',
      'record-4'
    ])
    expect(readdirSync(directory).some((entry) => entry.includes('.tmp'))).toBe(false)
  })

  it('reconciles fatal records after a corrupt index and skips malformed records', async () => {
    const directory = makeDirectory()
    const store = createCrashStore({ directory })
    store.writeFatal(crashRecord(1))
    store.writeFatal(crashRecord(2))
    await writeFile(join(directory, 'crash-index.json'), '{not-json', 'utf8')
    await writeFile(join(directory, 'crash-invalid.json'), '{also-not-json', 'utf8')

    await store.reconcile()

    expect((await store.readIndex()).map((entry) => entry.id)).toEqual(['record-1', 'record-2'])
  })
})
