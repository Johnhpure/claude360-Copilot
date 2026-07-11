import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarIconButton } from './SidebarPrimitives'

/**
 * 全局主题是否为深色。读 document.documentElement 的 data-theme（全局主题，
 * applyTheme 的唯一写入点；07-12 起侧栏子树不再自挂 data-theme，跟随全局主题，
 * spec: frontend/components.md「Theme-Following Sidebar」）。
 * node 测试环境（renderToStaticMarkup）下 document 不存在，初值兜底 false。
 */
function useGlobalDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'dark'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

/**
 * SidebarThemeToggle —— 侧栏底部「深色/明亮」切换按钮（SidebarFooterNav 的
 * settingsAccessory 槽位）。07-11 抽为共享组件：chat / write 两个侧栏统一使用，
 * 消除此前 WriteSidebar footer 缺主题切换的不一致。
 */
export function SidebarThemeToggle({
  onToggleTheme
}: {
  onToggleTheme: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const isDarkMode = useGlobalDarkTheme()
  return (
    <SidebarIconButton
      title={isDarkMode ? t('switchToLight') : t('switchToDark')}
      ariaLabel={t('toggleTheme')}
      onClick={onToggleTheme}
    >
      {isDarkMode ? (
        <Sun className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.75} />
      )}
    </SidebarIconButton>
  )
}
