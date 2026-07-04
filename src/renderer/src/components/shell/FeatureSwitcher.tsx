import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Code2, Image, Music, PencilLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * FeatureSwitcher —— 四工作台切换（Code / 写作 / 生图 / 音乐）唯一入口
 * （父任务 design §5 Pattern 层；阶段2 统一原 WorkspaceModeTabs + canvas/music
 * 手写分段两块分裂实现，样式全面 token 化，无字面量色）。
 *
 * 布局：两行分段（Code/写作、生图/音乐），保持侧栏 240px 下的信息密度；
 * 选中态：surface-elevated 白卡浮起（亮）/ 提亮一档（暗）+ 主文字色；
 * 未选中：次级文字色，hover 提亮。行为与原实现一致（role=tablist/tab + aria-selected）。
 */
export type Feature = 'chat' | 'write' | 'canvas' | 'music'

type FeatureSwitcherProps = {
  /** 当前激活的工作台；辅助路由（plugins/schedule/…）下传 null */
  active: Feature | null
  /** 生图/音乐入口可见性（跟随 isPrimaryRouteVisible 灰度）；Code/写作恒可见 */
  visible?: { canvas?: boolean; music?: boolean }
  onOpen: (feature: Feature) => void
}

const containerClass =
  'mb-1.5 flex flex-row gap-1 rounded-[var(--radius-sm)] bg-[color-mix(in_srgb,var(--ds-sidebar-field-bg)_72%,transparent)] p-0.5 shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]'

const tabClass = (active: boolean): string =>
  `group inline-flex min-h-[28px] flex-1 min-w-0 items-center justify-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] px-2 py-0.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ds-accent)_40%,transparent)] ${
    active
      ? 'bg-ds-elevated font-medium text-ds-ink shadow-sm'
      : 'font-normal text-ds-muted hover:text-ds-ink'
  }`

const tabIconClass = (active: boolean): string =>
  `h-[15px] w-[15px] shrink-0 transition-colors duration-[var(--motion-fast)] ${
    active ? 'text-ds-ink' : 'text-ds-faint group-hover:text-ds-ink'
  }`

type TabSpec = {
  feature: Feature
  icon: LucideIcon
  labelKey: string
}

function FeatureTab({
  spec,
  active,
  onOpen
}: {
  spec: TabSpec
  active: boolean
  onOpen: (feature: Feature) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      role="tab"
      aria-selected={active}
      onClick={() => onOpen(spec.feature)}
      className={tabClass(active)}
    >
      <spec.icon className={tabIconClass(active)} strokeWidth={1.9} />
      <span className="truncate">{t(spec.labelKey)}</span>
    </button>
  )
}

export function FeatureSwitcher({
  active,
  visible,
  onOpen
}: FeatureSwitcherProps): ReactElement {
  const { t } = useTranslation('common')
  const showCanvas = visible?.canvas ?? true
  const showMusic = visible?.music ?? true

  return (
    <div data-testid="feature-switcher" className="flex flex-col">
      <div role="tablist" aria-label={`${t('code')} / ${t('write')}`} className={containerClass}>
        <FeatureTab
          spec={{ feature: 'chat', icon: Code2, labelKey: 'code' }}
          active={active === 'chat'}
          onOpen={onOpen}
        />
        <FeatureTab
          spec={{ feature: 'write', icon: PencilLine, labelKey: 'write' }}
          active={active === 'write'}
          onOpen={onOpen}
        />
      </div>
      {showCanvas || showMusic ? (
        <div
          role="tablist"
          aria-label={`${t('canvas')} / ${t('music')}`}
          className={containerClass}
        >
          {showCanvas ? (
            <FeatureTab
              spec={{ feature: 'canvas', icon: Image, labelKey: 'canvas' }}
              active={active === 'canvas'}
              onOpen={onOpen}
            />
          ) : null}
          {showMusic ? (
            <FeatureTab
              spec={{ feature: 'music', icon: Music, labelKey: 'music' }}
              active={active === 'music'}
              onOpen={onOpen}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
