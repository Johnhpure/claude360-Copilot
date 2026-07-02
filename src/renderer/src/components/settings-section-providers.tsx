import type { ReactElement } from 'react'
import { GroupsKeysSection } from './settings-section-groups-keys'

// Claude360 二开：软件只调用 Claude360，模型/分组/倍率/Key 全部由 Claude360 账号
// 按套餐下发，统一在「设置 → 分组及Key」(GroupsKeysSection) 展示与管理。
// 旧的手动供应商配置（新增/编辑/删除供应商、自定义 BaseURL / Provider API Key、
// 第三方 provider 分支）已从调用链路整体移除；底层 ModelProviderProfileV1 等
// 内部抽象保留，但 profile 只由 Claude360 登录态自动生成。
export function ProvidersSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  return <GroupsKeysSection t={ctx.t} />
}
