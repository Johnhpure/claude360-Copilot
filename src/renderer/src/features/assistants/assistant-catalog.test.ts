import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_SUBAGENT_PROFILES } from '../../../../../kun/src/delegation/builtin-profiles'
import en from '../../locales/en/common.json'
import zh from '../../locales/zh/common.json'
import {
  builtinAssistantCatalog,
  builtinAssistants,
  createBuiltinAssistantCatalog
} from './assistant-catalog'
import type { BuiltinAssistantDefinition } from './assistant-types'

const EXPECTED_IDS = [
  'builtin.official-document',
  'builtin.meeting-notes',
  'builtin.report-summary',
  'builtin.research',
  'builtin.data-analysis',
  'builtin.contract-review',
  'builtin.speech-writing',
  'builtin.rules-regulations',
  'builtin.briefing-publicity',
  'builtin.party-building'
] as const

function copyDefinition(
  overrides: Partial<BuiltinAssistantDefinition> = {}
): BuiltinAssistantDefinition {
  return { ...builtinAssistants[0], ...overrides }
}

describe('builtin assistant catalog', () => {
  it('publishes exactly ten stable assistants in deterministic order', () => {
    expect(builtinAssistants.map((item) => item.id)).toEqual(EXPECTED_IDS)
    expect(builtinAssistants.map((item) => item.order)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100
    ])
    expect(builtinAssistants.every((item) => item.version === 1)).toBe(true)
    expect(new Set(builtinAssistants.map((item) => item.id)).size).toBe(EXPECTED_IDS.length)
    expect(Object.isFrozen(builtinAssistants)).toBe(true)
    expect(builtinAssistantCatalog.diagnostics).toEqual([])
  })

  it('resolves every catalog locale key in both supported locale files', () => {
    const zhMessages = zh as unknown as Record<string, unknown>
    const enMessages = en as unknown as Record<string, unknown>

    for (const item of builtinAssistants) {
      for (const key of [item.nameKey, item.descriptionKey, item.riskNoteKey]) {
        expect(zhMessages[key], `missing zh locale key ${key}`).toEqual(expect.any(String))
        expect(enMessages[key], `missing en locale key ${key}`).toEqual(expect.any(String))
      }
    }
    // 「通用助手」概念已删除：默认态是不使用任何助手（assistantNone）。
    expect(zhMessages.assistantNameGeneral).toBeUndefined()
    expect(enMessages.assistantNameGeneral).toBeUndefined()
    expect(zhMessages.assistantNone).toEqual(expect.any(String))
    expect(enMessages.assistantNone).toEqual(expect.any(String))
  })

  it('fails fast for malformed definitions in strict mode', () => {
    expect(() =>
      createBuiltinAssistantCatalog([
        copyDefinition({
          id: 'invalid' as BuiltinAssistantDefinition['id'],
          version: 0,
          nameKey: '',
          systemPrompt: ''
        })
      ])
    ).toThrow(/id must use the reserved builtin\.\* namespace/)
  })

  it('filters malformed and duplicate definitions with diagnostics in production mode', () => {
    const reportInvalid = vi.fn()
    const valid = copyDefinition()
    const duplicateId = copyDefinition({ order: 999 })
    const duplicateOrder = copyDefinition({
      id: 'builtin.meeting-notes',
      order: valid.order
    })
    const catalog = createBuiltinAssistantCatalog(
      [valid, duplicateId, duplicateOrder],
      { strict: false, reportInvalid }
    )

    expect(catalog.items).toEqual([valid])
    expect(catalog.diagnostics).toHaveLength(2)
    expect(catalog.diagnostics.join('\n')).toMatch(/duplicate id/)
    expect(catalog.diagnostics.join('\n')).toMatch(/duplicate order/)
    expect(reportInvalid).toHaveBeenCalledTimes(2)
  })

  it('keeps primary builtins separate from Kun delegate_task profile ids', () => {
    const delegatedIds = new Set(Object.keys(BUILTIN_SUBAGENT_PROFILES))
    expect(EXPECTED_IDS.filter((id) => delegatedIds.has(id))).toEqual([])
    expect([...delegatedIds].sort()).toEqual([
      'design-reviewer',
      'explore',
      'general',
      'over-engineering-reviewer'
    ])
  })

  it('keeps personas static and denies implied installation or expanded permissions', () => {
    for (const item of builtinAssistants) {
      expect(item.systemPrompt).not.toContain('${')
      expect(item.systemPrompt).not.toMatch(
        /本助手已安装|已连接到.{0,12}(系统|平台|数据库)|自动获得.{0,12}权限|无需审批/
      )
      expect(item.systemPrompt).toMatch(/不自动|不得|不能|不代替/)
      expect(item.systemPrompt).toMatch(/确认|审批/)
    }
  })
})
