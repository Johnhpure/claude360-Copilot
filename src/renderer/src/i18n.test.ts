import { describe, expect, it, vi } from 'vitest'
import i18n, { ensureI18nResources } from './i18n'
import enCommon from './locales/en/common.json'
import zhCommon from './locales/zh/common.json'

// R1（07-14-renderer-lazy-loading）：zh 静态内嵌、en 动态加载。
// 用例顺序有依赖（真实 i18n 单例）：先验初始态与失败降级，最后才真正注册 en。

describe('i18n language resources (R1 lazy en)', () => {
  it('statically embeds only zh and boots in zh', () => {
    expect(i18n.hasResourceBundle('zh', 'common')).toBe(true)
    expect(i18n.hasResourceBundle('zh', 'settings')).toBe(true)
    expect(i18n.hasResourceBundle('en', 'common')).toBe(false)
    expect(i18n.hasResourceBundle('en', 'settings')).toBe(false)
    expect(i18n.t('loading')).toBe(zhCommon.loading)
  })

  it('resolves zh immediately without touching the dynamic loader', async () => {
    const loader = vi.fn()
    await expect(ensureI18nResources('zh', loader)).resolves.toBe(true)
    expect(loader).not.toHaveBeenCalled()
  })

  it('degrades to zh fallback when the en chunk fails to load', async () => {
    const failingLoader = vi.fn(() => Promise.reject(new Error('chunk load failed')))
    await expect(ensureI18nResources('en', failingLoader)).resolves.toBe(false)
    expect(i18n.hasResourceBundle('en', 'common')).toBe(false)
    // 降级路径：加载失败后仍切语言，t() 经 fallbackLng=zh 兜底可读。
    await i18n.changeLanguage('en')
    expect(i18n.t('loading')).toBe(zhCommon.loading)
    await i18n.changeLanguage('zh')
  })

  it('retries after a failure and registers en bundles via dynamic import', async () => {
    // 上一用例失败后单飞句柄应已清空——默认 loader（真实动态 import）可重试成功。
    await expect(ensureI18nResources('en')).resolves.toBe(true)
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true)
    expect(i18n.hasResourceBundle('en', 'settings')).toBe(true)
    await i18n.changeLanguage('en')
    expect(i18n.t('loading')).toBe(enCommon.loading)
    await i18n.changeLanguage('zh')
  })

  it('short-circuits once en bundles are registered', async () => {
    const loader = vi.fn()
    await expect(ensureI18nResources('en', loader)).resolves.toBe(true)
    expect(loader).not.toHaveBeenCalled()
  })

  it('prefetches en at module eval when the persisted locale hint is en, and records hints on language change', async () => {
    // 独立模块图：验证「上次语言 en → 本次求值即后台预取」的启动并行路径。
    vi.resetModules()
    const store = new Map<string, string>([['kun.localeHint', 'en']])
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value)
      }
    })
    try {
      const mod = await import('./i18n')
      // 预取与显式 ensure 命中同一单飞 promise，最终注册成功。
      await expect(mod.ensureI18nResources('en')).resolves.toBe(true)
      expect(mod.default.hasResourceBundle('en', 'common')).toBe(true)
      // languageChanged 时写回 hint，供下次启动预取判断。
      await mod.default.changeLanguage('zh')
      expect(store.get('kun.localeHint')).toBe('zh')
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
