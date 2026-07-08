import type { ReactElement, ReactNode } from 'react'
import { Settings, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarCommandRow } from './SidebarPrimitives'

type SidebarFooterNavProps = {
  onOpenMy: () => void
  onOpenSettings: () => void
  myActive?: boolean
  settingsAccessory?: ReactNode
}

export function SidebarFooterNav({
  onOpenMy,
  onOpenSettings,
  myActive = false,
  settingsAccessory
}: SidebarFooterNavProps): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="space-y-1">
      <SidebarCommandRow
        icon={<User className="h-4 w-4" strokeWidth={1.75} />}
        label={t('myPage')}
        onClick={onOpenMy}
        active={myActive}
        variant="footer"
      />
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <SidebarCommandRow
            icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
            label={t('settings')}
            onClick={onOpenSettings}
            variant="footer"
          />
        </div>
        {settingsAccessory}
      </div>
    </div>
  )
}
