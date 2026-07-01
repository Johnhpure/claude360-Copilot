import { describe, expect, it, vi } from 'vitest'
import { ensureGroupKeyForSelection, groupNameFromProviderId } from './group-key-ensure'

describe('groupNameFromProviderId', () => {
  it('extracts the group name from claude360 provider ids (colon or hyphen form)', () => {
    expect(groupNameFromProviderId('claude360:vip-group')).toBe('vip-group')
    expect(groupNameFromProviderId('claude360-vip-group')).toBe('vip-group')
    expect(groupNameFromProviderId('claude360-auto')).toBe('auto')
  })

  it('returns null for non-claude360 or empty ids', () => {
    expect(groupNameFromProviderId('deepseek')).toBeNull()
    expect(groupNameFromProviderId(undefined)).toBeNull()
    expect(groupNameFromProviderId('  ')).toBeNull()
  })
})

describe('ensureGroupKeyForSelection', () => {
  it('passes through when group is null (non-claude360 selection)', async () => {
    const promptCreateAndEnsure = vi.fn()
    const ok = await ensureGroupKeyForSelection(null, {
      listTokens: async () => [],
      promptCreateAndEnsure
    })
    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).not.toHaveBeenCalled()
  })

  it('returns true without prompting when the group already has a key', async () => {
    const promptCreateAndEnsure = vi.fn()
    const ok = await ensureGroupKeyForSelection('vip', {
      listTokens: async () => [{ group: 'auto' }, { group: 'vip' }],
      promptCreateAndEnsure
    })
    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).not.toHaveBeenCalled()
  })

  it('prompts and returns the prompt result when the group has no key (confirm→true)', async () => {
    const promptCreateAndEnsure = vi.fn(async () => true)
    const ok = await ensureGroupKeyForSelection('vip', {
      listTokens: async () => [{ group: 'auto' }],
      promptCreateAndEnsure
    })
    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).toHaveBeenCalledWith('vip')
  })

  it('returns false when the user cancels the prompt (caller should revert)', async () => {
    const ok = await ensureGroupKeyForSelection('vip', {
      listTokens: async () => [],
      promptCreateAndEnsure: async () => false
    })
    expect(ok).toBe(false)
  })
})
