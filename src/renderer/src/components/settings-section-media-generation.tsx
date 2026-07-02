import { type ReactElement } from 'react'
import {
  DEFAULT_MUSIC_GENERATION_PROTOCOL,
  DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  DEFAULT_VIDEO_GENERATION_PROTOCOL,
  isClaude360ProviderId
} from '@shared/app-settings'
import { ModelSelect, SettingsCard, SettingRow, Toggle } from './settings-controls'
import { ImageGenerationSettingsSection } from './settings-section-image-generation'

const AUDIO_FORMATS = ['mp3', 'wav', 'flac'] as const
const VIDEO_RESOLUTIONS = ['768P', '1080P'] as const

const DEFAULT_TEXT_TO_SPEECH = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_TEXT_TO_SPEECH_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  voice: '',
  format: 'mp3',
  timeoutMs: 120000
}

const DEFAULT_MUSIC_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_MUSIC_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  format: 'mp3',
  timeoutMs: 300000
}

const DEFAULT_VIDEO_GENERATION = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_VIDEO_GENERATION_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  defaultDuration: 6,
  defaultResolution: '1080P',
  timeoutMs: 900000,
  pollIntervalMs: 10000
}

type ProviderCapability = {
  protocol: string
  models: string[]
}

type ProviderProfile = {
  id: string
  name: string
  apiKey?: string
  textToSpeech?: ProviderCapability
  music?: ProviderCapability
  video?: ProviderCapability
}

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const compactInputClass =
  'w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

export function MediaGenerationSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    provider,
    kun,
    selectControlClass,
    updateKun
  } = ctx
  const textToSpeech = {
    ...DEFAULT_TEXT_TO_SPEECH,
    ...(kun.textToSpeech ?? {})
  }
  const musicGeneration = {
    ...DEFAULT_MUSIC_GENERATION,
    ...(kun.musicGeneration ?? {})
  }
  const videoGeneration = {
    ...DEFAULT_VIDEO_GENERATION,
    ...(kun.videoGeneration ?? {})
  }
  const providers = (provider?.providers ?? []) as ProviderProfile[]
  const claude360Providers = providers.filter((item) => isClaude360ProviderId(item.id))
  const textToSpeechProviders = claude360Providers.filter((item) => Boolean(item.textToSpeech))
  const musicProviders = claude360Providers.filter((item) => Boolean(item.music))
  const videoProviders = claude360Providers.filter((item) => Boolean(item.video))

  const updateTextToSpeech = (patch: Record<string, unknown>): void => {
    updateKun({
      textToSpeech: {
        ...textToSpeech,
        ...patch
      }
    })
  }
  const updateMusicGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      musicGeneration: {
        ...musicGeneration,
        ...patch
      }
    })
  }
  const updateVideoGeneration = (patch: Record<string, unknown>): void => {
    updateKun({
      videoGeneration: {
        ...videoGeneration,
        ...patch
      }
    })
  }

  const selectedTts = selectedProviderCapability({
    settingProviderId: textToSpeech.providerId,
    providers: textToSpeechProviders,
    capabilityKey: 'textToSpeech'
  })
  const selectedMusic = selectedProviderCapability({
    settingProviderId: musicGeneration.providerId,
    providers: musicProviders,
    capabilityKey: 'music'
  })
  const selectedVideo = selectedProviderCapability({
    settingProviderId: videoGeneration.providerId,
    providers: videoProviders,
    capabilityKey: 'video'
  })

  return (
    <div className="grid gap-6">
      <SettingsCard title={t('mediaGeneration')}>
        <div className="px-5 py-4 text-[13px] leading-6 text-ds-muted">
          {t('mediaGenerationDesc')}
        </div>
      </SettingsCard>

      <ImageGenerationSettingsSection ctx={ctx} />

      <SettingsCard title={t('textToSpeech')}>
        <SettingRow
          title={t('textToSpeechEnabled')}
          description={t('textToSpeechEnabledDesc')}
          control={
            <Toggle
              checked={textToSpeech.enabled}
              onChange={(enabled) => updateTextToSpeech({ enabled })}
            />
          }
        />
        {textToSpeech.enabled ? (
          <>
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'textToSpeech',
              model: textToSpeech.model,
              options: selectedTts?.models ?? [],
              update: updateTextToSpeech
            })}
            <SettingRow
              title={t('textToSpeechVoice')}
              description={t('textToSpeechVoiceDesc')}
              control={
                <input
                  className={inputClass}
                  value={textToSpeech.voice}
                  placeholder={t('textToSpeechVoicePlaceholder')}
                  onChange={(e) => updateTextToSpeech({ voice: e.target.value })}
                />
              }
            />
            {renderAudioFormatRow(t, 'textToSpeechFormat', textToSpeech.format, updateTextToSpeech)}
            {renderTimeoutRow(t, 'textToSpeechTimeout', textToSpeech.timeoutMs, 10000, 900000, updateTextToSpeech)}
          </>
        ) : null}
      </SettingsCard>

      <SettingsCard title={t('musicGeneration')}>
        <SettingRow
          title={t('musicGenerationEnabled')}
          description={t('musicGenerationEnabledDesc')}
          control={
            <Toggle
              checked={musicGeneration.enabled}
              onChange={(enabled) => updateMusicGeneration({ enabled })}
            />
          }
        />
        {musicGeneration.enabled ? (
          <>
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'musicGeneration',
              model: musicGeneration.model,
              options: selectedMusic?.models ?? [],
              update: updateMusicGeneration
            })}
            {renderAudioFormatRow(t, 'musicGenerationFormat', musicGeneration.format, updateMusicGeneration)}
            {renderTimeoutRow(t, 'musicGenerationTimeout', musicGeneration.timeoutMs, 10000, 1800000, updateMusicGeneration)}
          </>
        ) : null}
      </SettingsCard>

      <SettingsCard title={t('videoGeneration')}>
        <SettingRow
          title={t('videoGenerationEnabled')}
          description={t('videoGenerationEnabledDesc')}
          control={
            <Toggle
              checked={videoGeneration.enabled}
              onChange={(enabled) => updateVideoGeneration({ enabled })}
            />
          }
        />
        {videoGeneration.enabled ? (
          <>
            {renderModelRow({
              t,
              selectControlClass,
              prefix: 'videoGeneration',
              model: videoGeneration.model,
              options: selectedVideo?.models ?? [],
              update: updateVideoGeneration
            })}
            <SettingRow
              title={t('videoGenerationDefaultDuration')}
              description={t('videoGenerationDefaultDurationDesc')}
              control={
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  className={compactInputClass}
                  value={videoGeneration.defaultDuration}
                  onChange={(e) => updateVideoGeneration({ defaultDuration: Number(e.target.value) })}
                />
              }
            />
            <SettingRow
              title={t('videoGenerationDefaultResolution')}
              description={t('videoGenerationDefaultResolutionDesc')}
              control={
                <select
                  className={`${selectControlClass} md:max-w-[160px]`}
                  value={videoGeneration.defaultResolution}
                  onChange={(e) => updateVideoGeneration({ defaultResolution: e.target.value })}
                >
                  {VIDEO_RESOLUTIONS.map((resolution) => (
                    <option key={resolution} value={resolution}>{resolution}</option>
                  ))}
                </select>
              }
            />
            {renderTimeoutRow(t, 'videoGenerationTimeout', videoGeneration.timeoutMs, 30000, 3600000, updateVideoGeneration)}
            <SettingRow
              title={t('videoGenerationPollInterval')}
              description={t('videoGenerationPollIntervalDesc')}
              control={
                <input
                  type="number"
                  min={1000}
                  max={120000}
                  step={1000}
                  className={compactInputClass}
                  value={videoGeneration.pollIntervalMs}
                  onChange={(e) => updateVideoGeneration({ pollIntervalMs: Number(e.target.value) })}
                />
              }
            />
          </>
        ) : null}
      </SettingsCard>
    </div>
  )
}

function selectedProviderCapability(input: {
  settingProviderId: string
  providers: ProviderProfile[]
  capabilityKey: 'textToSpeech' | 'music' | 'video'
}): ProviderCapability | undefined {
  const provider = input.providers.find((item) => item.id === input.settingProviderId) ??
    input.providers[0]
  return provider?.[input.capabilityKey]
}

function renderModelRow(input: {
  t: (key: string, values?: Record<string, unknown>) => string
  selectControlClass: string
  prefix: string
  model: string
  options: string[]
  update: (patch: Record<string, unknown>) => void
}): ReactElement {
  return (
    <SettingRow
      title={input.t(`${input.prefix}Model`)}
      description={input.t(`${input.prefix}ModelDesc`)}
      control={
        <div className="w-full min-w-0 md:max-w-md">
          <ModelSelect
            value={input.options.includes(input.model) ? input.model : ''}
            options={input.options}
            defaultLabel={input.t('modelSelectDefaultOption', {
              model: input.options[0] ?? ''
            })}
            selectClassName={input.selectControlClass}
            onChange={(model) => input.update({ model })}
          />
        </div>
      }
    />
  )
}

function renderAudioFormatRow(
  t: (key: string) => string,
  titleKey: string,
  value: string,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(titleKey)}
      description={t(`${titleKey}Desc`)}
      control={
        <select
          className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
          value={value}
          onChange={(e) => update({ format: e.target.value })}
        >
          {AUDIO_FORMATS.map((format) => (
            <option key={format} value={format}>{format}</option>
          ))}
        </select>
      }
    />
  )
}

function renderTimeoutRow(
  t: (key: string) => string,
  titleKey: string,
  value: number,
  min: number,
  max: number,
  update: (patch: Record<string, unknown>) => void
): ReactElement {
  return (
    <SettingRow
      title={t(titleKey)}
      description={t(`${titleKey}Desc`)}
      control={
        <input
          type="number"
          min={min}
          max={max}
          step={10000}
          className={compactInputClass}
          value={value}
          onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
        />
      }
    />
  )
}
