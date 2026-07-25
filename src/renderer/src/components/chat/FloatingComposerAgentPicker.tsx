import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronDown, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunSubagentProfileV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import {
  builtinAssistants,
  displayNameForAssistantId,
  isCustomAssistantEligible
} from '../../features/assistants'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { calculateExecutionMenuPlacement } from './FloatingComposerExecutionPicker'

type Props = {
  /** When true, render only the icon (accessible name keeps the full label). */
  compact?: boolean
  /** Extra disable from the host surface (the picker also self-gates on busy/pending). */
  disabled?: boolean
}

const ASSISTANT_MENU_WIDTH = 288
const ASSISTANT_MENU_ESTIMATED_HEIGHT = 420

type AssistantMenuItem = {
  id: string
  name: string
  description: string
}

/**
 * Build the selectable menu entries: general first, then the builtin catalog,
 * then eligible custom primary profiles ("my assistants"). Uses the same
 * eligibility rule as the resolver so the menu never offers a selection the
 * resolver would reject.
 */
export function buildAssistantMenuItems(
  profiles: readonly KunSubagentProfileV1[],
  translate: (key: string) => string
): { general: AssistantMenuItem; builtins: AssistantMenuItem[]; customs: AssistantMenuItem[] } {
  return {
    general: {
      id: '',
      name: translate('assistantNameGeneral'),
      description: translate('assistantGeneralDescription')
    },
    builtins: builtinAssistants.map((definition) => ({
      id: definition.id,
      name: translate(definition.nameKey),
      description: translate(definition.descriptionKey)
    })),
    customs: profiles.filter(isCustomAssistantEligible).map((profile) => ({
      id: profile.id,
      name: profile.name.trim() || profile.id,
      description: profile.description?.trim() ?? ''
    }))
  }
}

/**
 * Roving-focus target for menu keyboard navigation. Returns the next index
 * for ArrowUp/ArrowDown (wrapping), Home/End, or null for unhandled keys.
 */
export function nextAssistantMenuFocusIndex(
  key: string,
  currentIndex: number,
  count: number
): number | null {
  if (count <= 0) return null
  if (key === 'ArrowDown') return (currentIndex + 1 + count) % count
  if (key === 'ArrowUp') return (currentIndex - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * Store-connected assistant picker: derives the display identity from the
 * active thread (falling back to the pending composer selection), gates
 * switching on busy/pending runtime work, and delegates all decisions to the
 * `selectAssistant` store action. Rendering lives in {@link AgentPickerView}.
 */
export function FloatingComposerAgentPicker({ compact = false, disabled }: Props): ReactElement {
  const composerAgentId = useChatStore((s) => s.composerAgentId)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const busy = useChatStore((s) => s.busy)
  const hasPendingWork = useChatStore((s) => threadHasPendingRuntimeWork(s.blocks))
  const selectAssistant = useChatStore((s) => s.selectAssistant)
  const openSettings = useChatStore((s) => s.openSettings)
  const [profiles, setProfiles] = useState<KunSubagentProfileV1[]>([])
  const [profilesError, setProfilesError] = useState(false)
  const loadedRef = useRef(false)

  const loadProfiles = useCallback(async (force = false): Promise<void> => {
    try {
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: force })
      setProfiles(settings.agents?.kun?.subagents?.profiles ?? [])
      setProfilesError(false)
      loadedRef.current = true
    } catch {
      // Builtins and the general assistant stay available; only the "my
      // assistants" section degrades to an explicit retryable error state.
      setProfilesError(true)
    }
  }, [])

  useEffect(() => { void loadProfiles() }, [loadProfiles])

  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId) ?? null
    : null
  // Identity truth: the active thread's create-time agentId; the pending
  // composer selection only stands in while no thread is active (req. 3.4).
  const displayAgentId = activeThread ? activeThread.agentId?.trim() ?? '' : composerAgentId

  return (
    <AgentPickerView
      compact={compact}
      disabled={disabled}
      displayAgentId={displayAgentId}
      profiles={profiles}
      profilesError={profilesError}
      busy={busy}
      hasPendingWork={hasPendingWork}
      onSelect={(selectionId) => { void selectAssistant(selectionId) }}
      onManage={() => openSettings('agents')}
      onRetryProfiles={() => { void loadProfiles(true) }}
      onMenuOpened={() => {
        // Reload when the menu opens so edits made in the agents settings view
        // mid-session show immediately instead of waiting out the settings cache.
        if (loadedRef.current) void loadProfiles(true)
      }}
    />
  )
}

export function AgentPickerView({
  compact = false,
  disabled,
  displayAgentId,
  profiles,
  profilesError,
  busy,
  hasPendingWork,
  onSelect,
  onManage,
  onRetryProfiles,
  onMenuOpened
}: {
  compact?: boolean
  disabled?: boolean
  displayAgentId: string
  profiles: readonly KunSubagentProfileV1[]
  profilesError: boolean
  busy: boolean
  hasPendingWork: boolean
  onSelect: (selectionId: string) => void
  onManage: () => void
  onRetryProfiles: () => void
  onMenuOpened?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const updateMenuPosition = useCallback((): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuStyle(calculateExecutionMenuPlacement({
      anchorRect: rect,
      menuWidth: ASSISTANT_MENU_WIDTH,
      menuHeight: menuRef.current?.offsetHeight ?? ASSISTANT_MENU_ESTIMATED_HEIGHT,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      coordinateScale: currentBodyZoom()
    }))
  }, [])

  useEffect(() => {
    if (!open) return
    onMenuOpened?.()
    updateMenuPosition()
    const frame = window.requestAnimationFrame(() => {
      updateMenuPosition()
      const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ;(selected ?? menuRef.current?.querySelector<HTMLButtonElement>('button'))?.focus()
    })
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onUpdatePosition = (): void => updateMenuPosition()
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onUpdatePosition)
    window.addEventListener('scroll', onUpdatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onUpdatePosition)
      window.removeEventListener('scroll', onUpdatePosition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMenuOpened is a fire-on-open notification, not a reactive dependency
  }, [open, updateMenuPosition])

  const displayName = displayNameForAssistantId(displayAgentId, profiles, t)
  const switchBlockedReason = busy
    ? t('assistantSwitchBlockedBusy')
    : hasPendingWork
      ? t('assistantSwitchBlockedPending')
      : ''
  const buttonDisabled = Boolean(disabled) || Boolean(switchBlockedReason)
  const accessibleName = `${t('assistantPickerLabel')}: ${displayName}`
  const buttonTitle = switchBlockedReason || accessibleName

  const items = buildAssistantMenuItems(profiles, t)

  const closeMenu = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const handleSelect = (selectionId: string): void => {
    // The store action owns validation, thread creation, and failure
    // handling; the menu just closes and lets global error state surface.
    onSelect(selectionId)
    closeMenu(true)
  }

  const handleManage = (): void => {
    onManage()
    closeMenu()
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
    )
    if (buttons.length === 0) return
    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    const nextIndex = nextAssistantMenuFocusIndex(event.key, currentIndex, buttons.length)
    if (nextIndex !== null) {
      event.preventDefault()
      buttons[nextIndex]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
    } else if (event.key === 'Tab') {
      closeMenu()
    }
  }

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('assistantPickerLabel')}
      style={menuStyle}
      onKeyDown={handleMenuKeyDown}
      className="fixed z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-ds-border bg-ds-elevated p-2 text-[13px] text-ds-ink shadow-[var(--c360-shadow-overlay)]"
    >
      <AssistantRow
        item={items.general}
        selected={displayAgentId === ''}
        onClick={() => handleSelect('')}
      />
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ds-faint">
        {t('assistantBuiltinGroup')}
      </div>
      {items.builtins.map((item) => (
        <AssistantRow
          key={item.id}
          item={item}
          selected={displayAgentId === item.id}
          onClick={() => handleSelect(item.id)}
        />
      ))}
      {items.customs.length > 0 || profilesError ? (
        <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ds-faint">
          {t('assistantMyGroup')}
        </div>
      ) : null}
      {profilesError ? (
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <span className="min-w-0 flex-1 text-[12px] text-ds-danger">
            {t('assistantMyGroupLoadFailed')}
          </span>
          <button
            type="button"
            onClick={onRetryProfiles}
            className="shrink-0 rounded-lg border border-ds-border px-2 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('assistantMyGroupRetry')}
          </button>
        </div>
      ) : (
        items.customs.map((item) => (
          <AssistantRow
            key={item.id}
            item={item}
            selected={displayAgentId === item.id}
            onClick={() => handleSelect(item.id)}
          />
        ))
      )}
      <div className="mt-1 border-t border-ds-border pt-1">
        <button
          type="button"
          role="menuitem"
          onClick={handleManage}
          className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate">{t('assistantManageMy')}</span>
        </button>
      </div>
    </div>
  ) : null

  return (
    <>
      <div ref={rootRef} className="ds-no-drag relative inline-flex shrink-0 items-center">
        <button
          ref={buttonRef}
          type="button"
          disabled={buttonDisabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault()
              closeMenu()
            }
          }}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-0.5 text-[12.5px] font-semibold text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
          title={buttonTitle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={accessibleName}
        >
          <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          {!compact ? <span className="max-w-[132px] truncate">{displayName}</span> : null}
          <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}

function AssistantRow({
  item,
  selected,
  onClick
}: {
  item: AssistantMenuItem
  selected: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      title={item.name}
      onClick={onClick}
      className={`flex w-full cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 text-left text-ds-ink transition ${
        selected ? 'bg-ds-hover' : 'hover:bg-ds-hover'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.name}</span>
        {item.description ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-ds-muted">{item.description}</span>
        ) : null}
      </span>
      {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} /> : null}
    </button>
  )
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const zoom = window.getComputedStyle(document.body).zoom
  const parsed = Number.parseFloat(zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
