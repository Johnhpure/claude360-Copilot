import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendKunCrashHistory,
  appendStartupHistory,
  createStartupMetrics,
  latestKunPhaseReached,
  readKunCrashHistory,
  readStartupHistory,
  type KunCrashRecord,
  type StartupMetricsDeps
} from './perf-baseline'
import {
  STARTUP_PHASE_NAMES,
  type RendererStartupMarks,
  type StartupBaselineRecord
} from '../shared/perf-baseline'

const T0 = 1_000_000

function makeDeps(overrides: Partial<StartupMetricsDeps> = {}): {
  deps: StartupMetricsDeps
  logs: string[]
  devLogs: string[]
  persisted: StartupBaselineRecord[]
} {
  const logs: string[] = []
  const devLogs: string[] = []
  const persisted: StartupBaselineRecord[] = []
  const deps: StartupMetricsDeps = {
    t0EpochMs: T0,
    processStartOffsetMs: 120,
    isDev: false,
    getEnvironment: () => ({
      appVersion: '0.1.0',
      updateChannel: 'stable',
      platform: 'linux',
      arch: 'x64',
      packaged: false
    }),
    now: () => T0 + 500,
    log: (message) => logs.push(message),
    devLog: (message) => devLogs.push(message),
    persist: async (record) => {
      persisted.push(record)
    },
    ...overrides
  }
  return { deps, logs, devLogs, persisted }
}

function rendererMarks(overrides: Partial<RendererStartupMarks> = {}): RendererStartupMarks {
  return {
    epochMarks: {
      'module-eval': T0 + 800,
      'first-frame': T0 + 900,
      interactive: T0 + 1_200
    },
    preload: { startedAtEpochMs: T0 + 600, readyAtEpochMs: T0 + 610 },
    ...overrides
  }
}

function parseSummaryRecord(logLine: string): StartupBaselineRecord {
  const jsonStart = logLine.indexOf('{')
  expect(jsonStart).toBeGreaterThan(0)
  return JSON.parse(logLine.slice(jsonStart)) as StartupBaselineRecord
}

describe('createStartupMetrics', () => {
  it('records phases as offsets from t0 and ignores duplicate marks (first wins)', () => {
    const { deps } = makeDeps()
    const metrics = createStartupMetrics(deps)

    metrics.mark('main:module-eval', T0)
    metrics.mark('main:app-ready', T0 + 250)
    metrics.mark('main:app-ready', T0 + 9_999)

    expect(metrics.snapshotPhases()).toEqual({
      'main:module-eval': 0,
      'main:app-ready': 250
    })
  })

  it('uses the injected clock when no explicit epoch is given and clamps pre-t0 stamps to 0', () => {
    const { deps } = makeDeps({ now: () => T0 + 42 })
    const metrics = createStartupMetrics(deps)

    metrics.mark('main:app-ready')
    metrics.mark('main:settings-loaded', T0 - 50)

    expect(metrics.snapshotPhases()).toEqual({
      'main:app-ready': 42,
      'main:settings-loaded': 0
    })
  })

  it('finalizes exactly once when renderer:interactive and kun:health-ok are both present', () => {
    const { deps, logs, persisted } = makeDeps()
    const metrics = createStartupMetrics(deps)

    metrics.mark('kun:health-ok', T0 + 300)
    expect(metrics.isFinalized()).toBe(false)
    expect(logs).toHaveLength(0)

    metrics.mark('renderer:interactive', T0 + 400)
    expect(metrics.isFinalized()).toBe(true)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('startup summary (complete)')

    // 幂等：后续 mark / maybeFinalize / finalizeNow 均不再产出第二条汇总。
    metrics.mark('main:window-created', T0 + 450)
    metrics.maybeFinalize()
    metrics.finalizeNow('quit')
    expect(logs).toHaveLength(1)
    expect(persisted).toHaveLength(1)

    const record = parseSummaryRecord(logs[0])
    expect(record.partial).toBe(false)
    expect(record.phases['kun:health-ok']).toBe(300)
    expect(record.phases['renderer:interactive']).toBe(400)
    expect(record.appVersion).toBe('0.1.0')
    expect(record.updateChannel).toBe('stable')
    expect(record.platform).toBe('linux')
    expect(record.arch).toBe('x64')
    expect(record.packaged).toBe(false)
    expect(record.processStartOffsetMs).toBe(120)
  })

  it('converts renderer epoch marks and preload timestamps onto the main timeline', () => {
    const { deps, logs } = makeDeps()
    const metrics = createStartupMetrics(deps)

    metrics.mark('kun:health-ok', T0 + 300)
    metrics.attachRendererMarks(
      rendererMarks({
        navTiming: { domContentLoadedMs: 111, loadEventEndMs: 222 },
        scriptResources: { count: 3, totalDurationMs: 90, maxDurationMs: 60, maxName: 'index.js' }
      })
    )

    expect(metrics.isFinalized()).toBe(true)
    const record = parseSummaryRecord(logs[0])
    expect(record.phases['renderer:module-eval']).toBe(800)
    expect(record.phases['renderer:first-frame']).toBe(900)
    expect(record.phases['renderer:interactive']).toBe(1_200)
    expect(record.preload).toEqual({ startOffsetMs: 600, readyOffsetMs: 610, durationMs: 10 })
    expect(record.navTiming).toEqual({ domContentLoadedMs: 111, loadEventEndMs: 222 })
    expect(record.scriptResources).toEqual({
      count: 3,
      totalDurationMs: 90,
      maxDurationMs: 60,
      maxName: 'index.js'
    })
  })

  it('ignores absent/invalid renderer epoch marks instead of recording bogus offsets', () => {
    const { deps } = makeDeps()
    const metrics = createStartupMetrics(deps)

    metrics.attachRendererMarks(
      rendererMarks({
        epochMarks: { 'module-eval': Number.NaN, 'first-frame': 0 },
        preload: { startedAtEpochMs: 0, readyAtEpochMs: 0 }
      })
    )

    expect(metrics.snapshotPhases()).toEqual({})
    expect(metrics.isFinalized()).toBe(false)
  })

  it('produces a partial record with a missing list on timeout finalize (kun never became healthy)', () => {
    const { deps, logs } = makeDeps()
    const metrics = createStartupMetrics(deps)

    metrics.mark('main:module-eval', T0)
    metrics.mark('main:app-ready', T0 + 100)
    metrics.mark('kun:spawn-start', T0 + 200)

    metrics.finalizeNow('timeout')

    expect(metrics.isFinalized()).toBe(true)
    const record = parseSummaryRecord(logs[0])
    expect(logs[0]).toContain('startup summary (timeout)')
    expect(record.partial).toBe(true)
    // spawn 已开始但 READY/health 未到达：missing 列表能精确显示卡住的阶段（R20/AC2）。
    expect(record.missing).toContain('kun:spawn-done')
    expect(record.missing).toContain('kun:ready')
    expect(record.missing).toContain('kun:health-ok')
    expect(record.missing).not.toContain('kun:spawn-start')
    expect(record.missing).toHaveLength(STARTUP_PHASE_NAMES.length - 3)
  })

  it('emits per-phase dev logs and a dev summary table only when isDev', () => {
    const { deps, devLogs } = makeDeps({ isDev: true })
    const metrics = createStartupMetrics(deps)

    metrics.mark('main:module-eval', T0)
    metrics.mark('kun:health-ok', T0 + 300)
    metrics.mark('renderer:interactive', T0 + 400)

    expect(devLogs.some((line) => line.includes('main:module-eval +0ms'))).toBe(true)
    expect(devLogs.some((line) => line.includes('startup summary (complete)'))).toBe(true)
    expect(devLogs.some((line) => line.includes('missing:'))).toBe(true)

    const { deps: prodDeps, devLogs: prodDevLogs } = makeDeps({ isDev: false })
    const prodMetrics = createStartupMetrics(prodDeps)
    prodMetrics.mark('main:module-eval', T0)
    prodMetrics.finalizeNow('quit')
    expect(prodDevLogs).toHaveLength(0)
  })

  it('does not throw when persist rejects or getEnvironment throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { deps, logs } = makeDeps({
        persist: async () => {
          throw new Error('disk full')
        },
        getEnvironment: () => {
          throw new Error('not ready')
        }
      })
      const metrics = createStartupMetrics(deps)

      expect(() => metrics.finalizeNow('quit')).not.toThrow()
      // 让 fire-and-forget 的 persist rejection 有机会被 catch。
      await new Promise((resolve) => setImmediate(resolve))

      const record = parseSummaryRecord(logs[0])
      expect(record.appVersion).toBe('')
      expect(record.partial).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('startup history persistence', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeTempHistoryPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'perf-baseline-test-'))
    tempDirs.push(dir)
    return join(dir, 'perf', 'startup-history.json')
  }

  function makeRecord(index: number): StartupBaselineRecord {
    return {
      at: new Date(T0 + index).toISOString(),
      appVersion: '0.1.0',
      updateChannel: 'stable',
      platform: 'linux',
      arch: 'x64',
      packaged: false,
      processStartOffsetMs: index,
      phases: { 'main:module-eval': 0 },
      partial: false,
      missing: []
    }
  }

  it('appends records, creating the directory on demand', async () => {
    const filePath = makeTempHistoryPath()

    await appendStartupHistory(filePath, makeRecord(1))
    await appendStartupHistory(filePath, makeRecord(2))

    const history = await readStartupHistory(filePath)
    expect(history).toHaveLength(2)
    expect(history[0]?.processStartOffsetMs).toBe(1)
    expect(history[1]?.processStartOffsetMs).toBe(2)
  })

  it('keeps only the newest maxRecords entries', async () => {
    const filePath = makeTempHistoryPath()

    for (let i = 0; i < 23; i += 1) {
      await appendStartupHistory(filePath, makeRecord(i))
    }

    const history = await readStartupHistory(filePath)
    expect(history).toHaveLength(20)
    expect(history[0]?.processStartOffsetMs).toBe(3)
    expect(history[19]?.processStartOffsetMs).toBe(22)
  })

  it('recovers from a corrupt history file by starting over', async () => {
    const filePath = makeTempHistoryPath()
    await appendStartupHistory(filePath, makeRecord(1))
    await writeFile(filePath, '{not json][', 'utf8')

    await expect(readStartupHistory(filePath)).resolves.toEqual([])
    await appendStartupHistory(filePath, makeRecord(7))

    const history = await readStartupHistory(filePath)
    expect(history).toHaveLength(1)
    expect(history[0]?.processStartOffsetMs).toBe(7)
  })

  it('returns [] for a missing file and for non-array JSON', async () => {
    const filePath = makeTempHistoryPath()
    await expect(readStartupHistory(filePath)).resolves.toEqual([])

    await appendStartupHistory(filePath, makeRecord(1))
    await writeFile(filePath, JSON.stringify({ nope: true }), 'utf8')
    await expect(readStartupHistory(filePath)).resolves.toEqual([])
  })

  it('replaces the file atomically without leaving the tmp file behind', async () => {
    const filePath = makeTempHistoryPath()
    await appendStartupHistory(filePath, makeRecord(1))

    const entries = await readdir(dirnameOf(filePath))
    expect(entries).toEqual(['startup-history.json'])
    const raw = await readFile(filePath, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
  })
})

describe('kun crash history persistence', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeTempCrashPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'perf-baseline-crash-test-'))
    tempDirs.push(dir)
    return join(dir, 'perf', 'kun-crash-history.json')
  }

  function makeCrashRecord(index: number): KunCrashRecord {
    return {
      at: new Date(T0 + index).toISOString(),
      code: 1,
      signal: null,
      uptimeMs: index,
      restartCount: 1,
      budgetExhausted: false,
      phaseReached: 'kun:health-ok'
    }
  }

  it('appends crash records, creating the directory on demand', async () => {
    const filePath = makeTempCrashPath()

    await appendKunCrashHistory(filePath, makeCrashRecord(1))
    await appendKunCrashHistory(filePath, {
      ...makeCrashRecord(2),
      signal: 'SIGKILL',
      code: null,
      budgetExhausted: true,
      phaseReached: null
    })

    const history = await readKunCrashHistory(filePath)
    expect(history).toHaveLength(2)
    expect(history[0]?.uptimeMs).toBe(1)
    expect(history[1]?.signal).toBe('SIGKILL')
    expect(history[1]?.budgetExhausted).toBe(true)
    expect(history[1]?.phaseReached).toBeNull()
  })

  it('keeps only the newest 50 records by default', async () => {
    const filePath = makeTempCrashPath()

    for (let i = 0; i < 53; i += 1) {
      await appendKunCrashHistory(filePath, makeCrashRecord(i))
    }

    const history = await readKunCrashHistory(filePath)
    expect(history).toHaveLength(50)
    expect(history[0]?.uptimeMs).toBe(3)
    expect(history[49]?.uptimeMs).toBe(52)
  })

  it('recovers from a corrupt crash file by starting over', async () => {
    const filePath = makeTempCrashPath()
    await appendKunCrashHistory(filePath, makeCrashRecord(1))
    await writeFile(filePath, 'not-json{{{', 'utf8')

    await expect(readKunCrashHistory(filePath)).resolves.toEqual([])
    await appendKunCrashHistory(filePath, makeCrashRecord(9))

    const history = await readKunCrashHistory(filePath)
    expect(history).toHaveLength(1)
    expect(history[0]?.uptimeMs).toBe(9)
  })
})

describe('latestKunPhaseReached', () => {
  it('returns null when no kun phase was marked', () => {
    expect(latestKunPhaseReached({})).toBeNull()
    expect(latestKunPhaseReached({ 'main:app-ready': 100 })).toBeNull()
  })

  it('returns the furthest kun phase in lifecycle order', () => {
    expect(latestKunPhaseReached({ 'kun:spawn-start': 10 })).toBe('kun:spawn-start')
    expect(latestKunPhaseReached({ 'kun:spawn-start': 10, 'kun:spawn-done': 20 })).toBe(
      'kun:spawn-done'
    )
    expect(
      latestKunPhaseReached({
        'kun:spawn-start': 10,
        'kun:spawn-done': 20,
        'kun:ready': 30,
        'kun:health-ok': 30
      })
    ).toBe('kun:health-ok')
    // 外部/已预热运行时：跳过 spawn 直接 health-ok（ensureKunRuntime healthy 分支）。
    expect(latestKunPhaseReached({ 'kun:health-ok': 5 })).toBe('kun:health-ok')
  })
})

function dirnameOf(filePath: string): string {
  return filePath.slice(0, filePath.lastIndexOf('/'))
}
