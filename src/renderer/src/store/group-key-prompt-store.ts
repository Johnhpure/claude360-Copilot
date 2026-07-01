import { create } from 'zustand'

/**
 * 「是否为该分组创建 API Key」优雅模态的全局状态（Code 与写作共用同一个）。
 *
 * open(group) 返回一个 Promise：用户点「创建并启用」→ 内部 ensure(建 Key + 回填
 * profile.apiKeyRef) 成功后 resolve(true)；点「取消」或 ensure 失败 → resolve(false)。
 * 调用方据 false 回退到上一个可用模型。
 */

export type GroupKeyPromptState = {
  group: string | null
  submitting: boolean
  resolve: ((ready: boolean) => void) | null
  open: (group: string) => Promise<boolean>
  confirm: () => Promise<void>
  cancel: () => void
}

export const useGroupKeyPromptStore = create<GroupKeyPromptState>((set, get) => ({
  group: null,
  submitting: false,
  resolve: null,
  open: (group) =>
    new Promise<boolean>((resolve) => {
      // 已有未决 prompt 时先以"未就绪"结算旧的，避免 Promise 悬挂。
      get().resolve?.(false)
      set({ group, submitting: false, resolve })
    }),
  confirm: async () => {
    const { group, resolve } = get()
    if (!group || !resolve) return
    if (typeof window.kunGui?.claude360TokensEnsure !== 'function') {
      resolve(false)
      set({ group: null, submitting: false, resolve: null })
      return
    }
    set({ submitting: true })
    try {
      // ensure 会在主进程建/复用该分组 Key 并回填对应 profile 的 apiKeyRef。
      await window.kunGui.claude360TokensEnsure({ group, purpose: 'text' })
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
