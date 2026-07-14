import { useCallback, useInsertionEffect, useRef } from 'react'

/**
 * Returns a referentially-stable function that always invokes the latest
 * `callback`. Standard "useEvent" ref pattern (07-14-timeline-performance R1):
 * handler props passed to memoized children (Sidebar / FloatingComposer /
 * MessageTimeline turns) must not change identity when the assembly component
 * re-renders, otherwise `React.memo` / `MemoMessageTurn`'s comparator is
 * defeated on every streaming batch.
 *
 * The wrapper must only be called from event handlers / effects — never
 * during render. The latest callback is committed via `useInsertionEffect`
 * (runs before layout effects); the initial ref value covers any call that
 * could happen before the first commit.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): (...args: Args) => Result {
  const callbackRef = useRef(callback)
  useInsertionEffect(() => {
    callbackRef.current = callback
  })
  return useCallback((...args: Args) => callbackRef.current(...args), [])
}
