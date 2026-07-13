import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { StarterCard } from './code-starter-deck'
import { CODE_STARTER_CARDS, CODE_STARTER_TONE_CLASS } from './code-starter-deck'
import { CONVERSATION_STARTER_CARDS } from './conversation-starter-deck'

/**
 * 首页空态快捷任务卡通用渲染件（07-13-code-home-polish Step 1 由 Code 版泛化，
 * Code 开发工作台与「对话」通用首页共用）。
 *
 * 点击卡片把对应指令模板（i18n `*Prompt`）交给 onSelect——装配点沿既有
 * onSelectSuggestion 通道填充 composer 并聚焦、光标置末尾。
 * 网格 2 列自适应封顶（桌面端 minWidth 960 下实际恒 2 列，grid-cols-1 仅为
 * 窄容器防御）：4 列在 63rem 内容列封顶下文本可用宽仅 ~131px 必然截断；
 * 标题/副文案自然换行不省略。≤640px 时 base-shell.css 既有的
 * ds-empty-hero-card 容器查询继续接管紧凑尺寸。
 */
function StarterDeck({
  cards,
  testId,
  onSelect
}: {
  cards: readonly StarterCard[]
  testId: string
  onSelect: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2" data-testid={testId}>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(t(card.promptKey))}
            className="ds-empty-hero-card group flex min-h-[72px] items-start gap-3.5 rounded-[16px] border border-ds-border bg-ds-card px-4 py-3.5 text-left shadow-[var(--c360-shadow-sm)] transition duration-[var(--motion-base)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ds-accent)_18%,transparent)] hover:bg-ds-elevated"
          >
            <span
              className={`ds-empty-hero-card-icon mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${CODE_STARTER_TONE_CLASS[card.tone]}`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="ds-empty-hero-card-title block break-words text-[14.5px] font-semibold tracking-[0] text-ds-ink">
                {t(card.titleKey)}
              </span>
              <span className="ds-empty-hero-card-sub mt-1 block break-words text-[12.5px] leading-[1.4] text-ds-faint">
                {t(card.subKey)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Code 首页空态的 8 张开发任务卡（testid 与既有测试锁定保持不变）。 */
export function CodeStarterDeck({
  onSelect
}: {
  onSelect: (prompt: string) => void
}): ReactElement {
  return <StarterDeck cards={CODE_STARTER_CARDS} testId="code-starter-deck" onSelect={onSelect} />
}

/** 「对话」通用 AI 首页的 8 张通用任务卡（07-13-code-home-polish R3）。 */
export function ConversationStarterDeck({
  onSelect
}: {
  onSelect: (prompt: string) => void
}): ReactElement {
  return (
    <StarterDeck
      cards={CONVERSATION_STARTER_CARDS}
      testId="conversation-starter-deck"
      onSelect={onSelect}
    />
  )
}
