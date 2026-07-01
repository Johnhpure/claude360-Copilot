import { beforeEach, describe, expect, it, vi } from 'vitest'

const setName = vi.fn()
const setAppUserModelId = vi.fn()

vi.mock('electron', () => ({
  app: {
    setName,
    setAppUserModelId
  }
}))

describe('app identity bootstrap', () => {
  beforeEach(() => {
    setName.mockReset()
    setAppUserModelId.mockReset()
    vi.resetModules()
  })

  it('calls app.setName with the project productName', async () => {
    const { configureAppIdentity, APP_PRODUCT_NAME } = await import('./app-identity')
    configureAppIdentity()
    expect(setName).toHaveBeenCalledTimes(1)
    expect(setName).toHaveBeenCalledWith(APP_PRODUCT_NAME)
    expect(APP_PRODUCT_NAME).toBe('Claude360 Copilot')
  })

  it('does not call app.setAppUserModelId (caller responsibility on win32)', async () => {
    // setAppUserModelId 仍然由 main/index.ts 里的 win32 分支调用,
    // 这里只验证 configureAppIdentity 自己不重复设置。
    const { configureAppIdentity } = await import('./app-identity')
    configureAppIdentity()
    expect(setAppUserModelId).not.toHaveBeenCalled()
  })

  it('treats the new appId as a fresh app: does not auto-import legacy data', async () => {
    // 第一阶段策略:新 appId(xyz.claude360.copilot)视为全新应用,userData 目录
    // 由 productName 派生成新目录,启动期不再自动把旧 Kun / DeepSeek GUI 数据搬进来。
    // legacy-data-migration.ts 的迁移函数仍保留(供后续显式导入),仅默认关闭自动触发。
    const { AUTO_IMPORT_LEGACY_DATA } = await import('./app-identity')
    expect(AUTO_IMPORT_LEGACY_DATA).toBe(false)
  })
})
