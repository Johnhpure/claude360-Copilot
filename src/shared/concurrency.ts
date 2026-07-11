/**
 * Bounded-concurrency map for async work (07-11 image-workflow).
 *
 * Mirrors the private `mapWithConcurrency` in src/main/workflow-runtime.ts
 * (kept there on purpose to avoid touching the workflow engine); renderer-side
 * orchestration (image workflow runs) imports this shared copy instead.
 */

/** Run `fn` over items with at most `limit` in flight, preserving result order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
