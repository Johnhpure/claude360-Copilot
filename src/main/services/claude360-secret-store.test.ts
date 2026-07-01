import { describe, expect, it } from 'vitest'
import {
  createClaude360SecretStore,
  type SafeStorageLike,
  type SecretFileSystem
} from './claude360-secret-store'

function inMemoryFs(): SecretFileSystem & { dump(): string | undefined } {
  let content: string | undefined
  return {
    existsSync: () => content !== undefined,
    readFileSync: () => content ?? '',
    writeFileSync: (_path, data) => {
      content = data
    },
    dump: () => content
  }
}

// 模拟 safeStorage：用可逆变换代替真实加密(前缀 + 反转)，密文不含明文子串。
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from('ENC:' + [...plain].reverse().join(''), 'utf8'),
    decryptString: (buf) => [...buf.toString('utf8').replace(/^ENC:/, '')].reverse().join('')
  }
}

describe('Claude360SecretStore', () => {
  it('round-trips a secret via safeStorage encryption without storing plaintext', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secrets.json',
      safeStorage: fakeSafeStorage(),
      fileSystem: fs
    })
    await store.saveSecret('claude360:cli-token', 'super-secret-abc')
    expect(await store.loadSecret('claude360:cli-token')).toBe('super-secret-abc')
    expect(fs.dump()).toBeDefined()
    expect(fs.dump()).not.toContain('super-secret-abc')
    expect(fs.dump()).toContain('"enc":true')
    expect(store.isEncryptionActive()).toBe(true)
  })

  it('deletes a secret', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secrets.json',
      safeStorage: fakeSafeStorage(),
      fileSystem: fs
    })
    await store.saveSecret('claude360:cli-token', 'abc')
    await store.deleteSecret('claude360:cli-token')
    expect(await store.loadSecret('claude360:cli-token')).toBeNull()
  })

  it('clears claude360 secrets while leaving unrelated keys intact', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secrets.json',
      safeStorage: fakeSafeStorage(),
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

  it('falls back to explicit obfuscation when encryption is unavailable', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({
      filePath: '/x/secrets.json',
      safeStorage: fakeSafeStorage(false),
      fileSystem: fs
    })
    expect(store.isEncryptionActive()).toBe(false)
    await store.saveSecret('claude360:cli-token', 'plain-secret-xyz')
    expect(fs.dump()).not.toContain('plain-secret-xyz')
    expect(fs.dump()).toContain('"enc":false')
    expect(await store.loadSecret('claude360:cli-token')).toBe('plain-secret-xyz')
  })

  it('returns null for missing secrets', async () => {
    const fs = inMemoryFs()
    const store = createClaude360SecretStore({ filePath: '/x/secrets.json', fileSystem: fs })
    expect(await store.loadSecret('claude360:cli-token')).toBeNull()
  })
})
