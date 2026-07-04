// ImageCard（生图作品卡 Feature）测试：node 环境 renderToStaticMarkup。
// 覆盖：图片态、loading 呼吸占位、选中高亮、元信息与操作行插槽。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageCard } from './ImageCard'

function render(overrides: Partial<Parameters<typeof ImageCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ImageCard, {
      src: 'https://cdn.example/a.png',
      alt: 'alt-a',
      prompt: 'prompt-a',
      ...overrides
    })
  )
}

describe('ImageCard', () => {
  it('默认渲染图片 + 提示词摘要，interactive hover 上浮由 Card 变体提供', () => {
    const html = render()
    expect(html).toContain('https://cdn.example/a.png')
    expect(html).toContain('alt-a')
    expect(html).toContain('prompt-a')
    // Card interactive 变体（hover 上浮 2px）
    expect(html).toContain('hover:-translate-y-0.5')
    expect(html).not.toContain('image-card-placeholder')
  })

  it('loading 态显示呼吸占位（复用 ds-ui-breathe keyframes），不渲染 img', () => {
    const html = render({ loading: true })
    expect(html).toContain('image-card-placeholder')
    expect(html).toContain('ds-ui-breathe')
    expect(html).not.toContain('<img')
  })

  it('src 为空时同样回退占位', () => {
    const html = render({ src: null })
    expect(html).toContain('image-card-placeholder')
    expect(html).not.toContain('<img')
  })

  it('selected 时渲染 accent ring 高亮', () => {
    expect(render({ selected: true })).toContain('ring-ds-accent')
    expect(render({ selected: false })).not.toContain('ring-ds-accent')
  })

  it('metaItems / actions / overlay 插槽渲染', () => {
    const html = render({
      metaItems: ['gpt-image-1', '2048x2048'],
      actions: createElement('button', { 'data-testid': 'slot-action' }, 'act'),
      overlay: createElement('span', { 'data-testid': 'slot-overlay' }, 'ov')
    })
    expect(html).toContain('gpt-image-1')
    expect(html).toContain('2048x2048')
    expect(html).toContain('slot-action')
    expect(html).toContain('slot-overlay')
  })
})
