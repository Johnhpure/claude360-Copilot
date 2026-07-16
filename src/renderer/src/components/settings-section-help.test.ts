import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsViewSource from './SettingsView.tsx?raw'
import enSettings from '../locales/en/settings.json'
import zhSettings from '../locales/zh/settings.json'
import { SettingsSidebar } from './SettingsSidebar'
import {
  HelpSettingsSection,
  runDiagnosticsExport
} from './settings-section-help'

describe('runDiagnosticsExport', () => {
  it('maps success, cancellation, and service failures to UI states', async () => {
    await expect(
      runDiagnosticsExport(async () => ({ ok: true, path: '/tmp/diagnostics.zip' }))
    ).resolves.toEqual({ status: 'success', path: '/tmp/diagnostics.zip' })
    await expect(
      runDiagnosticsExport(async () => ({ ok: false, canceled: true }))
    ).resolves.toEqual({ status: 'idle' })
    await expect(
      runDiagnosticsExport(async () => ({ ok: false, message: 'disk full' }))
    ).resolves.toEqual({ status: 'error', message: 'disk full' })
  })

  it('handles a missing or throwing preload bridge', async () => {
    await expect(runDiagnosticsExport(undefined)).resolves.toEqual({
      status: 'error',
      message: 'diagnostics-unavailable'
    })
    await expect(
      runDiagnosticsExport(async () => {
        throw new Error('bridge failed')
      })
    ).resolves.toEqual({ status: 'error', message: 'bridge failed' })
  })
})

describe('HelpSettingsSection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a diagnostic export command and a dedicated sidebar entry', () => {
    vi.stubGlobal('window', {
      kunGui: { exportDiagnostics: vi.fn() }
    })
    const t = (key: string): string => key
    const section = renderToStaticMarkup(createElement(HelpSettingsSection, { t }))
    const sidebar = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'help' as never,
      setCategory: vi.fn(),
      goBack: vi.fn(),
      t
    }))

    expect(section).toContain('helpCenter')
    expect(section).toContain('exportDiagnostics')
    expect(section).toContain('<button')
    expect(sidebar).toContain('helpCenter')
    expect(SettingsViewSource).toContain("import('./settings-section-help')")
    expect(SettingsViewSource).toContain("category === 'help'")
    expect(zhSettings.helpCenter).toBe('帮助中心')
    expect(enSettings.helpCenter).toBe('Help Center')
  })
})
