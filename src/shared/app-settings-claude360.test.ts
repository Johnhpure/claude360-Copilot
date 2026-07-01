import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLAUDE360_BASE_URL,
  defaultClaude360Settings,
  mergeClaude360Settings,
  normalizeClaude360Settings
} from './app-settings-claude360'

describe('defaultClaude360Settings', () => {
  it('uses the Claude360 base url and logged-out defaults', () => {
    const defaults = defaultClaude360Settings()
    expect(defaults.baseUrl).toBe('https://claude360.xyz')
    expect(DEFAULT_CLAUDE360_BASE_URL).toBe('https://claude360.xyz')
    expect(defaults.loggedIn).toBe(false)
    expect(defaults.username).toBe('')
    expect(defaults.defaultGroup).toBe('auto')
    expect(defaults.tokenRefs).toEqual({})
    expect(defaults.modelCache).toEqual({ groups: [], models: [] })
  })

  it('never stores cli_token or API key plaintext fields', () => {
    const defaults = defaultClaude360Settings()
    // 只允许 secret store 引用键 cliTokenRef，不允许任何明文凭据字段
    expect(defaults.cliTokenRef).toBe('')
    expect(Object.keys(defaults)).not.toContain('cliToken')
    expect(Object.keys(defaults)).not.toContain('cli_token')
    expect(Object.keys(defaults)).not.toContain('apiKey')
    expect(Object.keys(defaults)).not.toContain('apiKeys')
  })
})

describe('normalizeClaude360Settings', () => {
  it('fills defaults when input is missing', () => {
    expect(normalizeClaude360Settings(undefined)).toEqual(defaultClaude360Settings())
  })

  it('strips trailing slashes from base url and falls back when empty', () => {
    expect(normalizeClaude360Settings({ baseUrl: 'https://x.test/' }).baseUrl).toBe('https://x.test')
    expect(normalizeClaude360Settings({ baseUrl: '   ' }).baseUrl).toBe('https://claude360.xyz')
  })

  it('drops malformed token refs and non-string model cache entries', () => {
    const normalized = normalizeClaude360Settings({
      tokenRefs: {
        good: { tokenId: 7, name: 'text', group: 'auto' },
        // @ts-expect-error 故意构造非法 ref
        bad: { name: 'no-id' }
      },
      // @ts-expect-error 故意构造非法 model cache
      modelCache: { groups: ['a', 1, 'a'], models: null }
    })
    expect(normalized.tokenRefs).toEqual({ good: { tokenId: 7, name: 'text', group: 'auto' } })
    expect(normalized.modelCache).toEqual({ groups: ['a'], models: [] })
  })
})

describe('mergeClaude360Settings', () => {
  it('shallow-merges token refs and model cache while normalizing', () => {
    const current = normalizeClaude360Settings({
      loggedIn: true,
      username: 'demo',
      tokenRefs: { text: { tokenId: 1, name: 'text', group: 'auto' } },
      modelCache: { groups: ['auto'], models: ['m1'] }
    })
    const merged = mergeClaude360Settings(current, {
      tokenRefs: { image: { tokenId: 2, name: 'image', group: 'image' } },
      modelCache: { models: ['m1', 'm2'] }
    })
    expect(Object.keys(merged.tokenRefs).sort()).toEqual(['image', 'text'])
    expect(merged.modelCache.groups).toEqual(['auto'])
    expect(merged.modelCache.models).toEqual(['m1', 'm2'])
    expect(merged.username).toBe('demo')
  })
})
