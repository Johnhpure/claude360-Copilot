import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GROUP_KEY_CACHE_TTL_MS,
  claude360GroupForSelection,
  ensureGroupKeyForSelection,
  groupNameFromProviderId,
  invalidateGroupKeyCache
} from './group-key-ensure'

// 模块级「已验证分组」缓存会跨用例泄漏，每个用例前必须清空。
beforeEach(() => {
  invalidateGroupKeyCache()
})

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

describe('claude360GroupForSelection', () => {
  // 中文分组的 providerId 是带指纹的归一化形态，只有分组清单里的 label
  // 才是服务端原始分组名；名称配对必须优先取 label（07-17 国模分组事故）。
  it('prefers the group label from composerModelGroups over id-derived fragments', () => {
    const groups = [
      { providerId: 'claude360-x1a2b3c4d', label: '国模分组' },
      { providerId: 'claude360-codex', label: 'Codex' }
    ]
    expect(claude360GroupForSelection(groups, 'claude360-x1a2b3c4d')).toBe('国模分组')
    expect(claude360GroupForSelection(groups, 'claude360-codex')).toBe('Codex')
  })

  it('falls back to prefix-derived group when the provider is missing from groups', () => {
    expect(claude360GroupForSelection([], 'claude360-vip')).toBe('vip')
  })

  // 指纹形态的 id 反解不出真实分组名：分组清单缺失时必须返回 null（fail-open），
  // 绝不能把 'x1a2b3c4d' 这类片段当分组名去弹「创建 Key」或调后端。
  it('returns null instead of a fingerprint fragment when the provider is missing from groups', () => {
    expect(claude360GroupForSelection([], 'claude360-x1a2b3c4d')).toBeNull()
    expect(claude360GroupForSelection([], 'claude360-glm-x6b38884e')).toBeNull()
  })

  it('returns null for non-claude360 providers regardless of groups', () => {
    expect(claude360GroupForSelection([{ providerId: 'deepseek', label: 'DeepSeek' }], 'deepseek')).toBeNull()
    expect(claude360GroupForSelection([], undefined)).toBeNull()
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

describe('ensureGroupKeyForSelection verified-group cache (07-05)', () => {
  const successDeps = (listTokens: ReturnType<typeof vi.fn>, ensureUsableKey: ReturnType<typeof vi.fn>) => ({
    listTokens: listTokens as unknown as () => Promise<{ group: string; id?: number; status?: number }[]>,
    ensureUsableKey: ensureUsableKey as unknown as (group: string) => Promise<boolean>,
    promptCreateAndEnsure: vi.fn(async () => false)
  })

  it('skips listTokens + ensure on the second call for the same group (cache hit)', async () => {
    const listTokens = vi.fn(async () => [{ id: 1, group: 'vip', status: 1 }])
    const ensureUsableKey = vi.fn(async () => true)
    const deps = successDeps(listTokens, ensureUsableKey)
    expect(await ensureGroupKeyForSelection('vip', deps)).toBe(true)
    expect(await ensureGroupKeyForSelection('vip', deps)).toBe(true)
    expect(listTokens).toHaveBeenCalledTimes(1)
    expect(ensureUsableKey).toHaveBeenCalledTimes(1)
  })

  it('cache hit is case-insensitive on group name and logs the hit', async () => {
    const listTokens = vi.fn(async () => [{ id: 1, group: 'Codex', status: 1 }])
    const ensureUsableKey = vi.fn(async () => true)
    const logs: string[] = []
    await ensureGroupKeyForSelection('codex', { ...successDeps(listTokens, ensureUsableKey), log: (m) => logs.push(m) })
    await ensureGroupKeyForSelection('Codex', { ...successDeps(listTokens, ensureUsableKey), log: (m) => logs.push(m) })
    expect(listTokens).toHaveBeenCalledTimes(1)
    expect(logs.some((m) => m.includes('命中已验证缓存'))).toBe(true)
  })

  it('re-checks after TTL expiry', async () => {
    let clock = 1_000_000
    const listTokens = vi.fn(async () => [{ id: 1, group: 'vip', status: 1 }])
    const ensureUsableKey = vi.fn(async () => true)
    const deps = { ...successDeps(listTokens, ensureUsableKey), now: () => clock }
    await ensureGroupKeyForSelection('vip', deps)
    clock += GROUP_KEY_CACHE_TTL_MS + 1
    await ensureGroupKeyForSelection('vip', deps)
    expect(listTokens).toHaveBeenCalledTimes(2)
  })

  it('re-checks after invalidateGroupKeyCache (create/delete key, account switch, group refresh)', async () => {
    const listTokens = vi.fn(async () => [{ id: 1, group: 'vip', status: 1 }])
    const ensureUsableKey = vi.fn(async () => true)
    const deps = successDeps(listTokens, ensureUsableKey)
    await ensureGroupKeyForSelection('vip', deps)
    invalidateGroupKeyCache('vip')
    await ensureGroupKeyForSelection('vip', deps)
    expect(listTokens).toHaveBeenCalledTimes(2)
  })

  it('does NOT cache fail-open results (listTokens throwing keeps real-time checks)', async () => {
    const listTokens = vi.fn(async () => {
      throw new Error('network down')
    })
    const deps = {
      listTokens: listTokens as unknown as () => Promise<{ group: string }[]>,
      promptCreateAndEnsure: vi.fn(async () => false)
    }
    expect(await ensureGroupKeyForSelection('vip', deps)).toBe(true)
    expect(await ensureGroupKeyForSelection('vip', deps)).toBe(true)
    expect(listTokens).toHaveBeenCalledTimes(2)
  })

  it('does NOT cache when ensureUsableKey fails, and caches a confirmed prompt creation', async () => {
    const listTokens = vi.fn(async () => [{ id: 1, group: 'vip', status: 1 }])
    const ensureFail = vi.fn(async () => false)
    const failDeps = successDeps(listTokens, ensureFail)
    expect(await ensureGroupKeyForSelection('vip', failDeps)).toBe(false)
    expect(await ensureGroupKeyForSelection('vip', failDeps)).toBe(false)
    expect(listTokens).toHaveBeenCalledTimes(2)

    // 弹窗建 Key 成功 → 缓存生效，下一次不再拉 keyList。
    const emptyList = vi.fn(async () => [] as { group: string }[])
    const prompt = vi.fn(async () => true)
    const promptDeps = {
      listTokens: emptyList as unknown as () => Promise<{ group: string }[]>,
      promptCreateAndEnsure: prompt
    }
    expect(await ensureGroupKeyForSelection('fresh', promptDeps)).toBe(true)
    expect(await ensureGroupKeyForSelection('fresh', promptDeps)).toBe(true)
    expect(emptyList).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})

describe('两级缓存隔离（审查 Critical 2：listed 不满足 ensured 调用）', () => {
  it('生图（无 ensureUsableKey）验证过的分组，Code（带 ensureUsableKey）调用不命中缓存并完整 ensure', async () => {
    const listTokens = vi.fn(async () => [{ id: 1, group: 'vip', status: 1 }])
    // 生图路径：只确认有 Key（listed 级）
    await ensureGroupKeyForSelection('vip', {
      listTokens: listTokens as unknown as () => Promise<{ group: string }[]>,
      promptCreateAndEnsure: vi.fn(async () => false)
    })
    expect(listTokens).toHaveBeenCalledTimes(1)
    // Code 路径：必须重新 listTokens + ensureUsableKey（apiKeyRef 回填不可跳过）
    const ensureUsableKey = vi.fn(async () => true)
    const ok = await ensureGroupKeyForSelection('vip', {
      listTokens: listTokens as unknown as () => Promise<{ group: string }[]>,
      ensureUsableKey,
      promptCreateAndEnsure: vi.fn(async () => false)
    })
    expect(ok).toBe(true)
    expect(listTokens).toHaveBeenCalledTimes(2)
    expect(ensureUsableKey).toHaveBeenCalledTimes(1)
    // ensure 过后（ensured 级）再来一次 Code 调用 → 命中缓存
    await ensureGroupKeyForSelection('vip', {
      listTokens: listTokens as unknown as () => Promise<{ group: string }[]>,
      ensureUsableKey,
      promptCreateAndEnsure: vi.fn(async () => false)
    })
    expect(listTokens).toHaveBeenCalledTimes(2)
    expect(ensureUsableKey).toHaveBeenCalledTimes(1)
  })

  it('Code（ensured 级）验证过的分组，生图（listed 需求）调用命中缓存', async () => {
    const listTokens = vi.fn(async () => [{ id: 1, group: 'vip', status: 1 }])
    await ensureGroupKeyForSelection('vip', {
      listTokens: listTokens as unknown as () => Promise<{ group: string }[]>,
      ensureUsableKey: vi.fn(async () => true),
      promptCreateAndEnsure: vi.fn(async () => false)
    })
    await ensureGroupKeyForSelection('vip', {
      listTokens: listTokens as unknown as () => Promise<{ group: string }[]>,
      promptCreateAndEnsure: vi.fn(async () => false)
    })
    expect(listTokens).toHaveBeenCalledTimes(1)
  })
})
