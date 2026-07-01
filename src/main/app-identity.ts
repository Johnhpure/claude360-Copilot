import { app } from 'electron'

/**
 * 项目对外展示的产品名,需要和:
 *   - package.json#productName
 *   - electron-builder.config.cjs#productName
 *   - tray 菜单和 tooltip
 * 保持一致。Windows 任务栏 / 系统托盘 / 通知中心看到的应用名都来自
 * 这条字符串(在打包产物里还会被写进 VERSIONINFO)。
 *
 * 2026-07 起品牌升级为 “Claude360 Copilot”(此前经历过 “DeepSeek GUI”→“Kun”)。
 * 这个名字同时决定 userData 默认目录(appData/Claude360 Copilot):Electron 用
 * `app.setName()` 派生 userData 目录,改名后即得到全新目录 —— 按用户决策,新
 * appId 视为全新应用,不再把旧 Kun/DeepSeek GUI 数据自动搬进来(见
 * legacy-data-migration.ts:旧迁移函数保留,但启动期不再自动触发)。
 * 注意:electron-builder 的 appId 已按 Claude360 决策同步换成
 * xyz.claude360.copilot,不再沿用旧 com.xingyuzhong.deepseekgui。
 */
export const APP_PRODUCT_NAME = 'Claude360 Copilot'

/**
 * 第一阶段数据目录策略开关:是否在启动期自动导入旧 Kun / DeepSeek GUI 数据。
 *
 * 按用户决策,Claude360 Copilot 换了全新 appId,被系统视为一个全新应用,
 * userData 目录由 `APP_PRODUCT_NAME` 派生成全新目录(appData/Claude360 Copilot)。
 * 第一阶段刻意不把旧品牌的会话 / sqlite / 设置自动搬进新目录:
 *   - 避免把旧应用的历史状态默默带进"新应用",语义更干净;
 *   - 也不自动清理旧数据 —— 旧 Kun / DeepSeek GUI 目录原地保留,用户回滚旧版本
 *     仍可用,后续如需导入可显式触发 legacy-data-migration.ts 的迁移函数。
 *
 * 因此这里默认 false。`runLegacyKunDataMigration` 及其测试完整保留(隐藏≠删除),
 * 只是 main/index.ts 的启动路径用这个开关把"自动触发"关掉。
 */
export const AUTO_IMPORT_LEGACY_DATA = false

/**
 * 在 main 进程最早期调用,把 app 的对外名称设好。
 * `app.setName()` 会覆盖 `app.getName()` 的返回值(优先于 package.json#name
 * 字段),并影响 BrowserWindow 默认 title、通知、托盘等所有用 `app.getName()`
 * 拿名字的地方。要尽早调用,免得启动早期就拿走了旧值。
 *
 * Windows 平台专属的 `app.setAppUserModelId()` 不在这里调 —— 它是 win32
 * 专用的,放在 main/index.ts 的 win32 分支里更直观。
 */
export function configureAppIdentity(): void {
  app.setName(APP_PRODUCT_NAME)
}
