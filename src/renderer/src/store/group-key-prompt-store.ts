import { create } from 'zustand'
import type { Claude360TokenPurpose } from '@shared/claude360'

/**
 * 「是否为该分组创建 API Key」优雅模态的全局状态（Code / 写作 / 生图 / 音乐共用）。
 *
 * open(group, purpose) 返回一个 Promise：用户点「创建并启用」→ 内部 ensure(建 Key + 回填
 * profile.apiKeyRef) 成功后 resolve(true)；点「取消」或 ensure 失败 → resolve(false)。
 * Code/写作据 false 回退到上一个可用模型；生图/音乐无 provider 鉴权链，取消仅切换模型不回退。
 * purpose 决定建 Key 的用途（text/image/music）。
 */

export type GroupKeyPromptState = {
  group: string | null
  purpose: Claude360TokenPurpose
  submitting: boolean
  resolve: ((ready: boolean) => void) | null
  open: (group: string, purpose?: Claude360TokenPurpose) => Promise<boolean>
  confirm: () => Promise<void>
  cancel: () => void
}

export const useGroupKeyPromptStore = create<GroupKeyPromptState>((set, get) => ({
  group: null,
  purpose: 'text',
  submitting: false,
  resolve: null,
  open: (group, purpose = 'text') =>
    new Promise<boolean>((resolve) => {
      // 已有未决 prompt 时先以"未就绪"结算旧的，避免 Promise 悬挂。
      get().resolve?.(false)
      set({ group, purpose, submitting: false, resolve })
    }),
  confirm: async () => {
    const { group, purpose, resolve } = get()
    if (!group || !resolve) return
    if (typeof window.kunGui?.claude360TokensEnsure !== 'function') {
      resolve(false)
      set({ group: null, submitting: false, resolve: null })
      return
    }
    set({ submitting: true })
    try {
      // ensure 会在主进程建/复用该分组 Key 并回填对应 profile 的 apiKeyRef。
      await window.kunGui.claude360TokensEnsure({ group, purpose })
      resolve(true)
    } catch {
      resolve(false)
    } finally {
      set({ group: null, submitting: false, resolve: null })
    }
  },
  cancel: () => {
    get().resolve?.(false)
    set({ group: null, submitting: false, resolve: null })
  }
}))
