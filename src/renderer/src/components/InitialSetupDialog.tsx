import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RuntimeConnectionStatus } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import type { InitialSetupMode } from '../store/chat-store-types'
import { ExternalLink, Loader2, LogIn, QrCode, X } from 'lucide-react'

type InitialSetupCompletionState = {
  runtimeConnection: RuntimeConnectionStatus
  error: string | null
}

export function canCloseInitialSetup(mode: InitialSetupMode): boolean {
  return mode === 'preview'
}

/**
 * 兜底：确保打开的网页授权 URL 携带 user_code。
 * 正常情况下后端返回的 verification_url 已含 ?user_code=；但旧版后端可能只返回
 * 裸 /cli-auth，网页会提示「缺少授权码」。此处在缺失时补上，令客户端对后端
 * URL 形态更健壮（user_code 为 A-Z2-9 与连字符，URL 安全）。
 */
export function ensureCliAuthUrlUserCode(verificationUrl: string, userCode: string): string {
  const code = userCode.trim()
  if (!code) return verificationUrl
  try {
    const url = new URL(verificationUrl)
    if (!url.searchParams.get('user_code')) {
      url.searchParams.set('user_code', code)
    }
    return url.toString()
  } catch {
    // verificationUrl 非合法绝对 URL 时，退化为字符串判断后拼接。
    if (/[?&]user_code=/.test(verificationUrl)) return verificationUrl
    const sep = verificationUrl.includes('?') ? '&' : '?'
    return `${verificationUrl}${sep}user_code=${encodeURIComponent(code)}`
  }
}

// 保留：登录/设置完成后的运行时就绪收尾（与登录方式无关）。
// preview 模式后台探测即可关闭；required 模式需运行时就绪才进入 Code。
export async function completeInitialSetupAfterSave(input: {
  mode: InitialSetupMode
  reloadUiSettings: () => Promise<void>
  probeRuntime: (mode?: 'user' | 'background') => Promise<void>
  openCode: () => Promise<void>
  closeInitialSetup: () => void
  getState: () => InitialSetupCompletionState
  setDialogError: (message: string) => void
  fallbackRuntimeError: string
}): Promise<boolean> {
  await input.reloadUiSettings()
  if (input.mode === 'preview') {
    void input.probeRuntime('background')
    input.closeInitialSetup()
    return true
  }

  await input.probeRuntime('user')
  const state = input.getState()
  if (state.runtimeConnection !== 'ready') {
    input.setDialogError(state.error?.trim() || input.fallbackRuntimeError)
    return false
  }
  await input.openCode()
  input.closeInitialSetup()
  return true
}

type LoginTab = 'password' | 'device'
type DeviceStatus = 'idle' | 'pending' | 'expired' | 'denied'

export function InitialSetupDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const initialSetupMode = useChatStore((s) => s.initialSetupMode)
  const closeInitialSetup = useChatStore((s) => s.closeInitialSetup)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)

  const [tab, setTab] = useState<LoginTab>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [needs2fa, setNeeds2fa] = useState(false)
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<{ userCode: string; verificationUrl: string; deviceCode: string } | null>(null)
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('idle')
  const pollTimer = useRef<number | null>(null)

  const closeAllowed = canCloseInitialSetup(initialSetupMode)

  const stopPolling = useCallback((): void => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  // 登录成功收尾：同步账号 → 刷新 UI → 关闭弹窗 → 后台探测运行时。
  const finishLogin = useCallback(async (): Promise<void> => {
    stopPolling()
    try {
      await window.kunGui.claude360SyncAccount()
    } catch {
      // 同步失败不阻断登录关闭；展示态稍后可在「我的」页刷新。
    }
    await reloadUiSettings()
    closeInitialSetup()
    void probeRuntime('background')
  }, [stopPolling, reloadUiSettings, closeInitialSetup, probeRuntime])

  const handlePasswordLogin = async (): Promise<void> => {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const result = needs2fa
        ? await window.kunGui.claude360PasswordLogin2FA({ challengeId, code: code.trim() })
        : await window.kunGui.claude360PasswordLogin({ username: username.trim(), password })
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.require2fa) {
        setNeeds2fa(true)
        setChallengeId(result.challengeId)
        return
      }
      await finishLogin()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pollOnce = useCallback(
    async (deviceCode: string, intervalMs: number): Promise<void> => {
      try {
        const r = await window.kunGui.claude360PollDeviceAuth(deviceCode)
        if (!r.ok) {
          setError(r.message)
          setDeviceStatus('idle')
          return
        }
        if (r.status === 'approved') {
          await finishLogin()
          return
        }
        if (r.status === 'pending') {
          setDeviceStatus('pending')
          pollTimer.current = window.setTimeout(() => void pollOnce(deviceCode, intervalMs), intervalMs)
          return
        }
        setDeviceStatus(r.status === 'denied' ? 'denied' : 'expired')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setDeviceStatus('idle')
      }
    },
    [finishLogin]
  )

  const startDeviceAuth = async (): Promise<void> => {
    if (busy) return
    setError(null)
    setBusy(true)
    stopPolling()
    try {
      const r = await window.kunGui.claude360StartDeviceAuth()
      if (!r.ok) {
        setError(r.message)
        return
      }
      setDevice({ userCode: r.userCode, verificationUrl: r.verificationUrl, deviceCode: r.deviceCode })
      setDeviceStatus('pending')
      if (typeof window.kunGui?.openExternal === 'function') {
        void window.kunGui
          .openExternal(ensureCliAuthUrlUserCode(r.verificationUrl, r.userCode))
          .catch(() => undefined)
      }
      const intervalMs = Math.max(2, r.interval || 3) * 1000
      pollTimer.current = window.setTimeout(() => void pollOnce(r.deviceCode, intervalMs), intervalMs)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleClose = (): void => {
    if (!closeAllowed) return
    stopPolling()
    setError(null)
    closeInitialSetup()
  }

  const inputClass =
    'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-sm text-ds-strong outline-none focus:border-sky-400'
  const tabClass = (active: boolean): string =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
      active ? 'bg-sky-500/15 text-sky-700 dark:text-sky-200' : 'text-ds-muted hover:bg-ds-hover'
    }`

  return (
    <div className="ds-no-drag fixed inset-0 z-50 overflow-y-auto bg-[#eef2fb]/45 p-3 backdrop-blur-[18px] dark:bg-black/62 dark:backdrop-blur-[22px] sm:p-6">
      <div className="grid min-h-full place-items-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('claude360LoginTitle')}
          className="flex w-full max-w-[460px] flex-col gap-4 rounded-2xl border border-white/75 bg-[rgba(255,255,255,0.96)] p-6 text-slate-900 shadow-[0_28px_86px_rgba(88,105,136,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(18,21,28,0.97)] dark:text-white"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t('claude360LoginTitle')}</h2>
              <p className="mt-1 text-sm text-ds-muted">{t('claude360LoginSubtitle')}</p>
            </div>
            {closeAllowed ? (
              <button
                type="button"
                aria-label={t('close')}
                onClick={handleClose}
                className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-muted"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="flex gap-1 rounded-xl bg-ds-hover/40 p-1">
            <button type="button" className={tabClass(tab === 'password')} onClick={() => setTab('password')}>
              {t('claude360LoginTabPassword')}
            </button>
            <button type="button" className={tabClass(tab === 'device')} onClick={() => setTab('device')}>
              {t('claude360LoginTabDevice')}
            </button>
          </div>

          {tab === 'password' ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void handlePasswordLogin()
              }}
            >
              {!needs2fa ? (
                <>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-ds-muted">{t('claude360LoginUsername')}</span>
                    <input
                      className={inputClass}
                      value={username}
                      autoFocus
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-ds-muted">{t('claude360LoginPassword')}</span>
                    <input
                      className={inputClass}
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                </>
              ) : (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ds-muted">{t('claude360Login2faCode')}</span>
                  <input
                    className={inputClass}
                    value={code}
                    autoFocus
                    inputMode="numeric"
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              )}
              <button
                type="submit"
                disabled={busy}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {needs2fa ? t('claude360Login2faSubmit') : t('claude360LoginSubmit')}
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              {device ? (
                <div className="rounded-xl border border-ds-border bg-ds-card p-4 text-center">
                  <p className="text-sm text-ds-muted">{t('claude360LoginUserCodeLabel')}</p>
                  <p className="mt-1 select-all font-mono text-2xl font-bold tracking-widest">{device.userCode}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window.kunGui?.openExternal === 'function') {
                        void window.kunGui
                          .openExternal(ensureCliAuthUrlUserCode(device.verificationUrl, device.userCode))
                          .catch(() => undefined)
                      }
                    }}
                    className="mt-3 inline-flex items-center justify-center gap-1.5 text-sm text-sky-600 hover:underline dark:text-sky-300"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('claude360LoginOpenBrowser')}
                  </button>
                  <p className="mt-3 text-xs text-ds-faint">
                    {deviceStatus === 'pending'
                      ? t('claude360LoginDevicePending')
                      : deviceStatus === 'expired'
                        ? t('claude360LoginDeviceExpired')
                        : deviceStatus === 'denied'
                          ? t('claude360LoginDeviceDenied')
                          : t('claude360LoginDeviceHint')}
                  </p>
                  {deviceStatus === 'expired' || deviceStatus === 'denied' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startDeviceAuth()}
                      className="mt-2 text-sm text-sky-600 hover:underline disabled:opacity-60 dark:text-sky-300"
                    >
                      {t('claude360LoginDeviceRetry')}
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startDeviceAuth()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  {t('claude360LoginDeviceStart')}
                </button>
              )}
              <p className="text-xs text-ds-faint">{t('claude360LoginDeviceHint')}</p>
            </div>
          )}

          {error ? (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
