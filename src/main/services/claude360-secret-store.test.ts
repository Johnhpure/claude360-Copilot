import { describe, expect, it } from 'vitest'
import { createClaude360SecretStore, type SecretFileSystem } from './claude360-secret-store'

function inMemoryFs(): SecretFileSystem & {
  dump(path?: string): string | undefined
  mode(path: string): number | undefined
} {
  const files = new Map<string, string>()
  const modes = new Map<string, number>()
  return {
    existsSync: (path) => files.has(path),
    readFileSync: (path) => files.get(path) ?? '',
    writeFileSync: (path, data) => {
      files.set(path, data)
    },
    chmodSync: (path, mode) => {
      modes.set(path, mode)
    },
    dump: (path = '/x/secure-store.json') => files.get(path),
    mode: (path) => modes.get(path)
  }
}

describe('Claude360SecretStore', () => {
  it('round-trips a secret with app-managed local encryption and restricted file modes', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secure-store.json',
      fileSystem: fs
    })
    await store.saveSecret('claude360:cli-token', 'super-secret-abc')
    expect(await store.loadSecret('claude360:cli-token')).toBe('super-secret-abc')
    expect(fs.dump()).not.toContain('super-secret-abc')
    expect(fs.dump()).not.toContain(Buffer.from('super-secret-abc', 'utf8').toString('base64'))
    expect(fs.dump()).toContain('"scheme":"aes-256-gcm-local"')
    expect(fs.dump('/x/secure-store.key')).toBeDefined()
    expect(fs.mode('/x/secure-store.json')).toBe(0o600)
    expect(fs.mode('/x/secure-store.key')).toBe(0o600)
    expect(store.isEncryptionActive()).toBe(true)
  })

  it('deletes a secret', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secure-store.json',
      fileSystem: fs
    })
    await store.saveSecret('claude360:cli-token', 'abc')
    await store.deleteSecret('claude360:cli-token')
    expect(await store.loadSecret('claude360:cli-token')).toBeNull()
  })

  it('clears claude360 secrets while leaving unrelated keys intact', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secure-store.json',
      fileSystem: fs
    })
    await store.saveSecret('claude360:cli-token', 'a')
    await store.saveSecret('claude360:api-key:7', 'b')
    await store.saveSecret('other:keep', 'c')
    await store.clearClaude360Secrets()
    expect(await store.loadSecret('claude360:cli-token')).toBeNull()
    expect(await store.loadSecret('claude360:api-key:7')).toBeNull()
    expect(await store.loadSecret('other:keep')).toBe('c')
  })

  it('does not read legacy safeStorage records when local AES records are absent', async () => {
    const fs = inMemoryFs()
    fs.writeFileSync(
      '/x/secure-store.json',
      JSON.stringify({
        'claude360:cli-token': { enc: true, data: Buffer.from('legacy-safe-storage-cipher').toString('base64') }
      })
    )
    const store = createClaude360SecretStore({
      filePath: '/x/secure-store.json',
      fileSystem: fs
    })
    expect(await store.loadSecret('claude360:cli-token')).toBeNull()
  })

  it('returns null for missing secrets', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({ filePath: '/x/secure-store.json', fileSystem: fs })
    expect(await store.loadSecret('claude360:cli-token')).toBeNull()
  })
})
