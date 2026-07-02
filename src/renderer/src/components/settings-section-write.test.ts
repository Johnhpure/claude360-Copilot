import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultWriteSettings
} from '@shared/app-settings'
import { WriteSettingsSection, writeInlineCompletionModelOptions } from './settings-section-write'

describe('write inline completion model options', () => {
  it('keeps the writing model list scoped to the inherited provider', () => {
    const options = writeInlineCompletionModelOptions([
      'MiniMax-M2',
      'MiniMax-M3',
      'MiniMax-M2'
    ])

    expect(options).toEqual(['MiniMax-M2', 'MiniMax-M3'])
    expect(options).not.toContain('deepseek-v4-pro')
    expect(options).not.toContain('deepseek-v4-flash')
  })

  it('uses built-in defaults only when the provider has no models', () => {
    expect(writeInlineCompletionModelOptions([])).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash'
    ])
  })
})

describe('WriteSettingsSection', () => {
  it('does not expose a custom inline completion model entry', () => {
    const html = renderToStaticMarkup(createElement(WriteSettingsSection, {
      ctx: {
        t: (key: string) => key,
        form: {
          write: defaultWriteSettings(),
          provider: defaultModelProviderSettings(),
          claude360: {
            loggedIn: true,
            modelCache: {
              groups: ['Codex'],
              models: ['claude-sonnet-4']
            }
          }
        },
        provider: defaultModelProviderSettings(),
        kun: defaultKunRuntimeSettings(),
        update: vi.fn(),
        selectControlClass: 'select',
        compactHomePath: (value: string) => value,
        expandHomePath: (value: string) => value,
        pickWriteWorkspace: vi.fn(),
        resetWriteWorkspaceToDefault: vi.fn(),
        writeWorkspacePickerError: '',
        writeInlineModelInherited: true,
        setWriteDebugModalOpen: vi.fn(),
        loadWriteDebugEntries: vi.fn()
      }
    }))

    expect(html).not.toContain('modelSelectCustomOption')
    expect(html).not.toContain('modelSelectCustomPlaceholder')
  })
})
