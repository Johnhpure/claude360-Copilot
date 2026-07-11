import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('mapWithConcurrency', () => {
  it('preserves input order in results', async () => {
    const items = [30, 10, 20]
    const results = await mapWithConcurrency(items, 3, async (item) => {
      await new Promise((res) => setTimeout(res, item))
      return item * 2
    })
    expect(results).toEqual([60, 20, 40])
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((res) => setTimeout(res, 5))
      inFlight -= 1
    })
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('dispatches sequentially when limit is 1', async () => {
    const order: string[] = []
    await mapWithConcurrency(['a', 'b', 'c'], 1, async (item) => {
      order.push(`start-${item}`)
      await Promise.resolve()
      order.push(`end-${item}`)
    })
    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c'])
  })

  it('propagates the first rejection and stops that worker', async () => {
    const gate = deferred()
    const seen: number[] = []
    const promise = mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      seen.push(item)
      if (item === 1) throw new Error('boom')
      await gate.promise
      return item
    })
    await expect(promise).rejects.toThrow('boom')
    gate.resolve()
  })

  it('handles empty input and passes the index through', async () => {
    expect(await mapWithConcurrency([], 4, async () => 'x')).toEqual([])
    const indexed = await mapWithConcurrency(['a', 'b'], 4, async (item, index) => `${item}${index}`)
    expect(indexed).toEqual(['a0', 'b1'])
  })
})
