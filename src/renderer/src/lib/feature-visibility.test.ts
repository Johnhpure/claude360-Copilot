import { describe, expect, it } from 'vitest'
import type { AppRoute } from '../store/chat-store-types'
import {
  PRIMARY_VISIBLE_ROUTES,
  isPrimaryRouteVisible
} from './feature-visibility'

describe('feature-visibility 第一阶段可见性策略', () => {
  it('隐藏第一阶段不交付的入口:plugins/claw/schedule/workflow', () => {
    expect(isPrimaryRouteVisible('plugins')).toBe(false)
    expect(isPrimaryRouteVisible('claw')).toBe(false)
    expect(isPrimaryRouteVisible('schedule')).toBe(false)
    expect(isPrimaryRouteVisible('workflow')).toBe(false)
  })

  it('保留第一阶段可见入口:chat/write/my/canvas/music', () => {
    expect(isPrimaryRouteVisible('chat')).toBe(true)
    expect(isPrimaryRouteVisible('write')).toBe(true)
    expect(isPrimaryRouteVisible('my')).toBe(true)
    expect(isPrimaryRouteVisible('canvas')).toBe(true)
    expect(isPrimaryRouteVisible('music')).toBe(true)
  })

  it('可见集合常量与断言函数一致(集中定义,避免各处硬编码)', () => {
    for (const route of PRIMARY_VISIBLE_ROUTES) {
      expect(isPrimaryRouteVisible(route)).toBe(true)
    }
    const hidden: AppRoute[] = ['plugins', 'claw', 'schedule', 'workflow']
    for (const route of hidden) {
      expect(PRIMARY_VISIBLE_ROUTES).not.toContain(route)
    }
  })
})
