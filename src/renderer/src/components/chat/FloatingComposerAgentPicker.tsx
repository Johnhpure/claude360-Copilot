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
import { Bot, Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  builtinAssistants,
  displayNameForAssistantId
} from '../../features/assistants'
import { useChatStore } from '../../store/chat-store'
import { calculateExecutionMenuPlacement } from './FloatingComposerExecutionPicker'

type Props = {
  /** When true, render only the icon (accessible name keeps the full label). */
  compact?: boolean
  /** Extra disable from the host surface. */
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
 * 人设助手菜单：首项「不使用助手」（默认态），其后为内置人设目录。
 * 人设助手与设置中的 AI 助手（subagent profiles）无关，菜单不含自定义
 * profile，也没有管理入口。
 */
export function buildAssistantMenuItems(
  translate: (key: string) => string
): { none: AssistantMenuItem; builtins: AssistantMenuItem[] } {
  return {
    none: {
      id: '',
      name: translate('assistantNone'),
      description: translate('assistantNoneDescription')
    },
    builtins: builtinAssistants.map((definition) => ({
      id: definition.id,
      name: translate(definition.nameKey),
      description: translate(definition.descriptionKey)
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
 * Store-connected persona assistant picker: displays the current
 * `personaAssistantId` (never derived from thread fields) and delegates
 * selection to the `selectAssistant` store action. Switching is a pure
 * local state change, so it is never gated on runtime/busy state.
 */
export function FloatingComposerAgentPicker({ compact = false, disabled }: Props): ReactElement {
  const personaAssistantId = useChatStore((s) => s.personaAssistantId)
  const selectAssistant = useChatStore((s) => s.selectAssistant)

  return (
    <AgentPickerView
      compact={compact}
      disabled={disabled}
      displayAgentId={personaAssistantId}
      onSelect={(selectionId) => { void selectAssistant(selectionId) }}
    />
  )
}

export function AgentPickerView({
  compact = false,
  disabled,
  displayAgentId,
  onSelect
}: {
  compact?: boolean
  disabled?: boolean
  displayAgentId: string
  onSelect: (selectionId: string) => void
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
  }, [open, updateMenuPosition])

  const displayName = displayNameForAssistantId(displayAgentId, t)
  const accessibleName = `${t('assistantPickerLabel')}: ${displayName}`

  const items = buildAssistantMenuItems(t)

  const closeMenu = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const handleSelect = (selectionId: string): void => {
    onSelect(selectionId)
    closeMenu(true)
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
        item={items.none}
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
    </div>
  ) : null

  return (
    <>
      <div ref={rootRef} className="ds-no-drag relative inline-flex shrink-0 items-center">
        <button
          ref={buttonRef}
          type="button"
          disabled={Boolean(disabled)}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault()
              closeMenu()
            }
          }}
          className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-0.5 text-[12.5px] font-semibold text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
          title={accessibleName}
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
