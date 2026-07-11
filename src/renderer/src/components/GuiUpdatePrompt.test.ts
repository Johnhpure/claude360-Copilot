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

  it('renders available update html release notes without exposing html tags', () => {
    const html = renderToStaticMarkup(
      createElement(GuiUpdatePromptPanel, {
        state: {
          ...availableState,
          info: {
            ...availableState.info,
            releaseNotes:
              '<p>速度&nbsp;&amp;&nbsp;稳定性优化</p><ul><li>修复更新弹窗排版</li><li>优化下载进度显示</li></ul>'
          }
        },
        error: null,
        onDownload: vi.fn(),
        onInstall: vi.fn(),
        onLater: vi.fn(),
        t
      })
    )

    expect(html).toContain('速度 &amp; 稳定性优化')
    expect(html).toContain('修复更新弹窗排版')
    expect(html).toContain('优化下载进度显示')
    expect(html).toContain('max-h-48')
    expect(html).toContain('overflow-y-auto')
    expect(html).not.toContain('nbsp')
    expect(html).not.toContain('&lt;p&gt;')
    expect(html).not.toContain('&lt;ul&gt;')
    expect(html).not.toContain('&lt;li&gt;')
    expect(html).not.toContain('&lt;/p&gt;')
    expect(html).not.toContain('<p>')
    expect(html).not.toContain('<ul>')
    expect(html).not.toContain('<li>')
  })

  it('renders the fallback text when the available update has no release notes', () => {
    for (const releaseNotes of [undefined, '   ']) {
      const html = renderToStaticMarkup(
        createElement(GuiUpdatePromptPanel, {
          state: {
            ...availableState,
            info: { ...availableState.info, releaseNotes }
          },
          error: null,
          onDownload: vi.fn(),
          onInstall: vi.fn(),
          onLater: vi.fn(),
          t
        })
      )

      expect(html).toContain('guiUpdatePromptReleaseNotesFallback')
    }
  })

  it('renders markdown style release notes as paragraphs and list items', () => {
    const html = renderToStaticMarkup(
      createElement(GuiUpdatePromptPanel, {
        state: {
          ...availableState,
          info: {
            ...availableState.info,
            releaseNotes: '本次更新重点：\n\n- 修复启动崩溃\n- 提升同步速度'
          }
        },
        error: null,
        onDownload: vi.fn(),
        onInstall: vi.fn(),
        onLater: vi.fn(),
        t
      })
    )

    expect(html).toContain('本次更新重点：')
    expect(html).toContain('修复启动崩溃')
    expect(html).toContain('提升同步速度')
    expect(html).not.toContain('- 修复启动崩溃')
  })

  it('renders completed update release notes without exposing html tags', () => {
    const html = renderToStaticMarkup(
      createElement(GuiUpdatePromptPanel, {
        state: {
          status: 'updated',
          info: {
            currentVersion: '0.2.0',
            releaseUrl: 'https://github.com/Johnhpure/claude360-Copilot/releases',
            releaseNotes: '<p>更新内容：</p><ul><li>修复 AI 写词助手弹窗</li><li>优化更新提示</li></ul>',
            channel: 'stable'
          }
        },
        error: null,
        onDownload: vi.fn(),
        onInstall: vi.fn(),
        onLater: vi.fn(),
        t
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('guiUpdatePromptUpdatedTitle:version=0.2.0')
    expect(html).toContain('guiUpdatePromptReleaseNotesHeading')
    expect(html).toContain('修复 AI 写词助手弹窗')
    expect(html).toContain('优化更新提示')
    expect(html).toContain('guiUpdatePromptViewChangelog')
    expect(html).toContain('guiUpdatePromptLater')
    expect(html).toContain('max-h-')
    expect(html).toContain('overflow-y-auto')
    expect(html).not.toContain('&lt;p&gt;')
    expect(html).not.toContain('&lt;ul&gt;')
    expect(html).not.toContain('&lt;li&gt;')
    expect(html).not.toContain('<p>')
    expect(html).not.toContain('<ul>')
    expect(html).not.toContain('<li>')
  })
})
