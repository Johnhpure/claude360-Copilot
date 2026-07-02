// 「需要创建分组 Key」弹窗 store 的生命周期测试（node 环境，vi.stubGlobal 注入 window.kunGui）。
// 重点覆盖：confirm 成功续跑 + 成功态、取消、ensure 失败、以及 confirm await 期间被新
// open() 抢占的竞态（旧 confirm 收尾不得覆盖新 prompt 的状态，否则新调用方永远悬挂）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGroupKeyPromptStore } from './group-key-prompt-store'

type EnsurePayload = { group: string; purpose: string }

function resetStore(): void {
  useGroupKeyPromptStore.setState({
    group: null,
    purpose: 'text',
    submitting: false,
    succeeded: false,
    resolve: null
  })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useGroupKeyPromptStore', () => {
  it('confirm 成功：resolve(true) 续跑、转 succeeded 成功态、group 保留供展示', async () => {
    const ensure = vi.fn(async (_p: EnsurePayload) => ({ tokenId: 1, name: 'k', group: 'vip' }))
    vi.stubGlobal('window', { kunGui: { claude360TokensEnsure: ensure } })

    const pending = useGroupKeyPromptStore.getState().open('vip', 'image')
    await useGroupKeyPromptStore.getState().confirm()

    await expect(pending).resolves.toBe(true)
    expect(ensure).toHaveBeenCalledWith({ group: 'vip', purpose: 'image' })
    const s = useGroupKeyPromptStore.getState()
    expect(s.succeeded).toBe(true)
    expect(s.group).toBe('vip')
    expect(s.submitting).toBe(false)
    expect(s.resolve).toBeNull()
  })

  it('cancel：resolve(false) 且状态全清', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    const pending = useGroupKeyPromptStore.getState().open('vip')
    useGroupKeyPromptStore.getState().cancel()

    await expect(pending).resolves.toBe(false)
    const s = useGroupKeyPromptStore.getState()
    expect(s.group).toBeNull()
    expect(s.succeeded).toBe(false)
    expect(s.resolve).toBeNull()
  })

  it('confirm 失败（ensure 抛错）：resolve(false) 且不进成功态', async () => {
    const ensure = vi.fn(async () => {
      throw new Error('network')
    })
    vi.stubGlobal('window', { kunGui: { claude360TokensEnsure: ensure } })

    const pending = useGroupKeyPromptStore.getState().open('vip')
    await useGroupKeyPromptStore.getState().confirm()

    await expect(pending).resolves.toBe(false)
    const s = useGroupKeyPromptStore.getState()
    expect(s.group).toBeNull()
    expect(s.succeeded).toBe(false)
  })

  it('preload 缺 ensure API：confirm 直接 resolve(false)', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    const pending = useGroupKeyPromptStore.getState().open('vip')
    await useGroupKeyPromptStore.getState().confirm()
    await expect(pending).resolves.toBe(false)
  })

  it('竞态：confirm await 期间被新 open 抢占 → 旧 promise 先由 open 以 false 结算，confirm 收尾不得清掉新 prompt 的 resolve', async () => {
    let releaseEnsure!: () => void
    const ensure = vi.fn(
      (_p: EnsurePayload) =>
        new Promise<{ tokenId: number; name: string; group: string }>((resolve) => {
          releaseEnsure = () => resolve({ tokenId: 2, name: 'k', group: 'a' })
        })
    )
    vi.stubGlobal('window', { kunGui: { claude360TokensEnsure: ensure } })

    const first = useGroupKeyPromptStore.getState().open('a')
    const confirming = useGroupKeyPromptStore.getState().confirm()

    // ensure 尚未完成时，另一个入口发起新 prompt：open 应以 false 结算旧 promise。
    const second = useGroupKeyPromptStore.getState().open('b')
    await expect(first).resolves.toBe(false)

    // 旧 confirm 完成后，新 prompt 的 resolve 必须原封不动（否则 second 永远悬挂）。
    releaseEnsure()
    await confirming
    expect(useGroupKeyPromptStore.getState().group).toBe('b')
    expect(useGroupKeyPromptStore.getState().resolve).not.toBeNull()

    // 新 prompt 仍可正常走完取消流程。
    useGroupKeyPromptStore.getState().cancel()
    await expect(second).resolves.toBe(false)
  })

  it('reset：清空全部状态（成功态展示完毕由模态调用）', () => {
    useGroupKeyPromptStore.setState({ group: 'vip', succeeded: true, submitting: false, resolve: null })
    useGroupKeyPromptStore.getState().reset()
    const s = useGroupKeyPromptStore.getState()
    expect(s.group).toBeNull()
    expect(s.succeeded).toBe(false)
    expect(s.purpose).toBe('text')
  })
})
