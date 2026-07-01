import { describe, expect, it } from 'vitest'
import {
  Claude360AuthService,
  type Claude360ApiClientPort
} from './claude360-auth-service'
import { type Claude360SecretStore } from './claude360-secret-store'
import {
  defaultClaude360Settings,
  mergeClaude360Settings,
  type Claude360SettingsV1
} from '../../shared/app-settings-claude360'

function fakeSecretStore(): Claude360SecretStore {
  const map = new Map<string, string>()
  return {
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

function fakeApi(routes: Record<string, (body?: unknown) => unknown>): Claude360ApiClientPort {
  const call = (path: string, body?: unknown): unknown => {
    const handler = routes[path]
    if (!handler) throw new Error(`no route ${path}`)
    return handler(body)
  }
  return {
    post: async <T>(path: string, body?: unknown) => call(path, body) as T,
    get: async <T>(path: string) => call(path) as T
  }
}

function settingsPort() {
  let settings: Claude360SettingsV1 = defaultClaude360Settings()
  return {
    readClaude360: () => settings,
    writeClaude360: (patch: Parameters<typeof mergeClaude360Settings>[1]) => {
      settings = mergeClaude360Settings(settings, patch)
    },
    current: () => settings
  }
}

describe('Claude360AuthService', () => {
  it('password login without 2FA saves the token and updates session (no token in result)', async () => {
    const secretStore = fakeSecretStore()
    const port = settingsPort()
    const service = new Claude360AuthService({
      apiClient: fakeApi({
        '/api/cli/auth/password': () => ({
          require_2fa: false,
          cli_token: 'cli-token-secret-value',
          user: { id: 1, username: 'demo', display_name: 'Demo', group: 'default' }
        })
      }),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360,
      now: () => '2026-07-01T00:00:00.000Z'
    })

    const result = await service.passwordLogin({ username: 'demo', password: 'pw' })
    expect(result).toMatchObject({ ok: true, require2fa: false })
    expect(JSON.stringify(result)).not.toContain('cli-token-secret-value')
    expect(port.current().loggedIn).toBe(true)
    expect(port.current().username).toBe('demo')
    expect(port.current().displayName).toBe('Demo')
    expect(await secretStore.loadSecret('claude360:cli-token')).toBe('cli-token-secret-value')
  })

  it('two-step login defers session until 2FA completes', async () => {
    const secretStore = fakeSecretStore()
    const port = settingsPort()
    const service = new Claude360AuthService({
      apiClient: fakeApi({
        '/api/cli/auth/password': () => ({ require_2fa: true, challenge_id: 'chl-1', expires_in: 300 }),
        '/api/cli/auth/password/2fa': () => ({
          require_2fa: false,
          cli_token: 'tok-2fa',
          user: { id: 1, username: 'demo', display_name: 'Demo', group: 'default' }
        })
      }),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })

    const first = await service.passwordLogin({ username: 'demo', password: 'pw' })
    expect(first).toMatchObject({ ok: true, require2fa: true, challengeId: 'chl-1', expiresIn: 300 })
    expect(port.current().loggedIn).toBe(false)
    expect(await secretStore.loadSecret('claude360:cli-token')).toBeNull()

    const second = await service.passwordLogin2FA({ challengeId: 'chl-1', code: '123456' })
    expect(second).toMatchObject({ ok: true, require2fa: false })
    expect(port.current().loggedIn).toBe(true)
    expect(await secretStore.loadSecret('claude360:cli-token')).toBe('tok-2fa')
  })

  it('device auth poll saves token on approval and reports pending otherwise', async () => {
    const secretStore = fakeSecretStore()
    const port = settingsPort()
    let pollCount = 0
    const service = new Claude360AuthService({
      apiClient: fakeApi({
        '/api/cli/auth/start': () => ({
          device_code: 'dev-1',
          user_code: 'ABCD-EFGH',
          verification_url: 'https://claude360.xyz/activate',
          expires_in: 600,
          interval: 3
        }),
        '/api/cli/auth/poll': () => {
          pollCount += 1
          return pollCount === 1 ? { status: 'pending' } : { status: 'approved', cli_token: 'dev-token' }
        },
        '/api/cli/me': () => ({ id: 1, username: 'demo', display_name: 'Demo', group: 'default' })
      }),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })

    const start = await service.startDeviceAuth()
    expect(start).toMatchObject({ ok: true, deviceCode: 'dev-1', userCode: 'ABCD-EFGH' })

    const pending = await service.pollDeviceAuth('dev-1')
    expect(pending).toMatchObject({ ok: true, status: 'pending' })
    expect(port.current().loggedIn).toBe(false)

    const approved = await service.pollDeviceAuth('dev-1')
    expect(approved).toMatchObject({ ok: true, status: 'approved' })
    expect(port.current().loggedIn).toBe(true)
    expect(port.current().username).toBe('demo')
    expect(await secretStore.loadSecret('claude360:cli-token')).toBe('dev-token')
  })

  it('logout clears secrets and resets the session', async () => {
    const secretStore = fakeSecretStore()
    const port = settingsPort()
    await secretStore.saveSecret('claude360:cli-token', 'x')
    port.writeClaude360({ loggedIn: true, username: 'demo', displayName: 'Demo', cliTokenRef: 'claude360:cli-token' })
    const service = new Claude360AuthService({
      apiClient: fakeApi({}),
      secretStore,
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })

    const result = await service.logout()
    expect(result).toEqual({ ok: true })
    expect(port.current().loggedIn).toBe(false)
    expect(port.current().username).toBe('')
    expect(port.current().cliTokenRef).toBe('')
    expect(await secretStore.loadSecret('claude360:cli-token')).toBeNull()
  })

  it('returns a typed failure when the API rejects login', async () => {
    const port = settingsPort()
    const service = new Claude360AuthService({
      apiClient: {
        post: async () => {
          throw new (await import('./claude360-api-client')).Claude360ApiError('用户名或密码错误', 200)
        },
        get: async <T>() => ({}) as T
      },
      secretStore: fakeSecretStore(),
      readClaude360: port.readClaude360,
      writeClaude360: port.writeClaude360
    })
    const result = await service.passwordLogin({ username: 'demo', password: 'bad' })
    expect(result).toEqual({ ok: false, message: '用户名或密码错误' })
    expect(port.current().loggedIn).toBe(false)
  })
})
