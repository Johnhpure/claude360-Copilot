import { describe, expect, it, vi } from 'vitest'
import { createLazyModule } from './lazy-module'

describe('createLazyModule', () => {
  it('loads the module on first call only and caches the result', async () => {
    const load = vi.fn(async () => ({ value: 42 }))
    const getModule = createLazyModule(load)

    expect(load).not.toHaveBeenCalled()
    await expect(getModule()).resolves.toEqual({ value: 42 })
    await expect(getModule()).resolves.toEqual({ value: 42 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent callers onto the same in-flight promise', async () => {
    let release: ((value: { ready: boolean }) => void) | undefined
    const load = vi.fn(
      () =>
        new Promise<{ ready: boolean }>((resolve) => {
          release = resolve
        })
    )
    const getModule = createLazyModule(load)

    const first = getModule()
    const second = getModule()
    expect(load).toHaveBeenCalledTimes(1)

    release?.({ ready: true })
    await expect(first).resolves.toEqual({ ready: true })
    await expect(second).resolves.toEqual({ ready: true })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('propagates the original load error and allows a retry afterwards', async () => {
    const failure = new Error('bundle missing')
    const load = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ ok: true })
    const getModule = createLazyModule(load)

    await expect(getModule()).rejects.toBe(failure)
    // 失败后缓存被重置：下一次调用重新触发 load 并成功。
    await expect(getModule()).resolves.toEqual({ ok: true })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
