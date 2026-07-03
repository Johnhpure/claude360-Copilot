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

  it('silently ensures a matched existing key so the runtime receives a full local secret/ref', async () => {
    const promptCreateAndEnsure = vi.fn()
    const ensureUsableKey = vi.fn(async () => true)
    const ok = await ensureGroupKeyForSelection('codex', {
      listTokens: async () => [{ id: 42, group: 'Codex', name: 'settings-masked-key', status: 1 }],
      promptCreateAndEnsure,
      ensureUsableKey
    } as Parameters<typeof ensureGroupKeyForSelection>[1] & {
      ensureUsableKey: (group: string) => Promise<boolean>
    })
    expect(ok).toBe(true)
    expect(ensureUsableKey).toHaveBeenCalledWith('codex')
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

  it('matches groups case-insensitively (Codex key satisfies codex selection, no prompt)', async () => {
    // 线上真实 bug：providerId 归一化把分组 lowercase（Codex→codex），而服务端
    // token.group 保留原始大小写；已有 Key 的分组绝不能再弹创建弹窗。
    const promptCreateAndEnsure = vi.fn()
    const ok = await ensureGroupKeyForSelection('codex', {
      listTokens: async () => [{ id: 1, group: 'Codex', name: '手动Key' }],
      promptCreateAndEnsure
    })
    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).not.toHaveBeenCalled()
  })

  it('emits debug logs with feature/group/model/keyList and the match outcome', async () => {
    const logs: string[] = []
    await ensureGroupKeyForSelection(
      'codex',
      {
        listTokens: async () => [{ id: 3, group: 'vip', name: 'k' }],
        promptCreateAndEnsure: async () => true,
        log: (m) => logs.push(m)
      },
      { feature: 'Code', model: 'gpt-5.5', providerId: 'claude360-codex' }
    )
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('feature=Code')
    expect(logs[0]).toContain('group="codex"')
    expect(logs[0]).toContain('model="gpt-5.5"')
    expect(logs[0]).toContain('group="vip"')
    expect(logs[0]).toContain('弹窗询问自动创建')
  })

  it('prompts when the group only has disabled keys (status !== 1 does not count as usable)', async () => {
    const promptCreateAndEnsure = vi.fn(async () => true)
    const logs: string[] = []
    const ok = await ensureGroupKeyForSelection('codex', {
      listTokens: async () => [{ id: 9, group: 'Codex', name: '禁用Key', status: 2 }],
      promptCreateAndEnsure,
      log: (m) => logs.push(m)
    })
    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).toHaveBeenCalledWith('codex')
    expect(logs[0]).toContain('均已禁用')
  })

  it('fails open (returns true, no prompt) when the token check itself throws', async () => {
    const promptCreateAndEnsure = vi.fn()
    const ok = await ensureGroupKeyForSelection('vip', {
      listTokens: async () => {
        throw new Error('not signed in / network down')
      },
      promptCreateAndEnsure
    })
    // 检测失败时放行：请求走出去由运行时/服务端报可见错误，而不是静默吞掉任务。
    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).not.toHaveBeenCalled()
  })
})
