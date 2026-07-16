import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('main crash recovery startup wiring', () => {
  it('initializes local crash handling before app ready', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const reporter = source.indexOf('initializeLocalCrashReporter({')
    const guard = source.indexOf('installMainCrashGuard({')
    const ready = source.indexOf('app.whenReady().then')

    expect(reporter).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(reporter)
    expect(ready).toBeGreaterThan(guard)
  })

  it('reconciles fatal records only after same-tick IPC registration completes', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const ipcRegistered = source.indexOf("startupMetrics.mark('main:ipc-registered')")
    const reconcile = source.indexOf('crashStore.reconcile()')

    expect(ipcRegistered).toBeGreaterThan(-1)
    expect(reconcile).toBeGreaterThan(ipcRegistered)
  })

  it('keeps runtime crash context free of message and stderr content', () => {
    const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
    const providerStart = source.indexOf("crashContextRegistry.registerProvider('runtime'")
    const providerEnd = source.indexOf('let supervisedRestartInFlight', providerStart)
    const provider = source.slice(providerStart, providerEnd)

    expect(providerStart).toBeGreaterThan(-1)
    expect(provider).toContain('lastRuntimeStatus.state')
    expect(provider).toContain('lastRuntimeStatus.source')
    expect(provider).not.toContain('lastRuntimeStatus.message')
    expect(provider).not.toContain('stderrTail')
  })
})
