import type { ReactElement } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Cap on how many characters of a tool detail enter the DOM by default
 * (07-14-timeline-performance R5). `max-h-72 overflow-auto` only clips
 * visually — without this cap a multi-MB command output still creates the
 * full text node and pays layout for it on every expand.
 */
export const TOOL_DETAIL_MAX_CHARS = 10_000

export function splitToolDetailText(text: string): { visible: string; hiddenChars: number } {
  if (text.length <= TOOL_DETAIL_MAX_CHARS) return { visible: text, hiddenChars: 0 }
  return {
    visible: text.slice(0, TOOL_DETAIL_MAX_CHARS),
    hiddenChars: text.length - TOOL_DETAIL_MAX_CHARS
  }
}

/**
 * Renders plain tool detail text, truncated to `TOOL_DETAIL_MAX_CHARS` with a
 * "show all" button. Intended to sit inside the existing `<pre>` wrappers so
 * collapsed-row layout and scroll behavior stay unchanged.
 */
export function TruncatedDetailText({ text }: { text: string }): ReactElement {
  const { t } = useTranslation('common')
  const [showAll, setShowAll] = useState(false)
  const { visible, hiddenChars } = splitToolDetailText(text)

  if (hiddenChars === 0 || showAll) return <>{text}</>

  return (
    <>
      {visible}
      {'\n'}
      <button
        type="button"
        className="mt-1 inline-flex items-center rounded-md border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        onClick={(event) => {
          // Detail rows toggle open/closed on click — expanding the text must
          // not collapse the row it lives in.
          event.stopPropagation()
          setShowAll(true)
        }}
      >
        {t('toolDetailShowAll', { count: hiddenChars })}
      </button>
    </>
  )
}
