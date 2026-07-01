// 生图结果工具的单元测试（plan-06 Task 4）。
// node 环境纯函数测试：b64_json → dataURL、url 结果保留、安全文件名、损坏数据安全失败。
import { describe, it, expect } from 'vitest'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import {
  imageDataUrl,
  imageCopyUrl,
  safeImageFilename,
  isDownloadableImage
} from './image-result-utils'

function base64Image(overrides: Partial<Claude360CanvasImage> = {}): Claude360CanvasImage {
  return {
    id: 'img_1',
    source: 'base64',
    b64Json: 'aGVsbG8=',
    mimeType: 'image/png',
    prompt: '一只猫',
    model: 'gpt-image-x',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

function urlImage(overrides: Partial<Claude360CanvasImage> = {}): Claude360CanvasImage {
  return {
    id: 'img_2',
    source: 'url',
    url: 'https://cdn.example/a.png',
    mimeType: 'image/png',
    prompt: 'a dog',
    model: 'flux-pro',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('imageDataUrl · base64 → dataURL / url 保留', () => {
  it('base64 图片拼成 data URL（含 mimeType 与 base64 载荷）', () => {
    expect(imageDataUrl(base64Image())).toBe('data:image/png;base64,aGVsbG8=')
  })
  it('base64 缺 mimeType 时回退到 image/png', () => {
    expect(imageDataUrl(base64Image({ mimeType: '' }))).toBe('data:image/png;base64,aGVsbG8=')
  })
  it('url 图片直接返回 url（不做 data URL 包装）', () => {
    expect(imageDataUrl(urlImage())).toBe('https://cdn.example/a.png')
  })
  it('损坏数据（base64 缺 b64Json）安全返回空串', () => {
    expect(imageDataUrl(base64Image({ b64Json: undefined }))).toBe('')
    expect(imageDataUrl(urlImage({ url: undefined }))).toBe('')
  })
})

describe('imageCopyUrl · 仅 url 图片可复制链接', () => {
  it('url 图片返回可复制的 http(s) 链接', () => {
    expect(imageCopyUrl(urlImage())).toBe('https://cdn.example/a.png')
  })
  it('base64 图片无可复制 URL，返回空串', () => {
    expect(imageCopyUrl(base64Image())).toBe('')
  })
  it('非 http(s) url 拒绝返回', () => {
    expect(imageCopyUrl(urlImage({ url: 'javascript:alert(1)' }))).toBe('')
  })
})

describe('safeImageFilename · 从 prompt/model/date 生成安全文件名', () => {
  it('清洗非法字符并带扩展名', () => {
    const name = safeImageFilename({
      prompt: 'a/b:c*猫?',
      model: 'gpt/image',
      createdAt: '2026-07-01T12:34:56.000Z',
      mimeType: 'image/png'
    })
    expect(name.endsWith('.png')).toBe(true)
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name).toContain('20260701')
  })
  it('jpeg mimeType 用 .jpg 扩展名', () => {
    const name = safeImageFilename({
      prompt: 'x',
      model: 'm',
      createdAt: '2026-07-01T00:00:00.000Z',
      mimeType: 'image/jpeg'
    })
    expect(name.endsWith('.jpg')).toBe(true)
  })
  it('空 prompt / 损坏日期安全兜底（不抛异常，仍带扩展名）', () => {
    const name = safeImageFilename({ prompt: '', model: '', createdAt: 'not-a-date', mimeType: '' })
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBeGreaterThan(4)
  })
})

describe('isDownloadableImage · base64 可下载 / url 可下载', () => {
  it('base64 有载荷可下载', () => {
    expect(isDownloadableImage(base64Image())).toBe(true)
  })
  it('url 有效可下载', () => {
    expect(isDownloadableImage(urlImage())).toBe(true)
  })
  it('两者皆空不可下载', () => {
    expect(isDownloadableImage(base64Image({ b64Json: undefined }))).toBe(false)
  })
})
