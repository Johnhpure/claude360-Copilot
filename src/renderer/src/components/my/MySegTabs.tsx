import type { ReactElement } from 'react'

// 「我的」页分段胶囊 Tab（07-17 my-newapi-call-logs design §5.1,方案 B）。
// 仅本页使用,不入 ui/ 原语库——单点使用不做过早抽象;样式对照确认稿 .seg-tabs:
// pill 容器 + surface 底,选中项 = accent-soft 底 + accent 字 + 加粗。
// role=tablist/tab + aria-selected 供无障碍与测试断言。

type SegTab<K extends string> = {
  key: K
  label: string
}

type Props<K extends string> = {
  tabs: ReadonlyArray<SegTab<K>>
  active: K
  onChange: (key: K) => void
  /** tablist 的无障碍名称。 */
  ariaLabel: string
}

export function MySegTabs<K extends string>({
  tabs,
  active,
  onChange,
  ariaLabel
}: Props<K>): ReactElement {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex gap-1 self-start rounded-[var(--radius-pill)] border border-ds-border bg-ds-card p-1"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`my-tab-${tab.key}`}
            onClick={() => onChange(tab.key)}
            className={`rounded-[var(--radius-pill)] px-4 py-1.5 text-[12.5px] transition-colors duration-[var(--motion-fast)] ${
              selected
                ? 'bg-accent-soft font-semibold text-accent'
                : 'font-medium text-ds-muted hover:text-ds-ink'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
