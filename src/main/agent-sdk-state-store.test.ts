import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  AgentSdkDownloadState,
  AgentSdkInstalledManifest
} from '../shared/agent-sdk-download'
import {
  AgentSdkStateStore,
  agentSdkInstalledManifestPath,
  agentSdkStatePath
} from './agent-sdk-state-store'

const roots: string[] = []
const NOW = '2026-07-16T02:00:00.000Z'

async function makeUserData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-sdk-state-'))
  roots.push(root)
  return root
}

function stateFixture(overrides: Partial<AgentSdkDownloadState> = {}): AgentSdkDownloadState {
  return {
    schemaVersion: 1,
    status: 'idle',
    packageName: '@anthropic-ai/claude-agent-sdk-linux-x64',
    sdkVersion: '0.3.193',
    platform: 'linux',
    arch: 'x64',
    attempt: 0,
    receivedBytes: 0,
    totalBytes: null,
    updatedAt: NOW,
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AgentSdkStateStore', () => {
  it('recovers corrupt state and marks an in-progress restart as interrupted', async () => {
    const userDataDir = await makeUserData()
    const statePath = agentSdkStatePath(userDataDir)
    await writeFile(statePath, '{bad-json', 'utf8').catch(async () => {
      const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
      await store.saveState(stateFixture())
      await writeFile(statePath, '{bad-json', 'utf8')
    })
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })

    expect(await store.loadState(stateFixture())).toEqual(stateFixture())
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(stateFixture())
    await store.saveState(stateFixture({ status: 'downloading', receivedBytes: 512 }))

    const restarted = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    const recovered = await restarted.loadState(stateFixture())
    expect(recovered).toMatchObject({ status: 'interrupted', receivedBytes: 512 })
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ status: 'interrupted' })
  })

  it('replaces state from a different package version before resuming', async () => {
    const userDataDir = await makeUserData()
    const previousStore = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    await previousStore.saveState(stateFixture({
      packageName: '@anthropic-ai/claude-agent-sdk-linux-arm64',
      sdkVersion: '0.3.192',
      arch: 'arm64',
      status: 'interrupted',
      receivedBytes: 42
    }))
    const expected = stateFixture()
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })

    expect(await store.loadState(expected)).toEqual(expected)
    expect(JSON.parse(await readFile(agentSdkStatePath(userDataDir), 'utf8'))).toEqual(expected)
  })

  it('coalesces throttled progress while preserving immediate phase writes', async () => {
    const userDataDir = await makeUserData()
    const writes: AgentSdkDownloadState[] = []
    let nowMs = 1_000
    const store = new AgentSdkStateStore({
      userDataDir,
      nowIso: () => new Date(nowMs).toISOString(),
      nowMs: () => nowMs,
      progressByteThreshold: 1024,
      progressIntervalMs: 1000,
      writeAtomic: async (_path, contents) => {
        writes.push(JSON.parse(contents) as AgentSdkDownloadState)
      }
    })

    await store.saveState(stateFixture({ status: 'resolving' }))
    await store.saveState(stateFixture({ status: 'downloading', receivedBytes: 100 }), {
      throttled: true
    })
    await store.saveState(stateFixture({ status: 'downloading', receivedBytes: 500 }), {
      throttled: true
    })
    await store.saveState(stateFixture({ status: 'downloading', receivedBytes: 1200 }), {
      throttled: true
    })
    nowMs += 1001
    await store.saveState(stateFixture({ status: 'downloading', receivedBytes: 1300 }), {
      throttled: true
    })
    await store.saveState(stateFixture({ status: 'verifying', receivedBytes: 1300 }))
    await store.flush()

    expect(writes.map((state) => [state.status, state.receivedBytes])).toEqual([
      ['resolving', 0],
      ['downloading', 100],
      ['downloading', 1200],
      ['downloading', 1300],
      ['verifying', 1300]
    ])
  })

  it('uses the queued progress watermark when callers do not await writes', async () => {
    const userDataDir = await makeUserData()
    const writes: number[] = []
    const store = new AgentSdkStateStore({
      userDataDir,
      nowIso: () => NOW,
      nowMs: () => 1_000,
      progressByteThreshold: 1024,
      progressIntervalMs: 10_000,
      writeAtomic: async (_path, contents) => {
        writes.push((JSON.parse(contents) as AgentSdkDownloadState).receivedBytes)
      }
    })
    await store.saveState(stateFixture({ status: 'downloading' }))

    const first = store.saveState(stateFixture({ status: 'downloading', receivedBytes: 1200 }), {
      throttled: true
    })
    const second = store.saveState(stateFixture({ status: 'downloading', receivedBytes: 1300 }), {
      throttled: true
    })
    await Promise.all([first, second])

    expect(writes).toEqual([0, 1200])
  })

  it('atomically round-trips the installed manifest', async () => {
    const userDataDir = await makeUserData()
    const store = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    const manifest: AgentSdkInstalledManifest = {
      schemaVersion: 1,
      packageName: '@anthropic-ai/claude-agent-sdk-linux-x64',
      sdkVersion: '0.3.193',
      platform: 'linux',
      arch: 'x64',
      relativePath: 'versions/0.3.193/linux-x64/claude',
      binarySize: 240_000_000,
      binarySha256: 'c'.repeat(64),
      tarballIntegrity: `sha512-${Buffer.alloc(64, 3).toString('base64')}`,
      installedAt: NOW
    }

    await store.writeInstalledManifest(manifest)

    expect(await store.readInstalledManifest()).toEqual(manifest)
    expect(JSON.parse(await readFile(agentSdkInstalledManifestPath(userDataDir), 'utf8')))
      .toEqual(manifest)
  })
})
