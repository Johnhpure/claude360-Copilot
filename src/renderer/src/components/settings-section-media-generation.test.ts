import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MediaGenerationSettingsSection } from './settings-section-media-generation'

const labels: Record<string, string> = {
  mediaGeneration: 'Media generation',
  mediaGenerationDesc: 'Expose media tools',
  imageGen: 'Image generation',
  imageGenEnabled: 'Enable image generation',
  imageGenEnabledDesc: 'Enable generate_image',
  imageGenProvider: 'Image provider',
  imageGenProviderCustom: 'Custom image API',
  imageGenBaseUrl: 'Image base URL',
  imageGenApiKey: 'Image API key',
  textToSpeech: 'Speech generation',
  textToSpeechEnabled: 'Enable speech generation',
  textToSpeechEnabledDesc: 'Enable generate_speech',
  textToSpeechProvider: 'Speech provider',
  textToSpeechProviderDesc: 'Choose speech provider',
  textToSpeechProviderCustom: 'Custom speech API',
  textToSpeechProviderMissingKey: '{{provider}} missing key',
  textToSpeechModel: 'Speech model',
  textToSpeechModelDesc: 'Speech model desc',
  textToSpeechVoice: 'Voice',
  textToSpeechVoiceDesc: 'Voice desc',
  textToSpeechVoicePlaceholder: 'voice',
  textToSpeechFormat: 'Speech format',
  textToSpeechFormatDesc: 'Speech format desc',
  textToSpeechTimeout: 'Speech timeout',
  textToSpeechTimeoutDesc: 'Speech timeout desc',
  musicGeneration: 'Music generation',
  musicGenerationEnabled: 'Enable music generation',
  musicGenerationEnabledDesc: 'Enable generate_music',
  musicGenerationProvider: 'Music provider',
  musicGenerationProviderDesc: 'Choose music provider',
  musicGenerationProviderCustom: 'Custom music API',
  musicGenerationProviderMissingKey: '{{provider}} missing key',
  musicGenerationModel: 'Music model',
  musicGenerationModelDesc: 'Music model desc',
  musicGenerationFormat: 'Music format',
  musicGenerationFormatDesc: 'Music format desc',
  musicGenerationTimeout: 'Music timeout',
  musicGenerationTimeoutDesc: 'Music timeout desc',
  videoGeneration: 'Video generation',
  videoGenerationEnabled: 'Enable video generation',
  videoGenerationEnabledDesc: 'Enable generate_video',
  videoGenerationProvider: 'Video provider',
  videoGenerationProviderDesc: 'Choose video provider',
  videoGenerationProviderCustom: 'Custom video API',
  videoGenerationProviderMissingKey: '{{provider}} missing key',
  videoGenerationModel: 'Video model',
  videoGenerationModelDesc: 'Video model desc',
  videoGenerationDefaultDuration: 'Default duration',
  videoGenerationDefaultDurationDesc: 'Default duration desc',
  videoGenerationDefaultResolution: 'Default resolution',
  videoGenerationDefaultResolutionDesc: 'Default resolution desc',
  videoGenerationTimeout: 'Video timeout',
  videoGenerationTimeoutDesc: 'Video timeout desc',
  videoGenerationPollInterval: 'Poll interval',
  videoGenerationPollIntervalDesc: 'Poll interval desc',
  modelSelectDefaultOption: 'Default {{model}}'
}

function t(key: string, params?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

describe('MediaGenerationSettingsSection', () => {
  it('hides legacy custom provider and credential controls', () => {
    const html = renderToStaticMarkup(createElement(MediaGenerationSettingsSection, {
      ctx: {
        t,
        selectControlClass: 'select',
        updateKun: vi.fn(),
        provider: {
          providers: [{
            id: 'minimax',
            name: 'MiniMax',
            apiKey: 'sk-test',
            textToSpeech: {
              protocol: 'minimax-t2a',
              baseUrl: 'https://api.minimax.io',
              models: ['speech-2.8-hd', 'speech-2.8-turbo']
            },
            music: {
              protocol: 'minimax-music',
              baseUrl: 'https://api.minimax.io',
              models: ['music-2.6']
            },
            video: {
              protocol: 'minimax-video',
              baseUrl: 'https://api.minimax.io',
              models: ['MiniMax-Hailuo-2.3']
            }
          }]
        },
        kun: {
          imageGeneration: {
            enabled: true,
            providerId: 'custom-image',
            protocol: 'openai-images',
            baseUrl: 'https://image.example.com/v1',
            apiKey: 'sk-image',
            model: 'custom-image-model',
            defaultSize: '',
            timeoutMs: 180000
          },
          textToSpeech: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-t2a',
            baseUrl: '',
            apiKey: '',
            model: 'speech-2.8-hd',
            voice: '',
            format: 'mp3',
            timeoutMs: 120000
          },
          musicGeneration: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-music',
            baseUrl: '',
            apiKey: '',
            model: 'music-2.6',
            format: 'mp3',
            timeoutMs: 300000
          },
          videoGeneration: {
            enabled: true,
            providerId: 'minimax',
            protocol: 'minimax-video',
            baseUrl: '',
            apiKey: '',
            model: 'MiniMax-Hailuo-2.3',
            defaultDuration: 6,
            defaultResolution: '1080P',
            timeoutMs: 900000,
            pollIntervalMs: 10000
          }
        }
      }
    }))

    expect(html).toContain('Media generation')
    expect(html).toContain('Image generation')
    expect(html).not.toContain('Custom image API')
    expect(html).not.toContain('Custom speech API')
    expect(html).not.toContain('Custom music API')
    expect(html).not.toContain('Custom video API')
    expect(html).not.toContain('Image provider')
    expect(html).not.toContain('Speech provider')
    expect(html).not.toContain('Music provider')
    expect(html).not.toContain('Video provider')
    expect(html).not.toContain('Image base URL')
    expect(html).not.toContain('Image API key')
    expect(html).not.toContain('apiKey')
    expect(html).not.toContain('baseUrl')
    expect(html).not.toContain('MiniMax')
  })
})
