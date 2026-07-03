import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows blob image URLs for local attachment previews', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''

    expect(imgSrc.split(/\s+/)).toContain('blob:')
  })

  it('allows remote https images (music covers / generated image URLs)', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''

    expect(imgSrc.split(/\s+/)).toContain('https:')
  })

  it('declares media-src allowing remote audio and blob object URLs', () => {
    // 无 media-src 时 <audio src> 回落 default-src 'self'：远程音频与 blob 兜底
    // 双双被 CSP 拦截，表现为软件内播放必失败（MEDIA_ERR_SRC_NOT_SUPPORTED）。
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const mediaSrc = csp.match(/media-src\s+([^;]+)/)?.[1] ?? ''

    const sources = mediaSrc.split(/\s+/)
    expect(sources).toContain('https:')
    expect(sources).toContain('blob:')
  })
})
