import { describe, expect, it } from 'vitest'
import enCommon from '../../locales/en/common.json'
import zhCommon from '../../locales/zh/common.json'
import {
  CODE_STARTER_CARDS,
  CODE_STARTER_TONE_CLASS,
  type CodeStarterTone
} from './code-starter-deck'

/**
 * Code 首页启动工作台快捷卡合同测试（07-13-code-home-workbench Step 1.2）。
 * 锁定：8 张固定卡、id/promptKey 唯一、全部 i18n 三件套键在 en/zh 双语齐全。
 */

const en = enCommon as Record<string, unknown>
const zh = zhCommon as Record<string, unknown>

describe('code starter deck contract', () => {
  it('ships exactly 8 cards (PRD R2 cap, no more/grouping)', () => {
    expect(CODE_STARTER_CARDS).toHaveLength(8)
  })

  it('keeps card ids and prompt keys unique', () => {
    const ids = CODE_STARTER_CARDS.map((card) => card.id)
    expect(new Set(ids).size).toBe(CODE_STARTER_CARDS.length)

    const promptKeys = CODE_STARTER_CARDS.map((card) => card.promptKey)
    expect(new Set(promptKeys).size).toBe(CODE_STARTER_CARDS.length)
  })

  it('registers every title/sub/prompt key in BOTH en and zh common.json', () => {
    for (const card of CODE_STARTER_CARDS) {
      for (const key of [card.titleKey, card.subKey, card.promptKey]) {
        expect(en[key], `en common.json missing "${key}"`).toBeTypeOf('string')
        expect(zh[key], `zh common.json missing "${key}"`).toBeTypeOf('string')
        expect(String(en[key]).trim().length, `en "${key}" is empty`).toBeGreaterThan(0)
        expect(String(zh[key]).trim().length, `zh "${key}" is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('uses an icon component and a mapped tone on every card', () => {
    for (const card of CODE_STARTER_CARDS) {
      expect(card.icon, `card "${card.id}" has no icon`).toBeTruthy()
      expect(
        CODE_STARTER_TONE_CLASS[card.tone],
        `card "${card.id}" tone "${card.tone}" is unmapped`
      ).toBeTypeOf('string')
    }
  })

  it('maps all three tones to soft token classes (dual-theme safe)', () => {
    const tones: CodeStarterTone[] = ['accent', 'success', 'skill']
    expect(Object.keys(CODE_STARTER_TONE_CLASS).sort()).toEqual([...tones].sort())
    expect(CODE_STARTER_TONE_CLASS.accent).toBe('bg-accent-soft text-accent')
    expect(CODE_STARTER_TONE_CLASS.success).toBe('bg-ds-success-soft text-ds-success')
    expect(CODE_STARTER_TONE_CLASS.skill).toBe('bg-ds-skill-soft text-ds-skill')
  })

  it('keeps guided multi-line templates so users can continue filling context (R3)', () => {
    // 结构化模板（含续填字段）至少覆盖 6/8 张卡；纯单句模板（如结构分析）允许。
    const multiline = CODE_STARTER_CARDS.filter((card) =>
      String(zh[card.promptKey]).includes('\n')
    )
    expect(multiline.length).toBeGreaterThanOrEqual(6)
  })
})
