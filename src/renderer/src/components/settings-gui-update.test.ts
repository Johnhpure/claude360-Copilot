import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GuiUpdateInfo } from '@shared/gui-update'
import { GuiUpdateControl } from './settings-gui-update'

type ControlProps = Parameters<typeof GuiUpdateControl>[0]

const messages: Record<string, string> = {
  guiUpdateAvailable: '发现新版本：{{current}} -> {{latest}}',
  guiUpdateAvailableManual: '发现新版本：{{current}} -> {{latest}}，请前往下载页手动安装。',
  guiUpdateCheck: '检查更新',
  guiUpdateCheckFailed: '无法检查 GUI 更新',
  guiUpdateChecking: '正在检查 GUI 更新...',
  guiUpdateCurrent: '已是最新版本：{{version}}',
  guiUpdateDownloadInstall: '下载并安装',
  guiUpdateDownloadProgress: '{{transferred}} / {{total}}，{{speed}}/s',
  guiUpdateDownloaded: '更新 {{version}} 已下载',
  guiUpdateDownloadedDesc: '下载完成，等待重启安装。',
  guiUpdateDownloading: '正在下载更新... {{percent}}%',
  guiUpdateInstall: '重启并安装',
  guiUpdateInstalling: '正在重启并安装更新...',
  guiUpdateNotConfiguredTitle: '当前无法检查更新',
  guiUpdateOpenRelease: '打开下载页',
  guiUpdateErrNotConfigured: '暂时无法连接更新来源。'
}

const automaticInfo: Extract<GuiUpdateInfo, { ok: true }> = {
  ok: true,
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  hasUpdate: true,
  releaseUrl: 'https://github.com/Johnhpure/claude360-Copilot/releases/tag/v0.2.0',
  releaseNotes: '修复 macOS 应用内自动下载与安装。',
  releaseDate: '2026-07-08T00:00:00.000Z',
  channel: 'stable',
  downloaded: false
}

function t(key: string, values?: Record<string, unknown>): string {
  const template = messages[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
}

function renderControl(overrides: Partial<ControlProps> = {}): string {
  const props: ControlProps = {
    info: automaticInfo,
    checking: false,
    downloading: false,
    installing: false,
    downloaded: false,
    progress: null,
    error: null,
    onCheck: vi.fn(async () => undefined),
    onDownload: vi.fn(async () => undefined),
    onInstall: vi.fn(async () => undefined),
    t,
    ...overrides
  }
  return renderToStaticMarkup(createElement(GuiUpdateControl, props))
}

describe('GuiUpdateControl', () => {
  it('renders automatic updates with release notes and an in-app download primary action', () => {
    const html = renderControl()

    expect(html).toContain('发现新版本：0.1.0 -&gt; 0.2.0')
    expect(html).toContain('修复 macOS 应用内自动下载与安装。')
    expect(html).toContain('下载并安装')
    expect(html).toContain('打开下载页')
  })

  it('keeps manual-only updates on the download page fallback path', () => {
    const html = renderControl({
      info: {
        ...automaticInfo,
        manualOnly: true
      }
    })

    expect(html).toContain('请前往下载页手动安装')
    expect(html).toContain('打开下载页')
    expect(html).not.toContain('下载并安装')
  })

  it('renders download progress as a percentage', () => {
    const html = renderControl({
      downloading: true,
      progress: {
        total: 100,
        delta: 42,
        transferred: 42,
        percent: 42,
        bytesPerSecond: 10
      }
    })

    expect(html).toContain('正在下载更新... 42%')
    expect(html).toContain('42 B / 100 B')
  })

  it('renders restart-and-install after the update has downloaded', () => {
    const html = renderControl({
      downloaded: true,
      info: {
        ...automaticInfo,
        downloaded: true
      }
    })

    expect(html).toContain('下载完成，等待重启安装。')
    expect(html).toContain('重启并安装')
  })
})
