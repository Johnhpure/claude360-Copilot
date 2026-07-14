import { createContext, useContext } from 'react'

/**
 * Whether the surrounding assistant markdown is still streaming (live SSE).
 * Provided by `StreamdownAssistant`, consumed by `StreamdownCode` to gate the
 * highlight pipeline (trailing throttle + no cache writes while incomplete;
 * 07-14-timeline-performance R3). Streamdown's own `isAnimating` context is
 * intentionally not reused: this host always renders with `animated={false}`
 * and `isAnimating` also drives button disabling.
 */
export const AssistantStreamingContext = createContext(false)

export function useAssistantStreaming(): boolean {
  return useContext(AssistantStreamingContext)
}
