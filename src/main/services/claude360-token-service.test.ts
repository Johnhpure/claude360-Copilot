import { describe, expect, it } from 'vitest'
import { Claude360TokenService, type Claude360ApiClientPort } from './claude360-token-service'
import { type Claude360SecretStore } from './claude360-secret-store'
import {
  defaultClaude360Settings,
  mergeClaude360Settings,
  type Claude360SettingsV1
} from '../../shared/app-settings-claude360'

function fakeSecretStore(seed: Record<string, string> = {}): Claude360SecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    map,
    saveSecret: async (ref, v) => {
      map.set(ref, v)
    },
    loadSecret: async (ref) => map.get(ref) ?? null,
    deleteSecret: async (ref) => {
      map.delete(ref)
    },
    clearClaude360Secrets: async () => {
      for (const k of [...map.keys()]) if (k.startsWith('claude360:')) map.delete(k)
    },
    isEncryptionActive: () => true
  }
}

function fakeApi(routes: Record<string, (body?: unknown) => unknown>, calls: string[] = []): Claude360ApiClientPort {
  const run = (path: string, body?: unknown): unknown => {
    calls.push(path)
    const handler = routes[path]
    if (!handler) throw new Error(`no route ${path}`)
    return handler(body)
  }
  return {
    get: async <T>(path: string) => run(path) as T,
    post: async <T>(path: string, body?: unknown) => run(path, body) as T,
    delete: async <T>(path: string) => run(path) as T
  }
}

function settingsPort(initial?: Partial<Claude360SettingsV1>) {
  let settings: Claude360SettingsV1 = mergeClaude360Settings(defaultClaude360Settings(), initial ?? {})
  return {
    readClaude360: () => settings,
    writeClaude360: (patch: Parameters<typeof mergeClaude360Settings>[1]) => {
      settings = mergeClaude360Settings(settings, patch)
    },
    current: () => settings
  }
}

const CLI = { 'claude360:cli-token': 'cli-access-token' }

describe('Claude360TokenService', () => {
  it('lists tokens with masked keys', async () => {
    const port = settingsPort()
    const service = new Claude360TokenService({
      apiClient: fakeApi({
        '/api/cli/tokens': () => ({
          items: [{ id: 7, name: 'Claude360 Copilot / text', masked_key: 'sk-***abcd', group: 'auto', unlimited_quota: true }]
        })
      }),
      secretStore: fakeSecretStore(CLI),
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const tokens = await service.listTokens()
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ id: 7, maskedKey: 'sk-***abcd', group: 'auto', unlimitedQuota: true })
  })

  it('deletes a token via backend DELETE and clears the local plaintext secret', async () => {
    const port = settingsPort()
    const secret = fakeSecretStore({ ...CLI, 'claude360:api-key:9': 'sk-plain-9' })
    const calls: string[] = []
    const service = new Claude360TokenService({
      apiClient: fakeApi({ '/api/cli/tokens/9': () => ({ id: 9 }) }, calls),
      secretStore: secret,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    await service.deleteToken(9)
    expect(calls).toContain('/api/cli/tokens/9')
    expect(await secret.loadSecret('claude360:api-key:9')).toBeNull()
  })

  it('self-heals a dangling ref when reveal fails (token was deleted), recreating the group key', async () => {
    // 预置指向已删 token(99) 的 ref：secret 缺失 + reveal 抛错，应丢弃悬空 ref 走重建。
    const port = settingsPort({
      tokenRefs: { 'text:auto': { tokenId: 99, name: 'Claude360 Copilot / text', group: 'auto' } }
    })
    const secret = fakeSecretStore(CLI)
    const service = new Claude360TokenService({
      apiClient: fakeApi({
        '/api/cli/tokens/99/reveal': () => {
          throw new Error('token not found')
        },
        // GET 列表(无 body)返回空 → 无现存匹配；POST 创建(有 body)返回新 token。
        '/api/cli/tokens': (body) =>
          body
            ? { id: 100, name: 'Claude360 Copilot / text', key: 'sk-new-100', group: 'auto' }
            : { items: [] }
      }),
      secretStore: secret,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.ensureGroupToken('auto', 'text')
    expect(ref.tokenId).toBe(100)
    expect(await secret.loadSecret('claude360:api-key:100')).toBe('sk-new-100')
    // scopedKey 被新 ref 覆盖，不再指向已删的 99。
    expect(port.current().tokenRefs['text:auto'].tokenId).toBe(100)
  })

  it('creates a token, stores the plaintext key in the secret store, not settings', async () => {
    const port = settingsPort()
    const secretStore = fakeSecretStore(CLI)
    const service = new Claude360TokenService({
      apiClient: fakeApi({
        '/api/cli/tokens': () => ({ id: 9, name: 'Claude360 Copilot / text', key: 'sk-plaintext-xyz', group: 'auto' })
      }),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.createToken('auto', 'Claude360 Copilot / text')
    expect(ref).toEqual({ tokenId: 9, name: 'Claude360 Copilot / text', group: 'auto' })
    expect(await secretStore.loadSecret('claude360:api-key:9')).toBe('sk-plaintext-xyz')
    expect(JSON.stringify(port.current())).not.toContain('sk-plaintext-xyz')
  })

  it('ensureGroupToken reuses an existing ref when its secret is present', async () => {
    const calls: string[] = []
    const port = settingsPort({ tokenRefs: { text: { tokenId: 5, name: 'Claude360 Copilot / text', group: 'auto' } } })
    const service = new Claude360TokenService({
      apiClient: fakeApi({}, calls),
      secretStore: fakeSecretStore({ ...CLI, 'claude360:api-key:5': 'sk-existing' }),
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.ensureGroupToken('auto', 'text')
    expect(ref.tokenId).toBe(5)
    expect(calls).toHaveLength(0) // 无需任何 API 调用
  })

  it('ensureGroupToken reveals when the local secret is missing', async () => {
    const calls: string[] = []
    const port = settingsPort({ tokenRefs: { text: { tokenId: 5, name: 'Claude360 Copilot / text', group: 'auto' } } })
    const secretStore = fakeSecretStore(CLI)
    const service = new Claude360TokenService({
      apiClient: fakeApi({ '/api/cli/tokens/5/reveal': () => ({ key: 'sk-revealed' }) }, calls),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.ensureGroupToken('auto', 'text')
    expect(ref.tokenId).toBe(5)
    expect(await secretStore.loadSecret('claude360:api-key:5')).toBe('sk-revealed')
    expect(calls).toContain('/api/cli/tokens/5/reveal')
  })

  it('ensureGroupToken creates a new token when none exists for the group', async () => {
    const port = settingsPort()
    const secretStore = fakeSecretStore(CLI)
    const service = new Claude360TokenService({
      apiClient: fakeApi({
        '/api/cli/tokens': (body) =>
          body
            ? { id: 12, name: 'Claude360 Copilot / image', key: 'sk-new', group: 'image' }
            : { items: [] }
      }),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.ensureGroupToken('image', 'image')
    expect(ref).toMatchObject({ tokenId: 12, group: 'image' })
    expect(port.current().tokenRefs['image:image']?.tokenId).toBe(12)
    expect(await secretStore.loadSecret('claude360:api-key:12')).toBe('sk-new')
  })

  it('does not reuse a ref across different groups sharing the same purpose', async () => {
    // 场景：已存在 auto/text 的 legacy ref；请求 vip/text 时不得复用 tokenId 1，
    // 必须为 vip 分组单独查列表/建 token，避免 vip provider 指向 auto 的 Key。
    const calls: string[] = []
    const port = settingsPort({
      tokenRefs: { text: { tokenId: 1, name: 'Claude360 Copilot / text', group: 'auto' } }
    })
    const secretStore = fakeSecretStore({ ...CLI, 'claude360:api-key:1': 'sk-auto' })
    const service = new Claude360TokenService({
      apiClient: fakeApi(
        {
          '/api/cli/tokens': (body) =>
            body
              ? { id: 2, name: 'Claude360 Copilot / text', key: 'sk-vip', group: 'vip' }
              : { items: [] }
        },
        calls
      ),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.ensureGroupToken('vip', 'text')
    expect(ref.tokenId).toBe(2)
    expect(ref.group).toBe('vip')
    expect(port.current().tokenRefs['text:vip']?.tokenId).toBe(2)
    // legacy auto ref 保持不变，未被 vip 覆盖。
    expect(port.current().tokenRefs.text?.tokenId).toBe(1)
  })

  it('reuses a legacy purpose ref only when its group matches, migrating to a scoped key', async () => {
    const calls: string[] = []
    const port = settingsPort({
      tokenRefs: { text: { tokenId: 5, name: 'Claude360 Copilot / text', group: 'auto' } }
    })
    const service = new Claude360TokenService({
      apiClient: fakeApi({}, calls),
      secretStore: fakeSecretStore({ ...CLI, 'claude360:api-key:5': 'sk-existing' }),
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const ref = await service.ensureGroupToken('auto', 'text')
    expect(ref.tokenId).toBe(5)
    expect(calls).toHaveLength(0) // secret 命中，无需任何 API 调用
    // 复用后固化到 group-scoped key。
    expect(port.current().tokenRefs['text:auto']?.tokenId).toBe(5)
  })

  it('ensureGroupToken de-dupes concurrent calls: creates the token only once', async () => {
    const port = settingsPort()
    const secretStore = fakeSecretStore(CLI)
    let listCount = 0
    let createCount = 0
    const service = new Claude360TokenService({
      apiClient: fakeApi({
        '/api/cli/tokens': (body) => {
          if (body) {
            createCount += 1
            return { id: 30, name: 'Claude360 Copilot / music', key: 'sk-once', group: 'music' }
          }
          listCount += 1
          return { items: [] }
        }
      }),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    // 同一 group|purpose 并发触发：应共用同一 in-flight Promise，只建一次 token。
    const [a, b, c] = await Promise.all([
      service.ensureGroupToken('music', 'music'),
      service.ensureGroupToken('music', 'music'),
      service.ensureGroupToken('music', 'music')
    ])
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(createCount).toBe(1)
    expect(listCount).toBe(1)
    expect(port.current().tokenRefs['music:music']?.tokenId).toBe(30)
    // in-flight 结束后可再次调用（此时命中已存 ref，不再建 token）。
    const again = await service.ensureGroupToken('music', 'music')
    expect(again.tokenId).toBe(30)
    expect(createCount).toBe(1)
  })

  it('throws when not logged in (no cli token)', async () => {
    const port = settingsPort()
    const service = new Claude360TokenService({
      apiClient: fakeApi({}),
      secretStore: fakeSecretStore(),
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    await expect(service.listTokens()).rejects.toThrow(/未登录/)
  })
})
