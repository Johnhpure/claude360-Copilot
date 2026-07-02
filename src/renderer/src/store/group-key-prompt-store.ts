import { create } from 'zustand'
import type { Claude360TokenPurpose } from '@shared/claude360'

/**
 * 「需要创建分组 Key」优雅模态的全局状态（Code / 写作 / 生图 / 音乐共用）。
 *
 * open(group, purpose) 返回一个 Promise：用户点「自动创建」→ 内部 ensure(建 Key + 回填
 * profile.apiKeyRef + 重启运行时) 成功后 resolve(true)，调用方据此续跑本次任务；
 * 点「取消」或 ensure 失败 → resolve(false)，调用方中止本次任务（模型选择保持不变）。
 * purpose 决定建 Key 的用途（text/image/music）。
 */

export type GroupKeyPromptState = {
  group: string | null
  purpose: Claude360TokenPurpose
  submitting: boolean
  succeeded: boolean
  resolve: ((ready: boolean) => void) | null
  open: (group: string, purpose?: Claude360TokenPurpose) => Promise<boolean>
  confirm: () => Promise<void>
  cancel: () => void
  reset: () => void
}

export const useGroupKeyPromptStore = create<GroupKeyPromptState>((set, get) => ({
  group: null,
  purpose: 'text',
  submitting: false,
  succeeded: false,
  resolve: null,
  open: (group, purpose = 'text') =>
    new Promise<boolean>((resolve) => {
      // 已有未决 prompt 时先以"未就绪"结算旧的，避免 Promise 悬挂。
      get().resolve?.(false)
      set({ group, purpose, submitting: false, succeeded: false, resolve })
    }),
  confirm: async () => {
    const { group, purpose, resolve } = get()
    if (!group || !resolve) return
    if (typeof window.kunGui?.claude360TokensEnsure !== 'function') {
      resolve(false)
      set({ group: null, submitting: false, succeeded: false, resolve: null })
      return
    }
    set({ submitting: true })
    try {
      // ensure 会在主进程建/复用该分组 Key 并回填对应 profile 的 apiKeyRef。
      await window.kunGui.claude360TokensEnsure({ group, purpose })
      // 先 resolve(true) 让调用方立即续跑本次任务，再转「成功」态短暂提示（模态由 reset 自动关闭）。
      resolve(true)
      // await 期间可能有新 open() 接管了 store（旧 resolve 已被 open 以 false 结算）；
      // 此时只结算自己的 Promise，不得覆盖新 prompt 的状态，否则新调用方永远悬挂。
      if (get().resolve !== null && get().resolve !== resolve) return
      set({ submitting: false, succeeded: true, resolve: null })
    } catch {
      resolve(false)
      if (get().resolve !== null && get().resolve !== resolve) return
      set({ group: null, submitting: false, succeeded: false, resolve: null })
    }
  },
  cancel: () => {
    get().resolve?.(false)
    set({ group: null, submitting: false, succeeded: false, resolve: null })
  },
  // 成功提示展示完毕后由模态调用：清空全部状态并关闭模态。
  reset: () => set({ group: null, purpose: 'text', submitting: false, succeeded: false, resolve: null })
}))
