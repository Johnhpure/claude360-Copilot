// ImageResultGrid 静态渲染测试（plan-06 Task 5）。
// 覆盖：空态、url 图片显示图 + 复制链接按钮、base64 图片显示 data URL + 复制图片按钮、下载按钮 + tooltip。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import { ImageResultGrid } from './ImageResultGrid'

function t(key: string, opts?: Record<string, unknown>): string {
  if (opts && typeof opts.prompt === 'string') return `${key}:${opts.prompt}`
  return key
}

function urlImage(): Claude360CanvasImage {
  return {
    id: 'u1',
    source: 'url',
    url: 'https://cdn.example/u1.png',
    mimeType: 'image/png',
    prompt: '一只猫',
    model: 'flux-pro',
    createdAt: '2026-07-01T00:00:00.000Z'
  }
}
function base64Image(): Claude360CanvasImage {
  return {
    id: 'b1',
    source: 'base64',
    b64Json: 'aGVsbG8=',
    mimeType: 'image/png',
    prompt: 'a dog',
    model: 'dall-e-3',
    createdAt: '2026-07-01T00:00:00.000Z'
  }
}

const noop = (): void => undefined

describe('ImageResultGrid · 结果网格', () => {
  it('空态显示 emptyKey 文案', () => {
    const html = renderToStaticMarkup(
      createElement(ImageResultGrid, {
        images: [],
        activeImageId: null,
        onSelect: noop,
        onCopy: noop,
        onDownload: noop,
        emptyKey: 'canvasResultEmpty',
        testId: 'image-result-grid',
        t
      })
    )
    expect(html).toContain('image-result-grid-empty')
    expect(html).toContain('canvasResultEmpty')
  })

  it('url 图片：<img src> 用原始链接，复制按钮显示「复制链接」', () => {
    const html = renderToStaticMarkup(
      createElement(ImageResultGrid, {
        images: [urlImage()],
        activeImageId: 'u1',
        onSelect: noop,
        onCopy: noop,
        onDownload: noop,
        emptyKey: 'canvasResultEmpty',
        testId: 'image-result-grid',
        t
      })
    )
    expect(html).toContain('image-result-card')
    expect(html).toContain('https://cdn.example/u1.png')
    expect(html).toContain('canvasCopyUrl')
    expect(html).toContain('canvasDownload')
    // active 标记
    expect(html).toContain('data-active="true"')
  })

  it('base64 图片：<img src> 是 data URL，复制按钮显示「复制图片」', () => {
    const html = renderToStaticMarkup(
      createElement(ImageResultGrid, {
        images: [base64Image()],
        activeImageId: null,
        onSelect: noop,
        onCopy: noop,
        onDownload: noop,
        emptyKey: 'canvasResultEmpty',
        testId: 'image-result-grid',
        t
      })
    )
    expect(html).toContain('data:image/png;base64,aGVsbG8=')
    expect(html).toContain('canvasCopyImage')
    expect(html).toContain('image-download-button')
  })
})
