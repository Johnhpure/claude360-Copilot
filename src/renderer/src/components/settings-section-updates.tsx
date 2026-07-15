import type { ReactElement } from 'react'
import type { GuiUpdateChannel } from '@shared/gui-update'
import { GuiUpdateControl, WindowsIa32DeprecationBanner } from './settings-gui-update'
import { SettingsCard, SettingRow } from './settings-controls'

export function UpdatesSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    update,
    selectControlClass,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate
  } = ctx

  return (
    <SettingsCard title={t('sectionUpdates')}>
      {/* ia32 软废弃横幅（R2）：仅 win32+ia32 出现；arch 来自 preload 只读暴露。 */}
      <WindowsIa32DeprecationBanner
        platform={window.kunGui.platform}
        arch={window.kunGui.arch}
        t={t}
      />
      <SettingRow
        title={t('guiUpdateChannel')}
        description={t('guiUpdateChannelDesc')}
        control={
          <select
            className={selectControlClass}
            value={form.guiUpdate.channel}
            onChange={(e) =>
              update({
                guiUpdate: { channel: e.target.value as GuiUpdateChannel }
              })
            }
          >
            <option value="frontier">{t('guiUpdateChannelFrontier')}</option>
            <option value="stable">{t('guiUpdateChannelStable')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('guiUpdate')}
        description={t('guiUpdateDesc')}
        control={
          <GuiUpdateControl
            info={guiUpdateInfo}
            checking={checkingGuiUpdate}
            downloading={downloadingGuiUpdate}
            installing={installingGuiUpdate}
            downloaded={guiUpdateDownloaded}
            progress={guiUpdateProgress}
            error={guiUpdateError}
            onCheck={checkGuiUpdate}
            onDownload={downloadGuiUpdate}
            onInstall={installGuiUpdate}
            t={t}
          />
        }
      />
    </SettingsCard>
  )
}
