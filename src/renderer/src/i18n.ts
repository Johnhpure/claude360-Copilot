import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCommon from './locales/zh/common.json'
import zhSettings from './locales/zh/settings.json'

// 首屏 bundle 优化（07-14-renderer-lazy-loading R1）：默认语言 zh 保留静态内嵌
// （首屏零闪烁），en 资源改为动态 chunk——切换语言前必须先经 ensureI18nResources
// 加载并 addResourceBundle，再 changeLanguage（避免文案闪 key）。
// en 加载失败时 fallbackLng=zh 兜底，UI 仍可读。
void i18n.use(initReactI18next).init({
  resources: {
    zh: { common: zhCommon, settings: zhSettings }
  },
  lng: 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  defaultNS: 'common',
  ns: ['common', 'settings']
})

function loadEnResources(): Promise<[{ default: object }, { default: object }]> {
  return Promise.all([
    import('./locales/en/common.json'),
    import('./locales/en/settings.json')
  ])
}

type EnResourceLoader = typeof loadEnResources

let enResourcesPromise: Promise<boolean> | null = null

/**
 * 确保目标语言的资源包已注册（changeLanguage 前调用）。
 * zh 静态内嵌恒可用；en 动态加载（单飞，失败后清空句柄允许下次重试）。
 * @returns 资源是否就绪。false = 动态加载失败——调用方仍可 changeLanguage，
 *          t() 会经 fallbackLng=zh 兜底显示中文。
 */
export function ensureI18nResources(
  locale: string,
  loader: EnResourceLoader = loadEnResources
): Promise<boolean> {
  if (!locale.toLowerCase().startsWith('en')) return Promise.resolve(true)
  if (i18n.hasResourceBundle('en', 'common') && i18n.hasResourceBundle('en', 'settings')) {
    return Promise.resolve(true)
  }
  enResourcesPromise ??= loader().then(
    ([common, settings]) => {
      i18n.addResourceBundle('en', 'common', common.default, true, true)
      i18n.addResourceBundle('en', 'settings', settings.default, true, true)
      return true
    },
    () => {
      enResourcesPromise = null
      return false
    }
  )
  return enResourcesPromise
}

// 启动并行预取（design 改动 1：「启动语言若已是 en 则 boot 早期并行 import，不阻塞首帧」）：
// 上次会话语言持久化为 hint——本次模块求值时即后台加载 en chunk，boot 中
// applyI18nFromSettings 的 await 会命中同一单飞 promise（等待时间与首帧渲染重叠）。
// node 测试环境无 window/localStorage，静默跳过。
const LOCALE_HINT_STORAGE_KEY = 'kun.localeHint'

try {
  if (typeof window !== 'undefined' && window.localStorage?.getItem(LOCALE_HINT_STORAGE_KEY) === 'en') {
    void ensureI18nResources('en')
  }
} catch {
  // localStorage 不可用（隐私模式等）：跳过预取，boot 时再加载。
}

i18n.on('languageChanged', (lng) => {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(LOCALE_HINT_STORAGE_KEY, lng)
  } catch {
    // 写 hint 失败不影响功能，下次启动走 boot 内加载路径。
  }
})

export default i18n
