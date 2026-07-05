import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GuiUpdateState } from '@shared/gui-update'
import { GuiUpdatePromptPanel, shouldShowGuiUpdatePrompt } from './GuiUpdatePrompt'

function t(key: string, values?: Record<string, unknown>): string {
  if (!values) return key
  return `${key}:${Object.entries(values).map(([name, value]) => `${name}=${String(value)}`).join(',')}`
}

const availableState: GuiUpdateState = {
  status: 'available',
  info: {
    ok: true,
    currentVersion: '0.1.0',
    latestVersion: '0.2.0',
    hasUpdate: true,
    releaseUrl: 'https://github.com/Johnhpure/claude360-Copilot/releases/tag/v0.2.0',
    releaseNotes: '修复更新流程并改进启动体验。',
    channel: 'stable',
    downloaded: false
  }
}

describe('shouldShowGuiUpdatePrompt', () => {
  it('shows only automatic, non-dismissed available updates', () => {
    expect(shouldShowGuiUpdatePrompt(availableState, undefined, null)).toBe(true)
    expect(shouldShowGuiUpdatePrompt(availableState, '0.2.0', null)).toBe(false)
    expect(shouldShowGuiUpdatePrompt(availableState, undefined, '0.2.0')).toBe(false)
    expect(shouldShowGuiUpdatePrompt({
      ...availableState,
      info: { ...availableState.info, manualOnly: true }
    }, undefined, null)).toBe(false)
    expect(shouldShowGuiUpdatePrompt({
      ...availableState,
      info: { ...availableState.info, hasUpdate: false }
    }, undefined, null)).toBe(false)
  })
})

describe('GuiUpdatePromptPanel', () => {
  it('renders the available update version, release notes, download action and later action', () => {
    const html = renderToStaticMarkup(
      createElement(GuiUpdatePromptPanel, {
        state: availableState,
        error: null,
        onDownload: vi.fn(),
        onInstall: vi.fn(),
        onLater: vi.fn(),
        t
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('guiUpdatePromptTitle:version=0.2.0')
    expect(html).toContain('guiUpdatePromptVersion:current=0.1.0,latest=0.2.0')
    expect(html).toContain('修复更新流程并改进启动体验。')
    expect(html).toContain('guiUpdatePromptDownload')
    expect(html).toContain('guiUpdatePromptLater')
  })

  it('renders download progress while the shared updater state is downloading', () => {
    const html = renderToStaticMarkup(
      createElement(GuiUpdatePromptPanel, {
        state: {
          status: 'downloading',
          info: availableState.info,
          progress: {
            total: 100,
            delta: 42,
            transferred: 42,
            percent: 42,
            bytesPerSecond: 10
          }
        },
        error: null,
        onDownload: vi.fn(),
        onInstall: vi.fn(),
        onLater: vi.fn(),
        t
      })
    )

    expect(html).toContain('guiUpdatePromptDownloading:percent=42')
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).not.toContain('guiUpdatePromptLater')
  })

  it('renders install action after the update has been downloaded', () => {
    const html = renderToStaticMarkup(
      createElement(GuiUpdatePromptPanel, {
        state: {
          status: 'downloaded',
          info: { ...availableState.info, downloaded: true }
        },
        error: null,
        onDownload: vi.fn(),
        onInstall: vi.fn(),
        onLater: vi.fn(),
        t
      })
    )

    expect(html).toContain('guiUpdatePromptDownloaded')
    expect(html).toContain('guiUpdatePromptInstall')
    expect(html).not.toContain('guiUpdatePromptLater')
  })
})

