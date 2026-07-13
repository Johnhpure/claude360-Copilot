import { describe, expect, it } from 'vitest'
import enCommon from '../../locales/en/common.json'
import zhCommon from '../../locales/zh/common.json'
import { CODE_STARTER_TONE_CLASS } from './code-starter-deck'
import { CONVERSATION_STARTER_CARDS } from './conversation-starter-deck'

/**
 * 「对话」通用 AI 首页快捷卡合同测试（07-13-code-home-polish Step 1）。
 * 锁定：8 张固定卡、id/promptKey 唯一、全部 i18n 三件套键在 en/zh 双语齐全、
 * tone 映射合法、多行续填模板占比。
 */

const en = enCommon as Record<string, unknown>
const zh = zhCommon as Record<string, unknown>

describe('conversation starter deck contract', () => {
  it('ships exactly 8 cards (PRD R3, no more/grouping)', () => {
    expect(CONVERSATION_STARTER_CARDS).toHaveLength(8)
  })

  it('keeps card ids and prompt keys unique', () => {
    const ids = CONVERSATION_STARTER_CARDS.map((card) => card.id)
    expect(new Set(ids).size).toBe(CONVERSATION_STARTER_CARDS.length)

    const promptKeys = CONVERSATION_STARTER_CARDS.map((card) => card.promptKey)
    expect(new Set(promptKeys).size).toBe(CONVERSATION_STARTER_CARDS.length)
  })

  it('registers every title/sub/prompt key in BOTH en and zh common.json', () => {
    for (const card of CONVERSATION_STARTER_CARDS) {
      for (const key of [card.titleKey, card.subKey, card.promptKey]) {
        expect(en[key], `en common.json missing "${key}"`).toBeTypeOf('string')
        expect(zh[key], `zh common.json missing "${key}"`).toBeTypeOf('string')
        expect(String(en[key]).trim().length, `en "${key}" is empty`).toBeGreaterThan(0)
        expect(String(zh[key]).trim().length, `zh "${key}" is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('uses an icon component and a mapped tone on every card', () => {
    for (const card of CONVERSATION_STARTER_CARDS) {
      expect(card.icon, `card "${card.id}" has no icon`).toBeTruthy()
      expect(
        CODE_STARTER_TONE_CLASS[card.tone],
        `card "${card.id}" tone "${card.tone}" is unmapped`
      ).toBeTypeOf('string')
    }
  })

  it('keeps guided multi-line templates so users can continue filling context', () => {
    // 结构化模板（含续填字段/粘贴位）至少覆盖 6/8 张卡。
    const multiline = CONVERSATION_STARTER_CARDS.filter((card) =>
      String(zh[card.promptKey]).includes('\n')
    )
    expect(multiline.length).toBeGreaterThanOrEqual(6)
  })
})
