// ArtworkGrid（作品宫格纯展示组件）测试：node 环境 renderToStaticMarkup + mock t 返回 key。
// 覆盖：空态、三态卡片（图片/loading/错误）、元信息、操作按钮禁用逻辑、选择模式。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArtworkGrid, formatArtworkTime } from './ArtworkGrid'
import type { CanvasArtwork } from '../../canvas/canvas-store'

function t(key: string): string {
  return key
}

function artwork(id: string, overrides: Partial<CanvasArtwork> = {}): CanvasArtwork {
  return {
    id,
    status: 'success',
    image: {
      id,
      source: 'url',
      url: `https://cdn.example/${id}.png`,
      mimeType: 'image/png',
      prompt: `p-${id}`,
      model: 'gpt-image-1',
      createdAt: '2026-07-02T08:30:00.000Z'
    },
    prompt: `p-${id}`,
    model: 'gpt-image-1',
    size: '2048x2048',
    quality: 'high',
    outputFormat: 'png',
    n: 1,
    createdAt: '2026-07-02T08:30:00.000Z',
    ...overrides
  }
}

function renderGrid(
  artworks: CanvasArtwork[],
  overrides: Partial<Parameters<typeof ArtworkGrid>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(ArtworkGrid, {
      artworks,
      selectMode: false,
      selectedIds: {},
      onToggleSelected: vi.fn(),
      onView: vi.fn(),
      onCopyPrompt: vi.fn(),
      onDownload: vi.fn(),
      onRegenerate: vi.fn(),
      onRemove: vi.fn(),
      t,
      ...overrides
    })
  )
}

describe('formatArtworkTime', () => {
  it('非法/缺失时间返回空串，合法 ISO 返回本地短格式', () => {
    expect(formatArtworkTime('')).toBe('')
    expect(formatArtworkTime('not-a-date')).toBe('')
    expect(formatArtworkTime('2026-07-02T08:30:00.000Z')).not.toBe('')
  })
})

describe('ArtworkGrid', () => {
  it('空列表渲染优雅空态', () => {
    const html = renderGrid([])
    expect(html).toContain('artwork-grid-empty')
    expect(html).toContain('canvasArtworksEmpty')
  })

  it('success 卡片：图片 + 状态标签 + 提示词摘要 + 元信息（模型/尺寸/质量/格式）', () => {
    const html = renderGrid([artwork('a')])
    expect(html).toContain('artwork-card')
    expect(html).toContain('https://cdn.example/a.png')
    expect(html).toContain('artwork-status-badge')
    expect(html).toContain('canvasStatus_success')
    expect(html).toContain('p-a')
    expect(html).toContain('gpt-image-1')
    expect(html).toContain('2048x2048')
    expect(html).toContain('high')
    expect(html).toContain('png')
  })

  it('pending 卡片：loading 占位，查看/下载/重新生成/删除禁用', () => {
    const html = renderGrid([artwork('run', { status: 'pending', image: undefined })])
    expect(html).toContain('canvasStatus_pending')
    expect(html).toContain('canvasArtworkGenerating')
    // 无图操作禁用（disabled 属性出现在按钮上）
    expect(html).toMatch(/data-testid="artwork-view-button"[^>]*"[^>]* disabled=""/)
    expect(html).toMatch(/data-testid="artwork-download-button"[^>]*"[^>]* disabled=""/)
    expect(html).toMatch(/data-testid="artwork-regenerate-button"[^>]*"[^>]* disabled=""/)
    expect(html).toMatch(/data-testid="artwork-delete-button"[^>]*"[^>]* disabled=""/)
  })

  it('failed 卡片：错误信息可见，重新生成/删除可用，查看/下载禁用', () => {
    const html = renderGrid([
      artwork('bad', { status: 'failed', image: undefined, error: 'server exploded' })
    ])
    expect(html).toContain('canvasStatus_failed')
    expect(html).toContain('server exploded')
    expect(html).toMatch(/data-testid="artwork-view-button"[^>]*"[^>]* disabled=""/)
    expect(html).toMatch(/data-testid="artwork-download-button"[^>]*"[^>]* disabled=""/)
    expect(html).not.toMatch(/data-testid="artwork-regenerate-button"[^>]*"[^>]* disabled=""/)
    expect(html).not.toMatch(/data-testid="artwork-delete-button"[^>]*"[^>]* disabled=""/)
  })

  it('选择模式：卡片渲染选择框，选中卡片带高亮 ring', () => {
    const html = renderGrid([artwork('a'), artwork('b')], {
      selectMode: true,
      selectedIds: { a: true }
    })
    expect(html.match(/artwork-select-box/g)?.length).toBe(2)
    expect(html).toContain('ring-2')
  })
})
