import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SidebarCommandRow, SidebarDivider, SidebarSectionHeader } from './SidebarPrimitives'

/**
 * SidebarContextActions —— 侧栏「当前操作」区（区3，07-11 信息架构重构 design D2）。
 *
 * 承载当前激活功能的二级操作（新建会话/新建需求/新建写作/新建生图任务…），
 * 与一级功能入口（FeatureSwitcher）通过顶部分隔线 + 小标题做视觉隔离；
 * 按钮沿用 SidebarCommandRow（accent 仅主操作一枚，其余默认弱样式），
 * 天然比一级入口的 48px 渐变行弱一级。chat / write 两个侧栏复用本组件。
 */
export type SidebarContextAction = {
  icon: ReactElement
  label: string
  onClick?: () => void
  disabled?: boolean
  disabledHint?: string
  /** 主操作（accent CTA 样式）；每组建议至多一枚。 */
  accent?: boolean
}

type SidebarContextActionsProps = {
  /** 区块小标题；缺省用 t('currentActions')。 */
  title?: string
  actions: SidebarContextAction[]
}

export function SidebarContextActions({
  title,
  actions
}: SidebarContextActionsProps): ReactElement | null {
  const { t } = useTranslation('common')
  if (actions.length === 0) return null
  return (
    <div className="ds-no-drag flex flex-col">
      <SidebarDivider className="mt-1.5" />
      <SidebarSectionHeader label={title ?? t('currentActions')} />
      {actions.map((action) => (
        <SidebarCommandRow
          key={action.label}
          icon={action.icon}
          label={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          disabledHint={action.disabledHint}
          variant={action.accent ? 'accent' : 'flat'}
        />
      ))}
    </div>
  )
}
