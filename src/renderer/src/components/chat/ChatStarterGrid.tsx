import type { ReactElement } from 'react'
import { Bug, FolderOpen, Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type SuggestionTone = 'blue' | 'emerald' | 'violet'

const SUGGESTION_TONE: Record<SuggestionTone, string> = {
  blue: 'bg-accent-soft text-accent',
  emerald: 'bg-ds-success-soft text-ds-success',
  violet: 'bg-ds-skill-soft text-ds-skill'
}

const CHAT_STARTERS: Array<{
  icon: ReactElement
  tone: SuggestionTone
  titleKey: string
  subKey: string
  promptKey: string
}> = [
  {
    icon: <FolderOpen className="h-4 w-4" strokeWidth={1.8} />,
    tone: 'blue',
    titleKey: 'promptStructureTitle',
    subKey: 'promptStructureSub',
    promptKey: 'promptStructurePrompt'
  },
  {
    icon: <Bug className="h-4 w-4" strokeWidth={1.8} />,
    tone: 'emerald',
    titleKey: 'promptBugTitle',
    subKey: 'promptBugSub',
    promptKey: 'promptBugPrompt'
  },
  {
    icon: <Lightbulb className="h-4 w-4" strokeWidth={1.8} />,
    tone: 'violet',
    titleKey: 'promptPlanTitle',
    subKey: 'promptPlanSub',
    promptKey: 'promptPlanPrompt'
  }
]

export function ChatStarterGrid({
  onSelectSuggestion,
  compact = false
}: {
  onSelectSuggestion?: (prompt: string) => void
  compact?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className={`${compact ? 'mt-5' : 'mt-12'} grid w-full gap-3 sm:grid-cols-2 ${compact ? 'max-w-none' : 'ds-chat-content-max-width'}`}>
      {CHAT_STARTERS.map((starter) => (
        <button
          key={starter.titleKey}
          type="button"
          onClick={() => onSelectSuggestion?.(t(starter.promptKey))}
          className={`ds-empty-hero-card group flex min-h-[112px] items-center gap-4 rounded-[16px] border border-ds-border bg-ds-card px-5 py-4 text-left shadow-[var(--c360-shadow-sm)] transition duration-[var(--motion-base)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ds-accent)_18%,transparent)] hover:bg-ds-elevated ${compact ? 'min-h-[92px]' : ''}`}
        >
          <span
            className={`ds-empty-hero-card-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${SUGGESTION_TONE[starter.tone]}`}
          >
            {starter.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="ds-empty-hero-card-title block truncate text-[16px] font-semibold tracking-[0] text-ds-ink">
              {t(starter.titleKey)}
            </span>
            <span className="ds-empty-hero-card-sub mt-1 block text-[13.5px] leading-5 text-ds-faint">
              {t(starter.subKey)}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
