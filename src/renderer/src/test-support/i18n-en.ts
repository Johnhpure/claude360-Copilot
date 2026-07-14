import i18n from '../i18n'
import enCommon from '../locales/en/common.json'
import enSettings from '../locales/en/settings.json'

/**
 * 测试辅助（07-14-renderer-lazy-loading R1）：en 语言包不再静态内嵌
 * （i18n 默认 zh，en 为动态 chunk）。需要以英文文案断言 UI 的测试文件在
 * 文件级 `beforeAll(() => setupI18nTestEnglish())` 中调用本函数——
 * 静态注册 en 资源并切换语言，恢复这些测试原有的 en 运行前提。
 * 仅供测试使用：生产代码不得 import（避免 en JSON 回到主 bundle）。
 */
export async function setupI18nTestEnglish(): Promise<void> {
  if (!i18n.hasResourceBundle('en', 'common')) {
    i18n.addResourceBundle('en', 'common', enCommon, true, true)
  }
  if (!i18n.hasResourceBundle('en', 'settings')) {
    i18n.addResourceBundle('en', 'settings', enSettings, true, true)
  }
  await i18n.changeLanguage('en')
}
