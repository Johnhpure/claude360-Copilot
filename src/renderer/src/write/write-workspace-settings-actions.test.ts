import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { createWriteSettingsActions } from './write-workspace-settings-actions'
import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'

function claude360Settings(): AppSettingsV1 {
  return {
    claude360: {
      selectedTextGroup: 'Codex',
      selectedImageGroup: 'Vision',
      baseUrl: 'https://claude360.xyz'
    },
    provider: {
      providers: [
        {
          id: 'claude360:Codex',
          name: 'Codex',
          apiKey: '',
          apiKeyRef: 'claude360:api-key:1',
          baseUrl: 'https://claude360.xyz',
          models: ['claude-sonnet-4'],
          modelProfiles: {}
        },
        {
          id: 'claude360:Vision',
          name: 'Vision',
          apiKey: '',
          apiKeyRef: 'claude360:api-key:2',
          baseUrl: 'https://claude360.xyz',
          models: ['gpt-image-1'],
          modelProfiles: {},
          image: {
            protocol: 'openai-images',
            baseUrl: 'https://claude360.xyz',
            models: ['gpt-image-1']
          }
        }
      ]
    },
    agents: {
      kun: {
        providerId: 'claude360:Codex',
        model: 'claude-sonnet-4',
        apiKey: '',
        baseUrl: ''
      }
    }
  } as unknown as AppSettingsV1
}

function createHarness(settings: AppSettingsV1): {
  actions: ReturnType<typeof createWriteSettingsActions>
  get: WriteWorkspaceGet
} {
  rendererRuntimeClient.invalidateSettings()
  vi.stubGlobal('window', {
    kunGui: {
      getSettings: vi.fn(async () => settings),
      setSettings: vi.fn(async () => settings)
    }
  })

  let state = {
    settingsLoading: false,
    settingsError: null,
    initializeWorkspace: vi.fn(async () => undefined)
  } as unknown as WriteWorkspaceState
  const set: WriteWorkspaceSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  const get: WriteWorkspaceGet = () => state
  const actions = createWriteSettingsActions({ set, get })
  state = { ...state, ...actions }
  return { actions, get }
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('write workspace settings actions', () => {
  it('treats Claude360 apiKeyRef and selected image group as ready', async () => {
    const { actions, get } = createHarness(claude360Settings())

    await actions.loadWriteSettings()

    expect(get().inlineCompletionApiReady).toBe(true)
    expect(get().imageGenReady).toBe(true)
    expect(get().prototypeReady).toBe(true)
  })
})
