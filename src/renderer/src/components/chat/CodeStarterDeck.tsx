import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CODE_STARTER_CARDS, CODE_STARTER_TONE_CLASS } from './code-starter-deck'

/**
 * Code 首页空态的 8 张快捷开发任务卡（07-13-code-home-workbench R2/R3，
 * 取代旧孤儿组件 ChatStarterGrid）。
 *
 * 点击卡片把对应指令模板（i18n `starter*Prompt`）交给 onSelect——装配点
 * 沿既有 onSelectSuggestion 通道填充 composer 并聚焦、光标置末尾。
 * 网格 1/2/4 列自适应；≤640px 时 base-shell.css 既有的 ds-empty-hero-card
 * 容器查询接管卡片紧凑尺寸（min-h 92px / 单列）。
 */
export function CodeStarterDeck({
  onSelect
}: {
  onSelect: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="code-starter-deck"
    >
      {CODE_STARTER_CARDS.map((card) => {
        const Icon = card.icon
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(t(card.promptKey))}
            className="ds-empty-hero-card group flex min-h-[96px] items-center gap-3.5 rounded-[16px] border border-ds-border bg-ds-card px-4 py-3.5 text-left shadow-[var(--c360-shadow-sm)] transition duration-[var(--motion-base)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ds-accent)_18%,transparent)] hover:bg-ds-elevated"
          >
            <span
              className={`ds-empty-hero-card-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${CODE_STARTER_TONE_CLASS[card.tone]}`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="ds-empty-hero-card-title block truncate text-[14.5px] font-semibold tracking-[0] text-ds-ink">
                {t(card.titleKey)}
              </span>
              <span className="ds-empty-hero-card-sub mt-1 block truncate text-[12.5px] leading-[1.4] text-ds-faint">
                {t(card.subKey)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
