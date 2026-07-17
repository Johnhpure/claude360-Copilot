import { describe, expect, it } from 'vitest'
import type { Claude360LogBilling, Claude360LogItem } from '@shared/claude360'
import type { BrowserStorageLike } from '../../lib/browser-storage'
import {
  DEFAULT_LOGS_PAGE_SIZE,
  LOG_COLUMN_PREFS_STORAGE_KEY,
  LOGS_PAGE_SIZES,
  buildLogsQuery,
  datetimeLocalToTimestamp,
  defaultLogColumnPrefs,
  defaultLogsDraft,
  durationTone,
  formatBillingProcess,
  formatDuration,
  formatLogTime,
  isCallLogType,
  loadColumnPrefs,
  logTypeMeta,
  pageCount,
  pagerItems,
  presetRange,
  saveColumnPrefs,
  timestampToDatetimeLocal,
  type BillingProcessLabels,
  type LogsFilterDraft
} from './my-logs-actions'

// 断言与实现同走 Date 本地分量构造时间，避免与测试机时区耦合。
const NOW = new Date(2026, 6, 17, 15, 30, 45) // 本地 2026-07-17 15:30:45
const NOW_TS = Math.floor(NOW.getTime() / 1000)
const MIDNIGHT_TS = Math.floor(new Date(2026, 6, 17).getTime() / 1000)

describe('presetRange / defaultLogsDraft', () => {
  it('maps sliding presets to windows ending now', () => {
    expect(presetRange('hour1', NOW)).toEqual({ startTimestamp: NOW_TS - 3_600, endTimestamp: NOW_TS })
    expect(presetRange('day7', NOW)).toEqual({ startTimestamp: NOW_TS - 7 * 86_400, endTimestamp: NOW_TS })
    expect(presetRange('day30', NOW)).toEqual({ startTimestamp: NOW_TS - 30 * 86_400, endTimestamp: NOW_TS })
  })

  it('anchors today at local midnight and keeps manual input for custom', () => {
    expect(presetRange('today', NOW)).toEqual({ startTimestamp: MIDNIGHT_TS, endTimestamp: NOW_TS })
    expect(presetRange('custom', NOW)).toBeNull()
  })

  it('defaults to today / all types / empty text filters', () => {
    expect(defaultLogsDraft(NOW)).toEqual({
      preset: 'today',
      startTimestamp: MIDNIGHT_TS,
      endTimestamp: NOW_TS,
      type: 0,
      tokenName: '',
      group: '',
      modelName: '',
      requestId: ''
    })
  })
})

describe('buildLogsQuery', () => {
  const base: LogsFilterDraft = { ...defaultLogsDraft(NOW), preset: 'custom' }

  it('keeps non-empty filters, trims text and floors timestamps', () => {
    const query = buildLogsQuery(
      {
        ...base,
        startTimestamp: 1000.9,
        endTimestamp: 2000.2,
        type: 2,
        tokenName: ' cli ',
        group: 'default',
        modelName: ' claude ',
        requestId: ' req_1 '
      },
      3,
      50
    )
    expect(query).toEqual({
      page: 3,
      pageSize: 50,
      type: 2,
      startTimestamp: 1000,
      endTimestamp: 2000,
      tokenName: 'cli',
      group: 'default',
      modelName: 'claude',
      requestId: 'req_1'
    })
  })

  it('drops type=0, blank strings and null/non-positive timestamps', () => {
    const query = buildLogsQuery(
      { ...base, startTimestamp: null, endTimestamp: 0, type: 0, tokenName: '  ', group: '', modelName: '', requestId: '' },
      1,
      DEFAULT_LOGS_PAGE_SIZE
    )
    expect(query).toEqual({ page: 1, pageSize: 20 })
  })

  it('exposes the confirmed page size options', () => {
    expect([...LOGS_PAGE_SIZES]).toEqual([10, 20, 50, 100])
    expect(LOGS_PAGE_SIZES).toContain(DEFAULT_LOGS_PAGE_SIZE)
  })
})

describe('formatLogTime / formatDuration / durationTone', () => {
  it('splits time into date and time segments with zero padding', () => {
    expect(formatLogTime(NOW_TS)).toEqual({ date: '07-17', time: '15:30:45' })
    expect(formatLogTime(Math.floor(new Date(2026, 0, 5, 8, 3, 7).getTime() / 1000))).toEqual({
      date: '01-05',
      time: '08:03:07'
    })
  })

  it('appends first-token time only for streaming rows', () => {
    expect(formatDuration(3.2, 800, true)).toBe('3.2s · 首0.8s')
    expect(formatDuration(28.4, null, false)).toBe('28.4s')
    // 非流式即使带 frt 也不展示首字（frt 只对流式有意义）。
    expect(formatDuration(5, 900, false)).toBe('5s')
    expect(formatDuration(3, 800, true, 'first ')).toBe('3s · first 0.8s')
  })

  it('guards non-finite and negative inputs', () => {
    expect(formatDuration(Number.NaN, -1, true)).toBe('0s')
    expect(formatDuration(-3, Number.NaN, true)).toBe('0s')
  })

  it('marks <=10s as success and slower as warning', () => {
    expect(durationTone(0.4)).toBe('success')
    expect(durationTone(10)).toBe('success')
    expect(durationTone(10.1)).toBe('warning')
    expect(durationTone(28.4)).toBe('warning')
  })
})

describe('datetime-local conversion', () => {
  it('formats timestamps as minute-precision local values and blanks null/invalid', () => {
    expect(timestampToDatetimeLocal(NOW_TS)).toBe('2026-07-17T15:30')
    expect(timestampToDatetimeLocal(Math.floor(new Date(2026, 0, 5, 8, 3).getTime() / 1000))).toBe(
      '2026-01-05T08:03'
    )
    expect(timestampToDatetimeLocal(null)).toBe('')
    expect(timestampToDatetimeLocal(0)).toBe('')
    expect(timestampToDatetimeLocal(Number.NaN)).toBe('')
  })

  it('parses datetime-local values as local time and nulls empty/invalid input', () => {
    expect(datetimeLocalToTimestamp('2026-07-17T15:30')).toBe(
      Math.floor(new Date(2026, 6, 17, 15, 30).getTime() / 1000)
    )
    expect(datetimeLocalToTimestamp('')).toBeNull()
    expect(datetimeLocalToTimestamp('oops')).toBeNull()
  })

  it('round-trips minute-precision timestamps', () => {
    const ts = Math.floor(new Date(2026, 0, 5, 8, 3).getTime() / 1000)
    expect(datetimeLocalToTimestamp(timestampToDatetimeLocal(ts))).toBe(ts)
  })
})

describe('isCallLogType', () => {
  it('marks consume and error rows as call logs; other types show dashes', () => {
    // 确认稿口径:错误行照常展示模型/用时/输入输出/IP,只有充值/管理/系统/退款用「—」。
    expect(isCallLogType(2)).toBe(true)
    expect(isCallLogType(5)).toBe(true)
    expect(isCallLogType(1)).toBe(false)
    expect(isCallLogType(3)).toBe(false)
    expect(isCallLogType(4)).toBe(false)
    expect(isCallLogType(6)).toBe(false)
    expect(isCallLogType(0)).toBe(false)
  })
})

describe('logTypeMeta', () => {
  it('maps all newapi log types to labelKey + tone', () => {
    expect(logTypeMeta(1)).toEqual({ labelKey: 'myLogsTypeTopup', tone: 'success' })
    expect(logTypeMeta(2)).toEqual({ labelKey: 'myLogsTypeConsume', tone: 'accent' })
    expect(logTypeMeta(3)).toEqual({ labelKey: 'myLogsTypeAdmin', tone: 'warning' })
    expect(logTypeMeta(4)).toEqual({ labelKey: 'myLogsTypeSystem', tone: 'warning' })
    expect(logTypeMeta(5)).toEqual({ labelKey: 'myLogsTypeError', tone: 'danger' })
    expect(logTypeMeta(6)).toEqual({ labelKey: 'myLogsTypeRefund', tone: 'skill' })
  })

  it('falls back to muted unknown for unexpected values', () => {
    expect(logTypeMeta(0)).toEqual({ labelKey: 'myLogsTypeUnknown', tone: 'muted' })
    expect(logTypeMeta(99)).toEqual({ labelKey: 'myLogsTypeUnknown', tone: 'muted' })
  })
})

describe('pageCount / pagerItems', () => {
  it('computes at-least-one page counts', () => {
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(1, 20)).toBe(1)
    expect(pageCount(20, 20)).toBe(1)
    expect(pageCount(21, 20)).toBe(2)
    expect(pageCount(1_284, 20)).toBe(65)
    expect(pageCount(10, 0)).toBe(1)
  })

  it('expands fully when total pages fit the 7 slots', () => {
    expect(pagerItems(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pagerItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pagerItems(1, 0)).toEqual([])
  })

  it('keeps first/last reachable with ellipsis in long ranges', () => {
    expect(pagerItems(1, 65)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 65])
    expect(pagerItems(30, 65)).toEqual([1, 'ellipsis', 29, 30, 31, 'ellipsis', 65])
    expect(pagerItems(63, 65)).toEqual([1, 'ellipsis', 61, 62, 63, 64, 65])
  })

  it('clamps out-of-range current pages', () => {
    expect(pagerItems(99, 10)).toEqual([1, 'ellipsis', 6, 7, 8, 9, 10])
    expect(pagerItems(0, 10)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 10])
  })
})

describe('column prefs persistence', () => {
  function memoryStorage(seed: Record<string, string> = {}): BrowserStorageLike & {
    map: Map<string, string>
  } {
    const map = new Map(Object.entries(seed))
    return {
      map,
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value)
      }
    }
  }

  it('round-trips prefs through storage', () => {
    const storage = memoryStorage()
    const prefs = { ...defaultLogColumnPrefs(), ip: false, requestId: true }
    saveColumnPrefs(prefs, storage)
    expect(storage.map.get(LOG_COLUMN_PREFS_STORAGE_KEY)).toBeTypeOf('string')
    expect(loadColumnPrefs(storage)).toEqual(prefs)
  })

  it('defaults requestId column to hidden', () => {
    expect(defaultLogColumnPrefs()).toEqual({ group: true, duration: true, ip: true, requestId: false })
  })

  it('falls back to defaults on missing key, corrupt JSON or wrong shapes', () => {
    expect(loadColumnPrefs(memoryStorage())).toEqual(defaultLogColumnPrefs())
    expect(loadColumnPrefs(memoryStorage({ [LOG_COLUMN_PREFS_STORAGE_KEY]: '{oops' }))).toEqual(defaultLogColumnPrefs())
    expect(loadColumnPrefs(memoryStorage({ [LOG_COLUMN_PREFS_STORAGE_KEY]: '"str"' }))).toEqual(defaultLogColumnPrefs())
    // 部分键 + 非法值：只吸收合法布尔键，未知键忽略。
    expect(
      loadColumnPrefs(memoryStorage({ [LOG_COLUMN_PREFS_STORAGE_KEY]: '{"ip":false,"group":"yes","extra":true}' }))
    ).toEqual({ ...defaultLogColumnPrefs(), ip: false })
  })

  it('degrades silently when storage is unavailable or throws', () => {
    expect(loadColumnPrefs(null)).toEqual(defaultLogColumnPrefs())
    expect(() => saveColumnPrefs(defaultLogColumnPrefs(), null)).not.toThrow()
    const throwing: BrowserStorageLike = {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      }
    }
    expect(loadColumnPrefs(throwing)).toEqual(defaultLogColumnPrefs())
    expect(() => saveColumnPrefs(defaultLogColumnPrefs(), throwing)).not.toThrow()
  })
})

describe('formatBillingProcess', () => {
  // 原子文案：node 单测注入英文短词，断言不依赖 i18n 运行时。
  const L: BillingProcessLabels = {
    inputPrice: 'Input price',
    outputPrice: 'Output price',
    cacheReadPrice: 'Cache read price',
    cacheWritePrice: 'Cache write price',
    modelPrice: 'Model price',
    groupRatio: 'Group ratio',
    perMillion: '1M tokens',
    input: 'Input',
    cache: 'Cache',
    output: 'Output',
    disclaimer: 'For reference only; the actual charge prevails.'
  }

  function billingFixture(overrides: Partial<Claude360LogBilling> = {}): Claude360LogBilling {
    return {
      perCall: false,
      modelPriceCny: null,
      inputPricePerMCny: 30,
      outputPricePerMCny: 150,
      cacheReadPricePerMCny: 15,
      cacheWritePricePerMCny: 37.5,
      groupRatio: 1.3,
      ...overrides
    }
  }

  function itemFixture(
    billing: Claude360LogBilling | null,
    tokens: Partial<Pick<Claude360LogItem, 'promptTokens' | 'completionTokens' | 'cacheTokens' | 'cacheCreationTokens'>> = {}
  ): Pick<Claude360LogItem, 'billing' | 'promptTokens' | 'completionTokens' | 'cacheTokens' | 'cacheCreationTokens'> {
    return {
      billing,
      promptTokens: tokens.promptTokens ?? 10_000,
      completionTokens: tokens.completionTokens ?? 2_000,
      cacheTokens: tokens.cacheTokens ?? 1_024,
      cacheCreationTokens: tokens.cacheCreationTokens ?? 42
    }
  }

  it('returns an empty array when billing is null (block hidden)', () => {
    expect(formatBillingProcess(itemFixture(null), L)).toEqual([])
  })

  it('lists unit prices, group ratio, formula and a trailing disclaimer for a normal call', () => {
    const lines = formatBillingProcess(itemFixture(billingFixture()), L)
    // 单价行按值输出（含缓存读/写，因对应 tokens>0）。
    expect(lines).toContain('Input price ¥30.0000 / 1M tokens')
    expect(lines).toContain('Output price ¥150.0000 / 1M tokens')
    expect(lines).toContain('Cache read price ¥15.0000 / 1M tokens')
    expect(lines).toContain('Cache write price ¥37.5000 / 1M tokens')
    expect(lines).toContain('Group ratio 1.3000x')
    // normalInput = 10000 − 1024 − 42 = 8934；公式自算总价 ¥0.758394。
    const formula = lines.find((l) => l.includes(' = ¥'))
    expect(formula).toBe(
      '(Input 8,934 × ¥30.0000 / 1M tokens + Cache 1,024 × ¥15.0000 / 1M tokens + Output 2,000 × ¥150.0000 / 1M tokens) × Group ratio 1.3000x = ¥0.758394'
    )
    // 免责声明恒在块尾。
    expect(lines[lines.length - 1]).toBe(L.disclaimer)
  })

  it('omits cache lines and cache term when there are no cache tokens', () => {
    const lines = formatBillingProcess(
      itemFixture(billingFixture(), { promptTokens: 5_000, completionTokens: 500, cacheTokens: 0, cacheCreationTokens: 0 }),
      L
    )
    expect(lines.some((l) => l.startsWith('Cache read price'))).toBe(false)
    expect(lines.some((l) => l.startsWith('Cache write price'))).toBe(false)
    const formula = lines.find((l) => l.includes(' = ¥'))
    // 无缓存 → 只有输入(5000)+输出(500)两段，(0.15+0.075)×1.3 = ¥0.292500。
    expect(formula).toBe(
      '(Input 5,000 × ¥30.0000 / 1M tokens + Output 500 × ¥150.0000 / 1M tokens) × Group ratio 1.3000x = ¥0.292500'
    )
    expect(lines[lines.length - 1]).toBe(L.disclaimer)
  })

  it('shows model price without a token formula for per-call billing', () => {
    const lines = formatBillingProcess(
      itemFixture(billingFixture({ perCall: true, modelPriceCny: 0.1, inputPricePerMCny: null, outputPricePerMCny: null, cacheReadPricePerMCny: null, cacheWritePricePerMCny: null, groupRatio: 2 })),
      L
    )
    expect(lines[0]).toBe('Model price ¥0.100000')
    expect(lines).toContain('Group ratio 2.0000x')
    // 按次计费不出 token 公式行。
    expect(lines.some((l) => l.includes(' = ¥'))).toBe(false)
    expect(lines[lines.length - 1]).toBe(L.disclaimer)
  })

  it('drops price rows and the formula when pricing is missing but keeps the group ratio', () => {
    const lines = formatBillingProcess(
      itemFixture(
        billingFixture({
          inputPricePerMCny: null,
          outputPricePerMCny: null,
          cacheReadPricePerMCny: null,
          cacheWritePricePerMCny: null,
          groupRatio: 1.3
        })
      ),
      L
    )
    // 单价缺失 → 无价格行、无公式行，仅剩分组倍率 + 免责。
    expect(lines).toEqual(['Group ratio 1.3000x', L.disclaimer])
  })
})
