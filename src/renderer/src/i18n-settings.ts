import i18n from './i18n'
import zhSettings from './locales/zh/settings.json'

// P3（07-17 pre-release）：zh settings 命名空间（~88KB）从入口 i18n.ts 拆出，改由此模块
// 承载，随首个消费它的懒链（SettingsView / InitialSetupDialog / McpServersEditor）静态
// import 注册——使 settings 文案不进首屏入口 chunk（entry raw 解析减 ~88KB）。首屏组件
// 一律不消费 settings ns（WorkbenchTopBar 的 guiUpdate 键已迁 common），故拆分不闪 key。
// 幂等：addResourceBundle(deep=true, overwrite=true)，多个懒链重复 import 只是重复写入
// 同一份，无副作用。en settings 仍走 i18n.ts 的 ensureI18nResources 动态加载，不在此处。
i18n.addResourceBundle('zh', 'settings', zhSettings, true, true)
