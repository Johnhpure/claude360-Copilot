import { describe, expect, it } from 'vitest'
import {
  CLAUDE360_MUSIC_TASK_STATUSES,
  type Claude360MusicTaskStatus
} from './claude360-music'

// Task 1 Step 2：项目无纯类型断言机制，用最小 runtime helper 测试保证状态枚举
// 与 music-web 源项目一致、不多不少（submitting/queued/in_progress/success/failure）。
describe('claude360-music task status enum', () => {
  it('迁移自 music-web 的状态集合完整且不发明新状态', () => {
    expect([...CLAUDE360_MUSIC_TASK_STATUSES]).toEqual([
      'submitting',
      'queued',
      'in_progress',
      'success',
      'failure'
    ])
  })

  it('每个状态字面量都可赋值给 Claude360MusicTaskStatus', () => {
    // 编译期覆盖：遍历运行期清单赋回类型，任一命名漂移都会导致 typecheck 失败。
    for (const status of CLAUDE360_MUSIC_TASK_STATUSES) {
      const typed: Claude360MusicTaskStatus = status
      expect(typeof typed).toBe('string')
    }
  })
})
