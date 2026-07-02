import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import { ensureWriteTextGroupKey } from './write-group-key-ensure'

describe('ensureWriteTextGroupKey', () => {
  it('ensures the selected Claude360 text group before a write action runs', async () => {
    const promptCreateAndEnsure = vi.fn(async () => true)

    const ok = await ensureWriteTextGroupKey({
      feature: '写作',
      model: 'claude-sonnet-4'
    }, {
      getSettings: async () => ({
        claude360: { selectedTextGroup: 'Codex' }
      }) as unknown as AppSettingsV1,
      listTokens: async () => [{ group: 'Other', id: 1, status: 1 }],
      promptCreateAndEnsure,
      log: vi.fn()
    })

    expect(ok).toBe(true)
    expect(promptCreateAndEnsure).toHaveBeenCalledWith('Codex')
  })
})
