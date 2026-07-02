import { type ReactElement } from 'react'
import { SettingsCard, SettingRow, Toggle } from './settings-controls'

const DEFAULT_IMAGE_GENERATION = {
  enabled: false
}

export function ImageGenerationSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    kun,
    updateKun
  } = ctx
  const imageGeneration = {
    ...DEFAULT_IMAGE_GENERATION,
    ...(kun.imageGeneration ?? {})
  }
  const updateImageGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      imageGeneration: {
        ...imageGeneration,
        ...patch
      }
    })
  }

  return (
    <SettingsCard title={t('imageGen')}>
      <SettingRow
        title={t('imageGenEnabled')}
        description={t('imageGenEnabledDesc')}
        control={
          <Toggle
            checked={imageGeneration.enabled}
            onChange={(enabled) => updateImageGeneration({ enabled })}
          />
        }
      />
    </SettingsCard>
  )
}
