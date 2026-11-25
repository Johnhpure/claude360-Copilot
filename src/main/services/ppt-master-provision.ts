/**
 * Background provisioning for the PPT Master assistant.
 *
 * The assistant is only usable once its skill package and Python environment
 * exist, and both take minutes to set up. Doing that lazily — on summon or on
 * the first message — puts the wait in front of a user who is already asking
 * for something, so the app provisions it quietly after startup instead.
 *
 * Discipline: run at most once per session, never block startup, stay silent
 * on failure (the assistant's own panel surfaces the state and offers a retry),
 * and only restart the runtime once no turn is in flight.
 */
import type { AppSettingsV1 } from '../../shared/app-settings'
import type { PptMasterState } from '../../shared/ppt-master'
import { logInfo, logWarn } from '../logger'
import { waitForRuntimeTurnsIdle } from '../runtime/managed-runtime-idle'
import { installPptMaster, pptMasterState } from './ppt-master-service'

/** Set to `0` / `false` to opt out of the automatic background install. */
export const PPT_MASTER_AUTO_INSTALL_ENV = 'PPT_MASTER_AUTO_INSTALL'

/**
 * Far enough after launch that the window has painted and the Kun child has
 * spawned; the install itself is long-running, so a few extra seconds cost
 * nothing but keep it clear of the startup window.
 */
const DEFAULT_DELAY_MS = 20_000
/** Give an in-flight turn a generous window to finish before restarting. */
const IDLE_WAIT_MS = 10 * 60_000

export function pptMasterAutoInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[PPT_MASTER_AUTO_INSTALL_ENV]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return true
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no'
}

export type PptMasterProvisionOptions = {
  userDataDir: string
  proxyUrl?: string
  /** Latest settings, used to poll the runtime for in-flight turns. */
  settings: AppSettingsV1
  restartRuntime: () => Promise<void>
  onState?: (state: PptMasterState) => void
  env?: NodeJS.ProcessEnv
  /** Injected in tests. */
  waitForIdle?: typeof waitForRuntimeTurnsIdle
}

/**
 * Provision the assistant if it is not ready yet. Resolves to what happened so
 * callers (and tests) can assert without reading logs.
 */
export async function provisionPptMasterInBackground(
  options: PptMasterProvisionOptions
): Promise<'disabled' | 'already-ready' | 'installed' | 'failed'> {
  if (!pptMasterAutoInstallEnabled(options.env ?? process.env)) return 'disabled'

  const current = await pptMasterState(options.userDataDir).catch(() => null)
  if (current === null) return 'failed'
  if (current.skill.status === 'ready' && current.python.status === 'ready') {
    return 'already-ready'
  }

  logInfo('ppt-master', 'starting background provisioning')
  const result = await installPptMaster({
    userDataDir: options.userDataDir,
    ...(options.proxyUrl ? { proxyUrl: options.proxyUrl } : {}),
    ...(options.onState ? { onState: options.onState } : {})
  })
  if (!result.ok) {
    // Expected on a machine with no Python or no network. The assistant panel
    // shows the same message and offers a retry, so this stays a log line.
    logWarn('ppt-master', 'background provisioning did not complete', result.message)
    return 'failed'
  }

  // Skill roots and the venv PATH are read when the runtime spawns, so the
  // install only takes effect after a restart — but not mid-turn.
  const waitForIdle = options.waitForIdle ?? waitForRuntimeTurnsIdle
  const idle = await waitForIdle({ settings: options.settings, timeoutMs: IDLE_WAIT_MS })
    .catch(() => 'unavailable' as const)
  if (idle === 'timeout') {
    // Someone has been working for ten minutes straight; the next launch picks
    // the skill up anyway, so leave their session alone.
    logInfo('ppt-master', 'provisioned; deferring runtime restart until next launch')
    return 'installed'
  }
  await options.restartRuntime().catch((error) => {
    logWarn('ppt-master', 'runtime restart after provisioning failed', errorMessage(error))
  })
  logInfo('ppt-master', 'background provisioning complete')
  return 'installed'
}

/**
 * Schedule the background provisioning run. Returns a cancel function; the
 * timer is unref'd so it never keeps the process alive.
 */
export function schedulePptMasterProvisioning(
  options: PptMasterProvisionOptions & { delayMs?: number }
): () => void {
  const timer = setTimeout(() => {
    void provisionPptMasterInBackground(options).catch((error) => {
      logWarn('ppt-master', 'background provisioning threw', errorMessage(error))
    })
  }, options.delayMs ?? DEFAULT_DELAY_MS)
  timer.unref()
  return () => clearTimeout(timer)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
