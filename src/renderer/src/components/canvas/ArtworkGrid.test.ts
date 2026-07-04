// ArtworkGrid（作品宫格纯展示组件）测试：node 环境 renderToStaticMarkup + mock t 返回 key。
// 阶段4 重构后：pending→TaskCard(running 呼吸)、failed→TaskCard(error+重试/删除)、
// success→ImageCard；覆盖空态、三态映射、元信息、操作按钮禁用逻辑、选择模式。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ArtworkGrid, formatArtworkTime, toTaskCardStatus } from './ArtworkGrid'
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

describe('toTaskCardStatus', () => {
  it('pending→running / failed→error / success→success', () => {
    expect(toTaskCardStatus('pending')).toBe('running')
    expect(toTaskCardStatus('failed')).toBe('error')
    expect(toTaskCardStatus('success')).toBe('success')
  })
})

describe('ArtworkGrid', () => {
  it('空列表渲染优雅空态', () => {
    const html = renderGrid([])
    expect(html).toContain('artwork-grid-empty')
    expect(html).toContain('canvasArtworksEmpty')
  })

  it('success 卡片（ImageCard）：图片 + 状态标签 + 提示词摘要 + 元信息（模型/尺寸/质量/格式）', () => {
    const html = renderGrid([artwork('a')])
    expect(html).toContain('artwork-card')
    expect(html).toContain('data-status="success"')
    expect(html).toContain('https://cdn.example/a.png')
    expect(html).toContain('artwork-status-badge')
    expect(html).toContain('canvasStatus_success')
    expect(html).toContain('p-a')
    expect(html).toContain('gpt-image-1')
    expect(html).toContain('2048x2048')
    expect(html).toContain('high')
    expect(html).toContain('png')
  })

  it('pending 卡片：TaskCard running 呼吸 + 不确定进度扫动，无 view/download/delete 操作', () => {
    const html = renderGrid([artwork('run', { status: 'pending', image: undefined })])
    expect(html).toContain('data-status="pending"')
    expect(html).toContain('ds-ui-breathe')
    expect(html).toContain('ds-ui-progress-sweep')
    expect(html).toContain('canvasArtworkGenerating')
    expect(html).not.toContain('artwork-view-button')
    expect(html).not.toContain('artwork-download-button')
    expect(html).not.toContain('artwork-delete-button')
  })

  it('failed 卡片：TaskCard error 态，错误信息可见，重新生成/删除可用', () => {
    const html = renderGrid([
      artwork('bad', { status: 'failed', image: undefined, error: 'server exploded' })
    ])
    expect(html).toContain('data-status="failed"')
    expect(html).toContain('server exploded')
    expect(html).toContain('artwork-regenerate-button')
    expect(html).toContain('artwork-delete-button')
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*data-testid="artwork-regenerate-button"/)
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*data-testid="artwork-delete-button"/)
  })

  it('busy（批次飞行中）时 failed 卡片的重新生成禁用', () => {
    const html = renderGrid(
      [artwork('bad', { status: 'failed', image: undefined, error: 'boom' })],
      { busy: true }
    )
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*data-testid="artwork-regenerate-button"/)
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
