import { describe, expect, it } from 'vitest'
import {
  AgentSdkDownloadStateSchema,
  AgentSdkInstalledManifestSchema
} from './agent-sdk-download'

const NOW = '2026-07-16T02:00:00.000Z'

function sha512Sri(byte: number): string {
  return `sha512-${btoa(String.fromCharCode(...new Uint8Array(64).fill(byte)))}`
}

describe('agent SDK download contracts', () => {
  it('accepts the versioned persisted state and rejects sensitive extra fields', () => {
    const state = AgentSdkDownloadStateSchema.parse({
      schemaVersion: 1,
      status: 'downloading',
      packageName: '@anthropic-ai/claude-agent-sdk-linux-x64',
      sdkVersion: '0.3.193',
      platform: 'linux',
      arch: 'x64',
      attempt: 1,
      receivedBytes: 1024,
      totalBytes: 2048,
      integrity: sha512Sri(1),
      tarballFingerprint: 'a'.repeat(64),
      updatedAt: NOW
    })

    expect(state.status).toBe('downloading')
    expect(() => AgentSdkDownloadStateSchema.parse({
      ...state,
      proxyUrl: 'http://user:secret@proxy.example'
    })).toThrow()
  })

  it('validates an installed manifest with a relative binary path and hashes', () => {
    const manifest = {
      schemaVersion: 1,
      packageName: '@anthropic-ai/claude-agent-sdk-linux-x64',
      sdkVersion: '0.3.193',
      platform: 'linux',
      arch: 'x64',
      relativePath: 'versions/0.3.193/linux-x64/claude',
      binarySize: 240_000_000,
      binarySha256: 'b'.repeat(64),
      tarballIntegrity: sha512Sri(2),
      installedAt: NOW
    } as const

    expect(AgentSdkInstalledManifestSchema.parse(manifest))
      .toMatchObject({ schemaVersion: 1, arch: 'x64' })
    expect(() => AgentSdkInstalledManifestSchema.parse({
      ...manifest,
      relativePath: '../outside/claude'
    })).toThrow()
  })
})
