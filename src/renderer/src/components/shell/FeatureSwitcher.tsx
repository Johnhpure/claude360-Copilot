import type { ReactElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Code2, Image, MessagesSquare, Music, PencilLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * FeatureSwitcher —— 一级功能入口（Code / 写作 / 生图 / 音乐 / 对话）唯一入口
 * （父任务 design §5 Pattern 层；阶段2 统一原 WorkspaceModeTabs + canvas/music
 * 手写分段两块分裂实现，样式全面 token 化，无字面量色）。
 *
 * 布局：纵向主导航（产品级侧栏重设计——单列 5 项，图标+文字，行高 48px）；
 * 选中态：accent 渐变背景 + 光晕阴影 + 白色文字，高亮明显；
 * 未选中：次级文字色，hover 轻背景提亮。行为与原实现一致（role=tablist/tab + aria-selected）。
 *
 * 「对话」（07-11 侧栏信息架构重构）：完整功能入口，复用 chat route 下的
 * conversation 线程链路，恒可见（不进 visible 灰度控制），排在最后。
 */
export type Feature = 'chat' | 'write' | 'canvas' | 'music' | 'conversation'

type FeatureSwitcherProps = {
  /** 当前激活的工作台；辅助路由（plugins/schedule/…）下传 null */
  active: Feature | null
  /** 生图/音乐入口可见性（跟随 isPrimaryRouteVisible 灰度）；Code/写作恒可见 */
  visible?: { canvas?: boolean; music?: boolean }
  onOpen: (feature: Feature) => void
}

const containerClass = 'mb-1.5 flex flex-col gap-1'

const tabClass = (active: boolean): string =>
  `group flex min-h-[48px] w-full min-w-0 items-center gap-3 rounded-[12px] px-3.5 text-[13.5px] outline-none transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ds-accent)_40%,transparent)] ${
    active
      ? 'bg-[image:var(--ds-accent-gradient)] font-medium text-white shadow-[var(--ds-accent-gradient-glow)]'
      : 'font-normal text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
  }`

const tabIconClass = (active: boolean): string =>
  `h-[17px] w-[17px] shrink-0 transition-colors duration-[var(--motion-fast)] ${
    active ? 'text-white' : 'text-ds-faint group-hover:text-ds-ink'
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
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={`${t('code')} / ${t('write')} / ${t('canvas')} / ${t('music')} / ${t('conversation')}`}
        className={containerClass}
      >
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
        {/* 对话：完整功能入口，恒可见（不进 visible 灰度控制）。 */}
        <FeatureTab
          spec={{ feature: 'conversation', icon: MessagesSquare, labelKey: 'conversation' }}
          active={active === 'conversation'}
          onOpen={onOpen}
        />
      </div>
    </div>
  )
}
