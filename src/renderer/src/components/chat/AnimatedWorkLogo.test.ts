import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AnimatedWorkLogo,
  KunStateFigure,
  WORK_LOGO_SWIM_MODES,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS
} from './AnimatedWorkLogo'
import { WorkMetaRow } from './message-timeline-cards'

describe('AnimatedWorkLogo', () => {
  it('ships the Kun bird asset used as the default work mark', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const birdFigure = await readFile(new URL('../../../../asset/img/kun_bird.png', import.meta.url))

    expect(pngDimensions(birdFigure)).toEqual({ width: 751, height: 512 })
  })

  it('renders layered logo markup for swim animation', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, className: 'extra-class', size: 'md' })
    )

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-md')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).toContain('is-active')
    expect(html).toContain('extra-class')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-current')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-ripple')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-wake')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).toContain('ds-work-logo-bubbles')
    expect(html).toContain('ds-work-logo-echo')
    expect(html).toContain('ds-work-logo-track')
    expect(html).toContain('ds-work-logo-body')
    expect(html).toContain('ds-work-logo-image')
    expect(html).toMatch(/ds-work-logo-mode-(propel|sprint|dive|surf)/)
    // 形象工坊已移除:工作 logo 不应再含 iKun 变体 DOM
    expect(html).not.toContain('ds-ikun-logo')
    expect(html).not.toContain('ds-ikun-figure')
  })

  it('renders the state figures with their kind classes', () => {
    for (const kind of ['greet', 'sleep', 'sit'] as const) {
      const html = renderToStaticMarkup(createElement(KunStateFigure, { kind }))
      expect(html).toContain(`ds-kun-state-${kind}`)
      expect(html).toContain('ds-kun-state-figure')
      // 不再渲染第二张 iKun 形象
      expect(html).not.toContain('ds-ikun-state-figure')
      expect(html).not.toContain('data:image')
    }
  })

  it('pins the swim mode when one is provided', () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedWorkLogo, { active: true, mode: 'dive' })
    )

    expect(html).toContain('ds-work-logo-mode-dive')
  })

  it('maps every swim mode to a status label key present in both locales', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const zh = JSON.parse(await readFile(new URL('../../locales/zh/common.json', import.meta.url), 'utf8'))
    const en = JSON.parse(await readFile(new URL('../../locales/en/common.json', import.meta.url), 'utf8'))

    expect([...WORK_LOGO_SWIM_MODES]).toEqual(['propel', 'sprint', 'dive', 'surf'])
    for (const swimMode of WORK_LOGO_SWIM_MODES) {
      const labelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
      expect(labelKey).toBeTruthy()
      expect(zh[labelKey]).toBeTruthy()
      expect(en[labelKey]).toBeTruthy()
    }
  })

  it('defaults to a static logo unless active', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo))

    expect(html).toContain('ds-work-logo')
    expect(html).toContain('ds-work-logo-phase-lead')
    expect(html).not.toContain('is-active')
  })

  it('keeps wave and splash layers mounted in static state to avoid layout churn', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { size: 'sm' }))

    expect(html).toContain('ds-work-logo-sm')
    expect(html).toContain('ds-work-logo-gust')
    expect(html).toContain('ds-work-logo-swell')
    expect(html).toContain('ds-work-logo-wave-back')
    expect(html).toContain('ds-work-logo-wave-front')
    expect(html).toContain('ds-work-logo-breaker')
    expect(html).toContain('ds-work-logo-foam')
    expect(html).toContain('ds-work-logo-crest')
    expect(html).toContain('ds-work-logo-splash')
    expect(html).toContain('ds-work-logo-spray')
    expect(html).not.toContain('is-active')
  })

  it('can render a desynchronized trailing phase', () => {
    const html = renderToStaticMarkup(createElement(AnimatedWorkLogo, { active: true, phase: 'trail' }))

    expect(html).toContain('is-active')
    expect(html).toContain('ds-work-logo-phase-trail')
  })

  it('keeps the processing work row as text-only status', () => {
    const html = renderToStaticMarkup(
      createElement(WorkMetaRow, {
        processing: true,
        stepCount: 3,
        expanded: true,
        onToggle: () => undefined
      })
    )

    expect(html).toContain('ds-shiny-text')
    expect(html).not.toContain('ds-work-logo-slot')
  })

  it('keeps the swim animation layers wired in CSS and drops avatar-workshop styles', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const baseShellCss = await readFile(new URL('../../styles/base-shell.css', import.meta.url), 'utf8')

    for (const layer of [
      'gust',
      'swell',
      'wave-front',
      'breaker',
      'wake',
      'foam',
      'waterline',
      'crest',
      'splash',
      'spray',
      'bubbles'
    ]) {
      expect(baseShellCss).toContain(`ds-work-logo-${layer}`)
    }

    expect(baseShellCss).toContain('@keyframes ds-work-logo-waterline')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-sprint')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-dive')
    expect(baseShellCss).toContain('.ds-work-logo.ds-work-logo-mode-surf')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-sprint-path')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-dive-path')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-dive-figure')
    expect(baseShellCss).toContain('@keyframes ds-work-logo-surf-path')
    expect(baseShellCss).toContain('@keyframes ds-kun-greet-wave')
    expect(baseShellCss).toContain('@keyframes ds-kun-sleep-breathe')
    expect(baseShellCss).toContain('@keyframes ds-kun-sit-sway')
    expect(baseShellCss).toContain('.ds-work-logo:hover')
    expect(baseShellCss).toContain('.ds-kun-state:hover')
    expect(baseShellCss).toContain("[data-focus-mode='on'] .ds-work-logo")
    expect(baseShellCss).toContain('display: none !important;')

    // 形象工坊 CSS 痕迹必须清零
    expect(baseShellCss).not.toContain("data-ikun-mode")
    expect(baseShellCss).not.toContain('data-retroma-mode')
    expect(baseShellCss).not.toContain('ds-ikun')
    expect(baseShellCss).not.toContain('ds-kun-celebration')
    expect(baseShellCss).not.toContain('ds-kun-celebrate')
    expect(baseShellCss).not.toContain('ds-kun-confetti')
    expect(baseShellCss).not.toContain('ds-sidebar-mascot')
    expect(baseShellCss).not.toContain('ds-ikun-cameo')
  })

  it('keeps generated Kun PNG icon dimensions stable for packaging', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const appIcon = await readFile(new URL('../../../../asset/img/kun.png', import.meta.url))
    const macIcon = await readFile(new URL('../../../../asset/img/kun_mac.png', import.meta.url))
    const trayIcon = await readFile(new URL('../../../../asset/img/kun_tray.png', import.meta.url))

    expect(pngDimensions(appIcon)).toEqual({ width: 1254, height: 1254 })
    expect(pngDimensions(macIcon)).toEqual({ width: 1024, height: 1024 })
    expect(pngDimensions(trayIcon)).toEqual({ width: 954, height: 994 })
  })

  it('ships the Kun state figure assets', async () => {
    const nodeFs = 'node:fs/promises'
    const { readFile } = await import(/* @vite-ignore */ nodeFs)
    const expected: Record<string, { width: number; height: number }> = {
      kun_greet: { width: 512, height: 460 },
      kun_sleep: { width: 512, height: 390 },
      kun_surf: { width: 512, height: 479 },
      kun_sit: { width: 512, height: 493 }
    }

    for (const [name, dimensions] of Object.entries(expected)) {
      const figure = await readFile(new URL(`../../../../asset/img/${name}.png`, import.meta.url))
      expect(pngDimensions(figure)).toEqual(dimensions)
    }
  })
})

function pngDimensions(buffer: Uint8Array): { width: number; height: number } {
  const signature = [...buffer.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  expect(signature).toBe('89504e470d0a1a0a')
  return {
    width: readUint32BE(buffer, 16),
    height: readUint32BE(buffer, 20)
  }
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] * 16_777_216 +
    buffer[offset + 1] * 65_536 +
    buffer[offset + 2] * 256 +
    buffer[offset + 3]
  )
}
