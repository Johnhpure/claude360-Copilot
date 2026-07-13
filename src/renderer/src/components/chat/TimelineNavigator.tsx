import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTree, X } from 'lucide-react'
import type { TurnNavItem } from './timeline-navigator'

type NavListProps = {
  items: TurnNavItem[]
  activeKey: string | null
  onNavigate: (item: TurnNavItem) => void
}

type Props = NavListProps

function TimelineNavList({ items, activeKey, onNavigate }: NavListProps): ReactElement {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the highlighted turn visible inside the navigator's own scroll area.
  useEffect(() => {
    if (!activeKey) return
    const active = listRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  return (
    <div ref={listRef} className="timeline-nav-list">
      {items.map((item) => {
        const active = item.key === activeKey
        return (
          <button
            key={item.key}
            type="button"
            className={`timeline-nav-item${active ? ' timeline-nav-item-active' : ''}`}
            data-active={active ? 'true' : undefined}
            aria-current={active ? 'true' : undefined}
            title={item.title}
            onClick={() => onNavigate(item)}
          >
            <span className="timeline-nav-item-index">{item.index + 1}</span>
            <span className="timeline-nav-item-title">{item.title}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Conversation navigator for the chat timeline. Renders as absolutely
 * positioned siblings of the scroll container inside the Workbench's
 * `relative` timeline wrapper (below the topbar, above the composer):
 *
 * - Docked panel — shown by CSS only when the `.ds-chat-stage` container
 *   is wide enough to host it beside the content column (`@container`
 *   query in base-shell.css), so the dock right panel / file tree opening
 *   automatically collapses it. No layout-prop plumbing needed.
 * - Floating entry button (narrow stages) — opens an overlay card;
 *   Esc / backdrop click / item click closes it.
 *
 * Callers should skip rendering entirely below 2 turns (no nav value).
 */
export function TimelineNavigator({ items, activeKey, onNavigate }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [overlayOpen, setOverlayOpen] = useState(false)

  useEffect(() => {
    if (!overlayOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOverlayOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen])

  const navigate = (item: TurnNavItem): void => {
    setOverlayOpen(false)
    onNavigate(item)
  }

  return (
    <>
      <nav className="timeline-navigator ds-no-drag" aria-label={t('timelineNavLabel')}>
        <div className="timeline-nav-header">{t('timelineNavLabel')}</div>
        <TimelineNavList items={items} activeKey={activeKey} onNavigate={navigate} />
      </nav>

      {overlayOpen ? null : (
        <button
          type="button"
          className="timeline-nav-fab ds-no-drag"
          aria-label={t('timelineNavExpand')}
          title={t('timelineNavExpand')}
          onClick={() => setOverlayOpen(true)}
        >
          <ListTree className="h-4 w-4" strokeWidth={1.85} />
        </button>
      )}

      {overlayOpen ? (
        <div className="timeline-nav-overlay-root ds-no-drag">
          <button
            type="button"
            className="timeline-nav-overlay-backdrop"
            aria-label={t('timelineNavCollapse')}
            onClick={() => setOverlayOpen(false)}
          />
          <div
            className="timeline-nav-overlay-card"
            role="dialog"
            aria-label={t('timelineNavLabel')}
          >
            <div className="timeline-nav-header timeline-nav-overlay-header">
              <span>{t('timelineNavLabel')}</span>
              <button
                type="button"
                className="timeline-nav-overlay-close"
                aria-label={t('timelineNavCollapse')}
                title={t('timelineNavCollapse')}
                onClick={() => setOverlayOpen(false)}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            </div>
            <TimelineNavList items={items} activeKey={activeKey} onNavigate={navigate} />
          </div>
        </div>
      ) : null}
    </>
  )
}
