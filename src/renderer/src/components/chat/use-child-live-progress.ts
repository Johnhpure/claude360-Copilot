import { useEffect, useRef, useState } from 'react'
import { getProvider } from '../../agent/registry'
import type { ChatBlock, ThreadEventSink, ToolEventPayload } from '../../agent/types'

/**
 * Live tool-step progress for one running subagent.
 *
 * The parent thread's stream only carries a child's lifecycle transitions
 * (queued → running → completed), so between them the card has nothing to show
 * — which is exactly what made an 8-minute delegation read as a hang. The child
 * IS its own thread though, persisted through the shared event recorder, so we
 * subscribe to it directly and count tool calls as they land.
 *
 * Counting matches the runtime's own tally in `child-agent-executor.ts`
 * (items with `kind === 'tool_call'`), so the live number lines up with the
 * final `toolInvocations` the card shows once the child finishes.
 */
export type ChildLiveProgress = {
  /** Tool calls observed so far, or undefined before the first snapshot lands. */
  steps?: number
  /** Name of the most recently started tool. */
  currentTool?: string
  /** Local clock at the last observed activity — drives the "N 秒前" hint. */
  lastActivityAtMs?: number
}

/**
 * `ThreadEventSink` requires a dozen handlers; a progress watcher cares about
 * three. This base keeps the object literal below honest against contract
 * changes without pulling the whole store-facing sink into a card.
 */
function noopSink(): ThreadEventSink {
  return {
    onSeq: () => undefined,
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTurnComplete: () => undefined,
    onError: () => undefined
  }
}

function readToolName(meta: Record<string, unknown> | undefined): string | undefined {
  const value = meta?.toolName
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readCallId(meta: Record<string, unknown> | undefined): string | undefined {
  const value = meta?.callId
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Initial step count from a child thread snapshot. Mirrors the runtime's own
 * tally (`child-agent-executor.ts` counts items with `kind === 'tool_call'`),
 * so the live number and the final `toolInvocations` agree.
 */
export function countStepsInBlocks(blocks: ChatBlock[]): number {
  return blocks.filter((block) => block.kind === 'tool').length
}

/**
 * Fold one tool event into the progress state. Exported for unit tests — the
 * dedupe is the part worth pinning: `tool_call_ready` and the later item events
 * describe the SAME call, so counting both would inflate every step.
 *
 * Mutates `seenCallIds` (the caller owns it across events).
 */
export function nextProgressForTool(
  previous: ChildLiveProgress,
  event: Pick<ToolEventPayload, 'itemId' | 'summary' | 'meta'>,
  seenCallIds: Set<string>,
  nowMs: number
): ChildLiveProgress {
  const callId = readCallId(event.meta) ?? event.itemId
  const isNew = !seenCallIds.has(callId)
  if (isNew) seenCallIds.add(callId)
  const toolName = readToolName(event.meta) ?? event.summary
  return {
    steps: isNew ? (previous.steps ?? 0) + 1 : previous.steps,
    ...(toolName ? { currentTool: toolName } : previous.currentTool ? { currentTool: previous.currentTool } : {}),
    lastActivityAtMs: nowMs
  }
}

export function useChildLiveProgress(
  childId: string | undefined,
  active: boolean
): ChildLiveProgress {
  const [progress, setProgress] = useState<ChildLiveProgress>({})
  // Dedupe across both event shapes that describe one call: `tool_call_ready`
  // and the later item events share a callId, so a Set keeps the count honest.
  const seenCallIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!childId || !active) return
    let cancelled = false
    const controller = new AbortController()
    seenCallIds.current = new Set()

    const run = async (): Promise<void> => {
      const provider = getProvider()
      let sinceSeq = 0
      try {
        // Snapshot first: a child that has been running for minutes already has
        // thousands of persisted events. Subscribing from seq 0 would replay all
        // of them just to arrive at the same number.
        const detail = await provider.getThreadDetail(childId)
        if (cancelled) return
        sinceSeq = detail.latestSeq
        setProgress({ steps: countStepsInBlocks(detail.blocks), lastActivityAtMs: Date.now() })
      } catch {
        // A child thread that isn't queryable yet (still queued) just reports
        // no steps; the subscription below still picks it up once it starts.
        if (cancelled) return
      }
      if (cancelled || controller.signal.aborted) return

      const sink: ThreadEventSink = {
        ...noopSink(),
        onTool: (ev) => {
          if (cancelled) return
          setProgress((prev) => nextProgressForTool(prev, ev, seenCallIds.current, Date.now()))
        },
        onDeltas: () => {
          // Text streaming means the child is alive even when no tool is running
          // (e.g. writing its final report) — refresh the activity clock only.
          if (cancelled) return
          setProgress((prev) => ({ ...prev, lastActivityAtMs: Date.now() }))
        }
      }

      try {
        await provider.subscribeThreadEvents(childId, sinceSeq, sink, controller.signal)
      } catch {
        // Stream errors leave the last known progress on screen rather than
        // blanking the card — a stale count still reads better than a hang.
      }
    }

    void run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [childId, active])

  return progress
}
