import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings'
import type { PptMasterState } from '../../shared/ppt-master'

const pptMasterState = vi.fn<() => Promise<PptMasterState>>()
const installPptMaster = vi.fn()

vi.mock('./ppt-master-service', () => ({
  pptMasterState: (...args: unknown[]) => pptMasterState(...(args as [])),
  installPptMaster: (...args: unknown[]) => installPptMaster(...(args as []))
}))

vi.mock('../logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn()
}))

const {
  pptMasterAutoInstallEnabled,
  provisionPptMasterInBackground,
  PPT_MASTER_AUTO_INSTALL_ENV
} = await import('./ppt-master-provision')

const READY: PptMasterState = {
  skill: { status: 'ready', root: '/root', skillDir: '/root/ppt-master' },
  python: { status: 'ready', interpreter: '/venv/bin/python3' }
}
const MISSING: PptMasterState = {
  skill: { status: 'missing' },
  python: { status: 'missing' }
}

const settings = {} as AppSettingsV1

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    userDataDir: '/tmp/user-data',
    settings,
    restartRuntime: vi.fn(async () => undefined),
    waitForIdle: vi.fn(async () => 'idle' as const),
    env: {},
    ...overrides
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('pptMasterAutoInstallEnabled', () => {
  it('defaults to on and honours the opt-out values', () => {
    expect(pptMasterAutoInstallEnabled({})).toBe(true)
    expect(pptMasterAutoInstallEnabled({ [PPT_MASTER_AUTO_INSTALL_ENV]: '' })).toBe(true)
    expect(pptMasterAutoInstallEnabled({ [PPT_MASTER_AUTO_INSTALL_ENV]: '1' })).toBe(true)
    for (const value of ['0', 'false', 'off', 'no', 'FALSE']) {
      expect(pptMasterAutoInstallEnabled({ [PPT_MASTER_AUTO_INSTALL_ENV]: value })).toBe(false)
    }
  })
})

describe('provisionPptMasterInBackground', () => {
  it('does nothing when the user opted out', async () => {
    const options = baseOptions({ env: { [PPT_MASTER_AUTO_INSTALL_ENV]: '0' } })

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('disabled')
    expect(pptMasterState).not.toHaveBeenCalled()
    expect(installPptMaster).not.toHaveBeenCalled()
  })

  it('skips the install and the restart when everything is already ready', async () => {
    pptMasterState.mockResolvedValue(READY)
    const options = baseOptions()

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('already-ready')
    expect(installPptMaster).not.toHaveBeenCalled()
    expect(options.restartRuntime).not.toHaveBeenCalled()
  })

  it('installs, waits for an idle runtime, then restarts it', async () => {
    pptMasterState.mockResolvedValue(MISSING)
    installPptMaster.mockResolvedValue({ ok: true, state: READY })
    const options = baseOptions()

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('installed')
    expect(installPptMaster).toHaveBeenCalledOnce()
    expect(options.waitForIdle).toHaveBeenCalledOnce()
    expect(options.restartRuntime).toHaveBeenCalledOnce()
  })

  it('leaves a long-running session alone instead of restarting mid-turn', async () => {
    pptMasterState.mockResolvedValue(MISSING)
    installPptMaster.mockResolvedValue({ ok: true, state: READY })
    const options = baseOptions({ waitForIdle: vi.fn(async () => 'timeout' as const) })

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('installed')
    expect(options.restartRuntime).not.toHaveBeenCalled()
  })

  it('still restarts when the runtime is unreachable', async () => {
    pptMasterState.mockResolvedValue(MISSING)
    installPptMaster.mockResolvedValue({ ok: true, state: READY })
    const options = baseOptions({ waitForIdle: vi.fn(async () => 'unavailable' as const) })

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('installed')
    expect(options.restartRuntime).toHaveBeenCalledOnce()
  })

  it('reports a failed install without restarting the runtime', async () => {
    pptMasterState.mockResolvedValue(MISSING)
    installPptMaster.mockResolvedValue({ ok: false, message: 'no python', state: MISSING })
    const options = baseOptions()

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('failed')
    expect(options.restartRuntime).not.toHaveBeenCalled()
  })

  it('does not throw when the status probe itself fails', async () => {
    pptMasterState.mockRejectedValue(new Error('disk gone'))
    const options = baseOptions()

    await expect(provisionPptMasterInBackground(options)).resolves.toBe('failed')
    expect(installPptMaster).not.toHaveBeenCalled()
  })
})
