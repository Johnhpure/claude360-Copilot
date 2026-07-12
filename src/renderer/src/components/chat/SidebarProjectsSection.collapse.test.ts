import { describe, expect, it } from 'vitest'
import {
  planSidebarGroupAutoExpansion,
  sidebarGroupPathForWorkspace
} from './SidebarProjectsSection'

/* 覆盖 07-12「项目分组默认折叠返工」的核心判定：冷启动时 threads/workspaceRoots
   异步加载，displayGroups 首轮为空、次轮才有数据——空快照绝不能建档，否则全部
   分组被误判为新增而全量自动展开（生产环境默认折叠失效的根因）。 */
describe('planSidebarGroupAutoExpansion', () => {
  it('冷启动异步数据（首轮空 → 次轮多分组）：空快照不建档，首个非空快照只建档不展开', () => {
    // 首轮挂载：数据未到，displayGroups 为空 → 不建档（nextKnownGroupKeys 保持 null）。
    const first = planSidebarGroupAutoExpansion({ knownGroupKeys: null, groupPaths: [] })
    expect(first.nextKnownGroupKeys).toBeNull()
    expect(first.autoExpandPaths).toEqual([])

    // 次轮：异步数据到达，多分组一次性出现 → 建档但全部保持折叠（AC1）。
    const second = planSidebarGroupAutoExpansion({
      knownGroupKeys: first.nextKnownGroupKeys,
      groupPaths: ['/Users/zxy/project-a', '/Users/zxy/project-b', '/Users/zxy/project-c']
    })
    expect(second.autoExpandPaths).toEqual([])
    expect([...(second.nextKnownGroupKeys ?? [])]).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b',
      '/Users/zxy/project-c'
    ])
  })

  it('建档后新增一个分组：仅该分组定向展开（AC2）', () => {
    const established = planSidebarGroupAutoExpansion({
      knownGroupKeys: null,
      groupPaths: ['/Users/zxy/project-a', '/Users/zxy/project-b']
    })
    const next = planSidebarGroupAutoExpansion({
      knownGroupKeys: established.nextKnownGroupKeys,
      groupPaths: ['/Users/zxy/project-a', '/Users/zxy/project-b', '/Users/zxy/project-new']
    })
    expect(next.autoExpandPaths).toEqual(['/Users/zxy/project-new'])
    expect(next.nextKnownGroupKeys?.has('/Users/zxy/project-new')).toBe(true)
  })

  it('已知 key 只增不减：搜索过滤导致分组消失又出现不算新增', () => {
    const established = planSidebarGroupAutoExpansion({
      knownGroupKeys: null,
      groupPaths: ['/Users/zxy/project-a', '/Users/zxy/project-b']
    })
    // 搜索过滤后只剩一个分组：known 不缩水（复用原集合），也不展开。
    const filtered = planSidebarGroupAutoExpansion({
      knownGroupKeys: established.nextKnownGroupKeys,
      groupPaths: ['/Users/zxy/project-a']
    })
    expect(filtered.autoExpandPaths).toEqual([])
    expect(filtered.nextKnownGroupKeys).toBe(established.nextKnownGroupKeys)
    // 清空搜索后分组恢复：不得被误判为新增而自动展开。
    const restored = planSidebarGroupAutoExpansion({
      knownGroupKeys: filtered.nextKnownGroupKeys,
      groupPaths: ['/Users/zxy/project-a', '/Users/zxy/project-b']
    })
    expect(restored.autoExpandPaths).toEqual([])
  })

  it('建档时刻的定向展开候选（添加项目兜底/活跃会话项目）只展开这一个分组', () => {
    const plan = planSidebarGroupAutoExpansion({
      knownGroupKeys: null,
      groupPaths: ['/Users/zxy/project-a', '/Users/zxy/project-b'],
      bootstrapExpandPath: '/Users/zxy/project-b'
    })
    expect(plan.autoExpandPaths).toEqual(['/Users/zxy/project-b'])
    expect(plan.nextKnownGroupKeys?.size).toBe(2)
  })

  it('定向展开候选不在快照内时不展开任何分组', () => {
    const plan = planSidebarGroupAutoExpansion({
      knownGroupKeys: null,
      groupPaths: ['/Users/zxy/project-a'],
      bootstrapExpandPath: '/Users/zxy/project-gone'
    })
    expect(plan.autoExpandPaths).toEqual([])
  })

  it('建档后 bootstrap 候选被忽略，不会重复触发定向展开', () => {
    const plan = planSidebarGroupAutoExpansion({
      knownGroupKeys: new Set(['/Users/zxy/project-a']),
      groupPaths: ['/Users/zxy/project-a'],
      bootstrapExpandPath: '/Users/zxy/project-a'
    })
    expect(plan.autoExpandPaths).toEqual([])
  })
})

describe('sidebarGroupPathForWorkspace', () => {
  it('按工作目录身份 key 匹配分组展示路径（大小写/分隔符/尾斜杠归一）', () => {
    const groupPaths = ['/Users/zxy/Project-A', '/Users/zxy/project-b']
    expect(sidebarGroupPathForWorkspace(groupPaths, '/users/zxy/project-a/')).toBe('/Users/zxy/Project-A')
    expect(sidebarGroupPathForWorkspace(groupPaths, '\\Users\\zxy\\project-b')).toBe('/Users/zxy/project-b')
    expect(sidebarGroupPathForWorkspace(groupPaths, '/Users/zxy/other')).toBe('')
    expect(sidebarGroupPathForWorkspace(groupPaths, '')).toBe('')
  })
})
