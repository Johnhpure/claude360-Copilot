import { create } from 'zustand'
import type { Claude360TokenPurpose } from '@shared/claude360'
import { sameClaude360Group } from '@shared/claude360'
import { formatRuntimeError } from '../lib/format-runtime-error'

/**
 * 「需要创建分组 Key」优雅模态的全局状态（Code / 写作 / 生图 / 音乐共用）。
 *
 * open(group, purpose) 返回一个 Promise：用户点「自动创建」→ 内部 ensure(建 Key + 回填
 * profile.apiKeyRef + 重启运行时) 成功后 resolve(true)，调用方据此续跑本次任务；
 * 点「取消」→ resolve(false)，调用方中止本次任务（模型选择保持不变）。
 * ensure 失败 → 模态保持打开并展示真实失败原因（error），用户可重试或取消；
 * 绝不静默关闭后再次弹出（否则形成「点创建 → 无提示 → 再弹创建」死循环）。
 * purpose 决定建 Key 的用途（text/image/music）。
 */

export type GroupKeyPromptState = {
  group: string | null
  purpose: Claude360TokenPurpose
  submitting: boolean
  succeeded: boolean
  /** 最近一次自动创建失败的真实原因（已剥离 IPC 前缀/脱敏）；null 表示无错误。 */
  error: string | null
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
  error: null,
  resolve: null,
  open: (group, purpose = 'text') =>
    new Promise<boolean>((resolve) => {
      // 已有未决 prompt 时先以"未就绪"结算旧的，避免 Promise 悬挂。
      get().resolve?.(false)
      set({ group, purpose, submitting: false, succeeded: false, error: null, resolve })
    }),
  confirm: async () => {
    const { group, purpose, resolve } = get()
    if (!group || !resolve) return
    if (typeof window.kunGui?.claude360TokensEnsure !== 'function') {
      resolve(false)
      set({ group: null, submitting: false, succeeded: false, error: null, resolve: null })
      return
    }
    // 重试时清空上次错误；日志只含分组/用途，不含任何 Key 内容。
    set({ submitting: true, error: null })
    console.info(`[group-key] 自动创建请求 group="${group}" purpose=${purpose}`)
    try {
      // ensure 会在主进程建/复用该分组 Key 并回填对应 profile 的 apiKeyRef。
      const ref = await window.kunGui.claude360TokensEnsure({ group, purpose })
      console.info(
        `[group-key] 自动创建成功 group="${group}" tokenId=${ref?.tokenId ?? '?'} tokenGroup="${ref?.group ?? '?'}"`
      )
      // 先 resolve(true) 让调用方立即续跑本次任务，再转「成功」态短暂提示（模态由 reset 自动关闭）。
      resolve(true)
      // 刷新后复核：重新拉 keyList 确认该分组已能匹配到 Key（仅日志，不阻断续跑）。
      if (typeof window.kunGui?.claude360TokensList === 'function') {
        void window.kunGui
          .claude360TokensList()
          .then((tokens) => {
            const matched = tokens.find(
              (tk) => sameClaude360Group(tk.group, ref?.group ?? group) && tk.status === 1
            )
            console.info(
              `[group-key] 刷新后 keyList=${tokens.length} 条 → ${
                matched ? `已匹配到 #${matched.id} group="${matched.group}"` : '未匹配到新 Key（请检查分组名）'
              }`
            )
          })
          .catch(() => undefined)
      }
      // await 期间可能有新 open() 接管了 store（旧 resolve 已被 open 以 false 结算）；
      // 此时只结算自己的 Promise，不得覆盖新 prompt 的状态，否则新调用方永远悬挂。
      if (get().resolve !== null && get().resolve !== resolve) return
      set({ submitting: false, succeeded: true, resolve: null })
    } catch (error) {
      // 失败：保持模态打开并展示真实原因，resolve 不结算（用户可重试或取消）。
      const message = formatRuntimeError(error)
      console.info(`[group-key] 自动创建失败 group="${group}" purpose=${purpose} 原因: ${message}`)
      if (get().resolve !== null && get().resolve !== resolve) return
      set({ submitting: false, succeeded: false, error: message })
    }
  },
  cancel: () => {
    get().resolve?.(false)
    set({ group: null, submitting: false, succeeded: false, error: null, resolve: null })
  },
  // 成功提示展示完毕后由模态调用：清空全部状态并关闭模态。
  reset: () =>
    set({ group: null, purpose: 'text', submitting: false, succeeded: false, error: null, resolve: null })
}))
