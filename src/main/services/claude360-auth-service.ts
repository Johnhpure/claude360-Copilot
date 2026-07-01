import type {
  Claude360DeviceAuthPollResult,
  Claude360DeviceAuthPollResponse,
  Claude360DeviceAuthStartResult,
  Claude360DeviceAuthStartResponse,
  Claude360LoginResult,
  Claude360LogoutResult,
  Claude360MeResponse,
  Claude360PasswordLogin2FAPayload,
  Claude360PasswordLoginPayload,
  Claude360PasswordLoginResponse,
  Claude360SessionResult,
  Claude360SyncResult
} from '../../shared/claude360'
import type { Claude360SettingsPatchV1, Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import { Claude360ApiError } from './claude360-api-client'
import { CLAUDE360_CLI_TOKEN_REF, type Claude360SecretStore } from './claude360-secret-store'

/**
 * Claude360 登录/会话/同步/登出服务（plan-02 Task 4 / Task 7）。
 *
 * - cli_token 明文只经 secretStore 落盘加密，settings 只存展示态 + ref。
 * - 2FA 第一步不写登录态；第二步成功才保存 session。
 * - 设备码授权 approved 后保存 token 并拉取 /api/cli/me 补全用户信息。
 * - 返回 renderer 的 result 不含任何明文凭据。
 */

export type Claude360ApiClientPort = {
  get<T>(path: string, token?: string): Promise<T>
  post<T>(path: string, body?: unknown, token?: string): Promise<T>
}

export type Claude360AuthServiceDeps = {
  apiClient: Claude360ApiClientPort
  secretStore: Claude360SecretStore
  readClaude360(): Claude360SettingsV1 | Promise<Claude360SettingsV1>
  writeClaude360(patch: Claude360SettingsPatchV1): void | Promise<void>
  /** 注入时钟，便于测试确定性。默认 ISO 当前时间。 */
  now?: () => string
}

function toMessage(error: unknown): string {
  if (error instanceof Claude360ApiError) return error.message
  return '请求失败，请稍后重试'
}

export class Claude360AuthService {
  private readonly deps: Claude360AuthServiceDeps
  private readonly now: () => string

  constructor(deps: Claude360AuthServiceDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  private async sessionFromSettings(loggedInOverride?: boolean): Promise<Claude360SessionResult> {
    const s = await this.deps.readClaude360()
    return {
      loggedIn: loggedInOverride ?? s.loggedIn,
      username: s.username,
      displayName: s.displayName,
      baseUrl: s.baseUrl
    }
  }

  private async persistLogin(
    cliToken: string,
    user: { username?: string; display_name?: string }
  ): Promise<void> {
    await this.deps.secretStore.saveSecret(CLAUDE360_CLI_TOKEN_REF, cliToken)
    await this.deps.writeClaude360({
      loggedIn: true,
      username: user.username ?? '',
      displayName: user.display_name ?? '',
      cliTokenRef: CLAUDE360_CLI_TOKEN_REF,
      lastSyncAt: this.now()
    })
  }

  async getSession(): Promise<Claude360SessionResult> {
    const s = await this.deps.readClaude360()
    const token = await this.deps.secretStore.loadSecret(s.cliTokenRef || CLAUDE360_CLI_TOKEN_REF)
    // 凭据缺失视为未登录，避免展示态与密钥态不一致。
    return await this.sessionFromSettings(s.loggedIn && Boolean(token))
  }

  async passwordLogin(input: Claude360PasswordLoginPayload): Promise<Claude360LoginResult> {
    try {
      const resp = await this.deps.apiClient.post<Claude360PasswordLoginResponse>(
        '/api/cli/auth/password',
        { username: input.username, password: input.password }
      )
      if (resp.require_2fa) {
        return { ok: true, require2fa: true, challengeId: resp.challenge_id, expiresIn: resp.expires_in }
      }
      await this.persistLogin(resp.cli_token, resp.user)
      return { ok: true, require2fa: false, session: await this.sessionFromSettings(true) }
    } catch (error) {
      return { ok: false, message: toMessage(error) }
    }
  }

  async passwordLogin2FA(input: Claude360PasswordLogin2FAPayload): Promise<Claude360LoginResult> {
    try {
      const resp = await this.deps.apiClient.post<Claude360PasswordLoginResponse>(
        '/api/cli/auth/password/2fa',
        { challenge_id: input.challengeId, code: input.code }
      )
      if (resp.require_2fa) {
        // 第二步不应再返回 require_2fa；视为异常。
        return { ok: false, message: '两步验证失败，请重试' }
      }
      await this.persistLogin(resp.cli_token, resp.user)
      return { ok: true, require2fa: false, session: await this.sessionFromSettings(true) }
    } catch (error) {
      return { ok: false, message: toMessage(error) }
    }
  }

  async startDeviceAuth(): Promise<Claude360DeviceAuthStartResult> {
    try {
      const resp = await this.deps.apiClient.post<Claude360DeviceAuthStartResponse>('/api/cli/auth/start')
      return {
        ok: true,
        deviceCode: resp.device_code,
        userCode: resp.user_code,
        verificationUrl: resp.verification_url,
        expiresIn: resp.expires_in,
        interval: resp.interval
      }
    } catch (error) {
      return { ok: false, message: toMessage(error) }
    }
  }

  async pollDeviceAuth(deviceCode: string): Promise<Claude360DeviceAuthPollResult> {
    try {
      const resp = await this.deps.apiClient.post<Claude360DeviceAuthPollResponse>('/api/cli/auth/poll', {
        device_code: deviceCode
      })
      if (resp.status === 'approved' && resp.cli_token) {
        await this.deps.secretStore.saveSecret(CLAUDE360_CLI_TOKEN_REF, resp.cli_token)
        // 拉取用户信息补全展示态；失败不阻断登录。
        let me: Claude360MeResponse = {}
        try {
          me = await this.deps.apiClient.get<Claude360MeResponse>('/api/cli/me', resp.cli_token)
        } catch {
          me = {}
        }
        await this.deps.writeClaude360({
          loggedIn: true,
          username: me.username ?? '',
          displayName: me.display_name ?? '',
          cliTokenRef: CLAUDE360_CLI_TOKEN_REF,
          lastSyncAt: this.now()
        })
        return { ok: true, status: 'approved', session: await this.sessionFromSettings(true) }
      }
      if (resp.status === 'approved') {
        // approved 但无 token，视为异常状态。
        return { ok: false, message: '授权异常，请重新登录' }
      }
      return { ok: true, status: resp.status }
    } catch (error) {
      return { ok: false, message: toMessage(error) }
    }
  }

  async syncAccount(): Promise<Claude360SyncResult> {
    const s = await this.deps.readClaude360()
    const token = await this.deps.secretStore.loadSecret(s.cliTokenRef || CLAUDE360_CLI_TOKEN_REF)
    if (!token) return { ok: false, message: '未登录' }
    try {
      const me = await this.deps.apiClient.get<Claude360MeResponse>('/api/cli/me', token)
      await this.deps.writeClaude360({
        loggedIn: true,
        username: me.username ?? s.username,
        displayName: me.display_name ?? s.displayName,
        lastSyncAt: this.now()
      })
      return { ok: true, session: await this.sessionFromSettings(true) }
    } catch (error) {
      return { ok: false, message: toMessage(error) }
    }
  }

  async logout(): Promise<Claude360LogoutResult> {
    await this.deps.secretStore.clearClaude360Secrets()
    await this.deps.writeClaude360({
      loggedIn: false,
      username: '',
      displayName: '',
      cliTokenRef: '',
      tokenRefs: {}
    })
    return { ok: true }
  }
}
