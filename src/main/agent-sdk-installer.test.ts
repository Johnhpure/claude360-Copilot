import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSdkDownloadState,
  AgentSdkInstalledManifest
} from '../shared/agent-sdk-download'
import type { AgentSdkArchiveDownload } from './agent-sdk-download'
import { AgentSdkDownloadFailure } from './agent-sdk-download'
import {
  AGENT_SDK_VERSION,
  agentSdkDownloadLogRecord,
  ensureAgentSdkBinary,
  isAgentSdkPlatformSupported,
  installAgentSdkArchive,
  resolveClaudeBinary
} from './agent-sdk-installer'
import { AgentSdkStateStore } from './agent-sdk-state-store'

const roots: string[] = []
const NOW = '2026-07-16T04:00:00.000Z'
const PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk-linux-x64'
const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`

async function makeUserData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-sdk-install-'))
  roots.push(root)
  return root
}

function archiveFixture(archivePath: string): AgentSdkArchiveDownload {
  return {
    archivePath,
    metadata: {
      packageName: PACKAGE_NAME,
      version: AGENT_SDK_VERSION,
      tarballUrl: 'https://cdn.example/sdk.tgz',
      integrity: INTEGRITY,
      integrityDigest: Buffer.alloc(64, 7),
      tarballFingerprint: 'd'.repeat(64),
      unpackedSize: 240_000_000
    }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent SDK atomic installer', () => {
  it('supports only platform and architecture pairs published by the SDK', () => {
    expect(isAgentSdkPlatformSupported('win32', 'x64')).toBe(true)
    expect(isAgentSdkPlatformSupported('win32', 'arm64')).toBe(true)
    expect(isAgentSdkPlatformSupported('win32', 'ia32')).toBe(false)
    expect(isAgentSdkPlatformSupported('linux', 'x64')).toBe(true)
    expect(isAgentSdkPlatformSupported('darwin', 'arm64')).toBe(true)
    expect(isAgentSdkPlatformSupported('freebsd', 'x64')).toBe(false)
  })

  it('publishes a validated version directory before updating installed.json', async () => {
    const userDataDir = await makeUserData()
    const archivePath = join(userDataDir, 'fixture.tgz')
    await writeFile(archivePath, 'archive')
    const stateStore = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })

    const installed = await installAgentSdkArchive({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      download: archiveFixture(archivePath),
      stateStore,
      nowIso: () => NOW,
      minBinaryBytes: 1,
      extractArchive: async (_archive, stagingDir, binaryName) => {
        await writeFile(join(stagingDir, binaryName), '#!/bin/sh\necho 0.3.193\n', 'utf8')
      },
      healthCheck: async (binaryPath) => {
        expect(await readFile(binaryPath, 'utf8')).toContain('0.3.193')
      }
    })

    const manifest = await stateStore.readInstalledManifest()
    expect(manifest).toMatchObject({
      sdkVersion: AGENT_SDK_VERSION,
      platform: 'linux',
      arch: 'x64',
      relativePath: `versions/${AGENT_SDK_VERSION}/linux-x64/claude`
    })
    expect(installed.path).toBe(resolveClaudeBinary(userDataDir, [], {
      platform: 'linux', arch: 'x64'
    }))
    expect(manifest?.binarySha256).toBe(
      createHash('sha256').update(await readFile(installed.path)).digest('hex')
    )
  })

  it('keeps the previous manifest when health validation fails', async () => {
    const userDataDir = await makeUserData()
    const archivePath = join(userDataDir, 'fixture.tgz')
    await writeFile(archivePath, 'archive')
    const stateStore = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    const previous: AgentSdkInstalledManifest = {
      schemaVersion: 1,
      packageName: PACKAGE_NAME,
      sdkVersion: '0.3.192',
      platform: 'linux',
      arch: 'x64',
      relativePath: 'versions/0.3.192/linux-x64/claude',
      binarySize: 10,
      binarySha256: 'e'.repeat(64),
      tarballIntegrity: INTEGRITY,
      installedAt: NOW
    }
    await stateStore.writeInstalledManifest(previous)

    await expect(installAgentSdkArchive({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      download: archiveFixture(archivePath),
      stateStore,
      nowIso: () => NOW,
      minBinaryBytes: 1,
      extractArchive: async (_archive, stagingDir, binaryName) => {
        await writeFile(join(stagingDir, binaryName), 'broken', 'utf8')
      },
      healthCheck: async () => {
        throw new Error('bad binary')
      }
    })).rejects.toMatchObject({ code: 'binary_invalid' })

    expect(await stateStore.readInstalledManifest()).toEqual(previous)
  })

  it('restores the previous version directory when manifest publication fails', async () => {
    const userDataDir = await makeUserData()
    const archivePath = join(userDataDir, 'fixture.tgz')
    await writeFile(archivePath, 'archive')
    const targetPath = join(
      userDataDir,
      'agent-sdk',
      'versions',
      AGENT_SDK_VERSION,
      'linux-x64',
      'claude'
    )
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, 'previous-binary', 'utf8')
    const previousStore = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    const previous: AgentSdkInstalledManifest = {
      schemaVersion: 1,
      packageName: PACKAGE_NAME,
      sdkVersion: AGENT_SDK_VERSION,
      platform: 'linux',
      arch: 'x64',
      relativePath: `versions/${AGENT_SDK_VERSION}/linux-x64/claude`,
      binarySize: Buffer.byteLength('previous-binary'),
      binarySha256: createHash('sha256').update('previous-binary').digest('hex'),
      tarballIntegrity: INTEGRITY,
      installedAt: NOW
    }
    await previousStore.writeInstalledManifest(previous)
    const publicationError = new Error('manifest publication failed')
    const failingStore = new AgentSdkStateStore({
      userDataDir,
      nowIso: () => NOW,
      writeAtomic: async () => { throw publicationError }
    })

    await expect(installAgentSdkArchive({
      userDataDir,
      platform: 'linux',
      arch: 'x64',
      download: archiveFixture(archivePath),
      stateStore: failingStore,
      nowIso: () => NOW,
      minBinaryBytes: 1,
      extractArchive: async (_archive, stagingDir, binaryName) => {
        await writeFile(join(stagingDir, binaryName), 'replacement-binary', 'utf8')
      },
      healthCheck: async () => undefined
    })).rejects.toThrow('manifest publication failed')

    expect(await readFile(targetPath, 'utf8')).toBe('previous-binary')
    expect(await previousStore.readInstalledManifest()).toEqual(previous)
  })

  it('rejects a manifest when the binary size no longer matches', async () => {
    const userDataDir = await makeUserData()
    const relativePath = `versions/${AGENT_SDK_VERSION}/linux-x64/claude`
    const binaryPath = join(userDataDir, 'agent-sdk', relativePath)
    await mkdir(join(binaryPath, '..'), { recursive: true })
    await writeFile(binaryPath, 'short')
    const stateStore = new AgentSdkStateStore({ userDataDir, nowIso: () => NOW })
    await stateStore.writeInstalledManifest({
      schemaVersion: 1,
      packageName: PACKAGE_NAME,
      sdkVersion: AGENT_SDK_VERSION,
      platform: 'linux',
      arch: 'x64',
      relativePath,
      binarySize: 999,
      binarySha256: 'f'.repeat(64),
      tarballIntegrity: INTEGRITY,
      installedAt: NOW
    })

    expect(resolveClaudeBinary(userDataDir, [], { platform: 'linux', arch: 'x64' }))
      .toBeUndefined()
  })
})

describe('ensureAgentSdkBinary', () => {
  it('projects download logs without response validators or error messages', () => {
    const state: AgentSdkDownloadState = {
      schemaVersion: 1,
      status: 'retrying',
      packageName: PACKAGE_NAME,
      sdkVersion: AGENT_SDK_VERSION,
      platform: 'linux',
      arch: 'x64',
      attempt: 2,
      receivedBytes: 8_388_608,
      totalBytes: 240_000_000,
      etag: 'Bearer secret-token',
      error: {
        code: 'network',
        message: 'proxy http://user:password@example.test failed',
        retriable: true
      },
      updatedAt: NOW
    }

    const record = agentSdkDownloadLogRecord(state)

    expect(record).toEqual({
      packageName: PACKAGE_NAME,
      sdkVersion: AGENT_SDK_VERSION,
      platform: 'linux',
      arch: 'x64',
      phase: 'retrying',
      attempt: 2,
      receivedBytes: 8_388_608,
      totalBytes: 240_000_000,
      errorCode: 'network'
    })
    expect(JSON.stringify(record)).not.toContain('secret-token')
    expect(JSON.stringify(record)).not.toContain('password')
  })

  it('shares one active download across concurrent callers', async () => {
    const userDataDir = await makeUserData()
    const archivePath = join(userDataDir, 'fixture.tgz')
    await writeFile(archivePath, 'archive')
    let downloads = 0
    let releaseDownload: (() => void) | undefined
    const waitForRelease = new Promise<void>((resolve) => { releaseDownload = resolve })
    const downloadArchive = async (): Promise<AgentSdkArchiveDownload> => {
      downloads += 1
      await waitForRelease
      return archiveFixture(archivePath)
    }
    const installArchive = async (): Promise<{ path: string }> => ({
      path: join(userDataDir, 'agent-sdk', 'ready-claude')
    })

    const first = ensureAgentSdkBinary({
      userDataDir,
      kunDirs: [],
      platform: 'linux',
      arch: 'x64',
      dependencies: { downloadArchive, installArchive }
    })
    const second = ensureAgentSdkBinary({
      userDataDir,
      kunDirs: [],
      platform: 'linux',
      arch: 'x64',
      dependencies: { downloadArchive, installArchive }
    })
    await vi.waitFor(() => expect(downloads).toBe(1))
    releaseDownload?.()

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, path: join(userDataDir, 'agent-sdk', 'ready-claude') },
      { ok: true, path: join(userDataDir, 'agent-sdk', 'ready-claude') }
    ])
  })

  it('attaches later callers to progress from the shared download', async () => {
    const userDataDir = await makeUserData()
    const archivePath = join(userDataDir, 'fixture.tgz')
    await writeFile(archivePath, 'archive')
    let releaseDownload: (() => void) | undefined
    const waitForRelease = new Promise<void>((resolve) => { releaseDownload = resolve })
    const laterStates: AgentSdkDownloadState[] = []
    const dependencies = {
      downloadArchive: async (): Promise<AgentSdkArchiveDownload> => {
        await waitForRelease
        return archiveFixture(archivePath)
      },
      installArchive: async (): Promise<{ path: string }> => ({
        path: join(userDataDir, 'agent-sdk', 'ready-claude')
      })
    }

    const first = ensureAgentSdkBinary({
      userDataDir,
      kunDirs: [],
      platform: 'linux',
      arch: 'x64',
      dependencies
    })
    const second = ensureAgentSdkBinary({
      userDataDir,
      kunDirs: [],
      platform: 'linux',
      arch: 'x64',
      dependencies,
      onState: (state) => laterStates.push(state)
    })
    releaseDownload?.()

    await Promise.all([first, second])
    expect(laterStates.map((state) => state.status)).toContain('ready')
  })

  it('returns a structured failure when persistent state cannot be written', async () => {
    const userDataDir = await makeUserData()
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const stateStore = new AgentSdkStateStore({
      userDataDir,
      nowIso: () => NOW,
      writeAtomic: async () => { throw denied }
    })

    await expect(ensureAgentSdkBinary({
      userDataDir,
      kunDirs: [],
      platform: 'win32',
      arch: 'ia32',
      dependencies: { stateStore }
    })).resolves.toMatchObject({ ok: false, code: 'permission' })
  })

  it('rejects unsupported platform/arch without invoking the downloader', async () => {
    const userDataDir = await makeUserData()
    let downloads = 0

    const result = await ensureAgentSdkBinary({
      userDataDir,
      kunDirs: [],
      platform: 'win32',
      arch: 'ia32',
      dependencies: {
        downloadArchive: async () => {
          downloads += 1
          throw new AgentSdkDownloadFailure('network', 'should not run')
        }
      }
    })

    expect(result).toMatchObject({ ok: false, code: 'unsupported' })
    expect(downloads).toBe(0)
  })
})
