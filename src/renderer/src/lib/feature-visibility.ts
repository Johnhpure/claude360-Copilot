import type { AppRoute } from '../store/chat-store-types'

/**
 * 第一阶段(Claude360 Copilot 首发)在主 UI 暴露的可见主路由集合。
 *
 * 集中定义,供 Sidebar / Settings 等处复用,避免各处硬编码一套隐藏逻辑。
 * 隐藏 ≠ 删除:被排除的旧路由(plugins/claw/schedule/workflow)仍保留在
 * `AppRoute` 类型与底层 store 动作/handler 中,只是不从主入口暴露,便于二期恢复。
 *
 * - chat:   对话 / Code
 * - write:  写作工作台
 * - my:     我的(账号/密钥/额度)
 * - canvas: 生图工作台(plan-06 交付页面)
 * - music:  音乐工作台(plan-05 交付页面)
 *
 * `settings` 不在本集合内:它由页面底部固定入口进入,不属于「主入口」门控范围。
 */
export const PRIMARY_VISIBLE_ROUTES = ['chat', 'write', 'my', 'canvas', 'music'] as const

export type PrimaryVisibleRoute = (typeof PRIMARY_VISIBLE_ROUTES)[number]

const VISIBLE_ROUTE_SET: ReadonlySet<AppRoute> = new Set(PRIMARY_VISIBLE_ROUTES)

/**
 * 判断某主路由在第一阶段是否应从主 UI 暴露。
 * 用于 Sidebar 主入口区与 Settings 导航项的条件渲染门控。
 */
export function isPrimaryRouteVisible(route: AppRoute): boolean {
  return VISIBLE_ROUTE_SET.has(route)
}
