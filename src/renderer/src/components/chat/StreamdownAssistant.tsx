import type { ComponentPropsWithRef, MouseEvent, ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Streamdown, type StreamdownProps } from 'streamdown'
import remarkGfm from 'remark-gfm'
import { harden } from 'rehype-harden'
import { createMathPlugin } from '@streamdown/math'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import { normalizeMathDelimiters } from './normalize-math-delimiters'
import { parseFileReferenceHref, rehypeFileReferences } from '../../lib/file-references'
import { useValidatedFileReference } from '../../lib/file-reference-validation'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { useChatStore } from '../../store/chat-store'
import { AssistantStreamingContext } from './assistant-stream-context'
import { StreamdownCode } from './StreamdownCode'

/** Reveal ~1/8 of the outstanding backlog per frame… */
const CATCHUP_DIVISOR = 8
/** …but never more than this, so a huge backlog (tab refocus, resumed
 * thread, burst from a fast model) drains as fast typing instead of a
 * near-instant wall of text. */
const MAX_STEP_PER_FRAME = 32
/**
 * Above this many characters the typewriter degrades to direct rendering
 * (07-14-timeline-performance R4): streamdown re-lexes the FULL text on every
 * revealed frame, so a per-frame setState over a 100KB reply costs O(n) at
 * 60Hz. Past the threshold we render whole SSE batches as they arrive
 * (~10Hz) instead of per-frame slices. The switch is one-way per reply to
 * avoid mode flapping; a live-text reset (new turn / interrupt) re-arms it.
 */
export const TYPEWRITER_MAX_CHARS = 32_000

export function nextVisibleLength(current: number, target: number): number {
  if (current === target) return current
  // Live text shrank (interrupt / reset) — snap, never animate backwards.
  if (current > target) return target
  const backlog = target - current
  return current + Math.min(MAX_STEP_PER_FRAME, Math.max(1, Math.ceil(backlog / CATCHUP_DIVISOR)))
}

/**
 * One-way "direct render" switch for oversized streaming replies.
 * - Growing text crossing `TYPEWRITER_MAX_CHARS` latches direct mode on.
 * - Once on, it stays on while the reply keeps growing (no flapping).
 * - A shrink (live text reset for a new turn) re-evaluates from scratch.
 */
export function nextTypewriterDirectMode(
  previousLength: number,
  nextLength: number,
  wasDirect: boolean
): boolean {
  if (nextLength < previousLength) return nextLength > TYPEWRITER_MAX_CHARS
  return wasDirect || nextLength > TYPEWRITER_MAX_CHARS
}

/**
 * Paces streaming text so it reveals sequentially, decoupled from SSE
 * chunk sizes. Without this, one bursty chunk spans several markdown
 * blocks and every affected line blurs in at once — the half-faded
 * patches scattered across bullets read as holes instead of typing.
 */
function useTypewriterText(text: string, streaming: boolean): string {
  // Start at the current length: re-entering a thread mid-turn must not
  // replay everything already on screen.
  const [visibleLength, setVisibleLength] = useState(() => text.length)
  const targetRef = useRef(text.length)
  targetRef.current = text.length

  // Oversized-reply degradation (R4). Ref writes during render are
  // idempotent here (same inputs → same result within a render pass).
  const prevLengthRef = useRef(text.length)
  const directRef = useRef(text.length > TYPEWRITER_MAX_CHARS)
  directRef.current = nextTypewriterDirectMode(prevLengthRef.current, text.length, directRef.current)
  prevLengthRef.current = text.length
  const direct = directRef.current

  useEffect(() => {
    if (!streaming || direct) return
    let raf = requestAnimationFrame(function tick() {
      // When caught up this returns the same value, so React bails out of
      // re-rendering and the idle loop costs only the rAF callback.
      setVisibleLength((current) => nextVisibleLength(current, targetRef.current))
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [streaming, direct])

  if (!streaming) return text
  // Direct mode: no per-frame reveal — render each SSE batch in full. The
  // stale `visibleLength` is irrelevant here and gets snapped by
  // `nextVisibleLength` if the reply ever resets below the threshold.
  if (direct) return text
  let length = Math.min(visibleLength, text.length)
  // Don't cut a surrogate pair in half mid-reveal.
  const code = text.charCodeAt(length - 1)
  if (code >= 0xd800 && code <= 0xdbff) length += 1
  return text.slice(0, length)
}

const rehypePlugins = [
  rehypeFileReferences,
  [
    harden,
    {
      allowedLinkPrefixes: ['*']
    }
  ]
] satisfies StreamdownProps['rehypePlugins']

const components = {
  code: StreamdownCode,
  a: StreamdownLink
} satisfies StreamdownProps['components']

// KaTeX math via Streamdown's opt-in plugin. singleDollarTextMath:true so inline
// `$...$` renders too — the default only accepts block `$$...$$`, which alone
// leaves most model-emitted inline formulas as raw text. `\(...\)` / `\[...\]`
// are normalized to dollar syntax before rendering (remark-math ignores them).
// katex.min.css is imported at module top; without it formulas render scrambled.
const mathPlugin = createMathPlugin({ singleDollarTextMath: true })
const plugins = { math: mathPlugin } satisfies StreamdownProps['plugins']

type StreamdownLinkProps = ComponentPropsWithRef<'a'> & { node?: unknown }

function StreamdownLink({
  href,
  children,
  className,
  title
}: StreamdownLinkProps): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const fileTarget = parseFileReferenceHref(href)
  const validation = useValidatedFileReference(fileTarget, workspaceRoot)
  const isExternal = href ? /^(https?:|mailto:)/i.test(href) : false
  const cleanClassName = className?.replace(/\bds-file-reference-link\b/g, '').trim()

  if (fileTarget && validation.status !== 'valid') {
    return (
      <span className={cleanClassName} title={title}>
        {children}
      </span>
    )
  }

  const resolvedFileTarget =
    fileTarget && validation.status === 'valid'
      ? { ...fileTarget, path: validation.path }
      : null

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (resolvedFileTarget) {
      event.preventDefault()
      previewWorkspaceFile({ ...resolvedFileTarget, workspaceRoot })
      return
    }

    if (isExternal && href && typeof window.kunGui?.openExternal === 'function') {
      event.preventDefault()
      void window.kunGui.openExternal(href).catch(() => undefined)
    }
  }

  const handleDoubleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!resolvedFileTarget) return
    event.preventDefault()
    void openWorkspacePathInEditor(resolvedFileTarget, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open file reference', {
          message: result.message,
          target: resolvedFileTarget
        })?.catch(() => undefined)
      }
    })
  }

  return (
    <a
      href={href}
      title={title}
      className={[
        resolvedFileTarget ? 'ds-file-reference-link' : '',
        cleanClassName
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {children}
    </a>
  )
}

type Props = {
  /** Markdown source */
  text: string
  /**
   * When true (live SSE chunking), uses Streamdown `streaming` mode with a
   * char-level blur-in on newly appended content.
   */
  streaming: boolean
  className?: string
}

export function StreamdownAssistant({ text, streaming, className }: Props): ReactElement {
  const normalized = normalizeMathDelimiters(text)
  const pacedText = useTypewriterText(normalized, streaming)

  return (
    <AssistantStreamingContext.Provider value={streaming}>
      <Streamdown
        className={className}
        mode="static"
        parseIncompleteMarkdown={false}
        isAnimating={false}
        // The pacing hook above is the typewriter. Keep Streamdown's own
        // streaming/remend pipeline disabled here: in long Markdown responses
        // with GFM tables, its block repair path can leave stale text fragments
        // next to the repaired block, producing copied DOM text such as
        // "Work Workstreamstream".
        animated={false}
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        plugins={plugins}
        components={components}
      >
        {pacedText}
      </Streamdown>
    </AssistantStreamingContext.Provider>
  )
}
