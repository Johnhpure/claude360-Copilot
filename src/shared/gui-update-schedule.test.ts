import { describe, expect, it } from 'vitest'
import {
  GUI_UPDATE_STARTUP_CHECK_DELAY_MS,
  nextGuiUpdateCheckDelay
} from './gui-update-schedule'

describe('nextGuiUpdateCheckDelay', () => {
  it('schedules the once-per-launch check with a fixed startup delay', () => {
    expect(nextGuiUpdateCheckDelay(false)).toBe(GUI_UPDATE_STARTUP_CHECK_DELAY_MS)
  })

  it('keeps the startup delay inside the required 3-5 second window', () => {
    // 需求：启动后延迟 3-5 秒检查，不阻塞主界面启动。
    expect(GUI_UPDATE_STARTUP_CHECK_DELAY_MS).toBeGreaterThanOrEqual(3_000)
    expect(GUI_UPDATE_STARTUP_CHECK_DELAY_MS).toBeLessThanOrEqual(5_000)
  })

  it('never schedules another automatic check within the same process run', () => {
    // 每次启动最多自动检查一次；手动检查不经过该调度函数，不受限制。
    expect(nextGuiUpdateCheckDelay(true)).toBeNull()
  })
})
