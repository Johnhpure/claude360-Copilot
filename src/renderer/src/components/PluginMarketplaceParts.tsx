import type { ReactElement, ReactNode } from 'react'

export type MarketplaceNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
}

export function TabButton({
  active,
  tone = 'default',
  onClick,
  children
}: {
  active: boolean
  tone?: 'default' | 'skill'
  onClick: () => void
  children: ReactNode
}): ReactElement {
  const activeClass =
    tone === 'skill'
      ? 'bg-ds-skill-soft text-ds-skill shadow-[var(--c360-shadow-sm)]'
      : 'bg-ds-card text-ds-ink shadow-[var(--c360-shadow-sm)]'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-[15px] font-semibold transition-colors duration-[var(--motion-fast)] ${
        active ? activeClass : 'text-ds-muted hover:text-ds-ink'
      }`}
    >
      {children}
    </button>
  )
}


export function NoticeView({ notice }: { notice: MarketplaceNotice }): ReactElement {
  /* 功能色 chip：色相走 token（--c360-success/error），soft 底 + color-mix 边框，小面积原则 */
  const className =
    notice.tone === 'error'
      ? 'border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft text-ds-danger'
      : notice.tone === 'success'
        ? 'border-[color-mix(in_srgb,var(--ds-success)_35%,transparent)] bg-ds-success-soft text-ds-success'
        : 'border-ds-border bg-ds-subtle text-ds-muted'
  return (
    <div className={`mt-4 rounded-[var(--radius-md)] border px-3 py-2 text-[13px] leading-5 ${className}`}>
      {notice.message}
    </div>
  )
}
