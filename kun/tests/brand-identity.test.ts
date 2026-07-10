import { describe, expect, it } from 'vitest'
import { KUN_SYSTEM_PROMPT } from '../src/prompt/kun-system-prompt.js'
import { BUILTIN_SUBAGENT_PROFILES } from '../src/delegation/builtin-profiles.js'
import { AUTO_MODEL_ROUTER_SYSTEM_PROMPT } from '../src/loop/auto-model-router.js'

// 品牌身份守护：所有发给模型的 prompt 常量必须自称 Claude360 Copilot，
// 不得残留旧品牌（Kun / DeepSeek TUI）。变量名/文件名（KUN_SYSTEM_PROMPT 等）
// 是内部标识符，不发给模型，保留不改。
const LEGACY_BRAND = /\bKun\b|DeepSeek TUI|DeepSeek GUI/

describe('model-facing brand identity', () => {
  it('keeps the core system prompt on the Claude360 Copilot identity', () => {
    expect(KUN_SYSTEM_PROMPT).toContain(
      'You are Claude360 Copilot, a desktop AI workbench assistant powered by Claude360'
    )
    expect(KUN_SYSTEM_PROMPT).not.toMatch(LEGACY_BRAND)
  })

  it('keeps builtin subagent preambles on the Claude360 Copilot identity', () => {
    const profiles = Object.values(BUILTIN_SUBAGENT_PROFILES)
    expect(profiles.length).toBeGreaterThan(0)
    for (const profile of profiles) {
      const preamble = profile.promptPreamble ?? ''
      expect(preamble).toContain('Claude360 Copilot')
      expect(preamble).not.toMatch(LEGACY_BRAND)
    }
  })

  it('keeps the auto-routing classifier prompt free of legacy brands', () => {
    expect(AUTO_MODEL_ROUTER_SYSTEM_PROMPT).toContain('Claude360 Copilot')
    expect(AUTO_MODEL_ROUTER_SYSTEM_PROMPT).not.toMatch(LEGACY_BRAND)
  })
})
