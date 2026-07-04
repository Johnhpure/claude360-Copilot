// ImageLightbox（基于 ui/Modal 的轻玻璃大图查看）测试。
// 注意：Modal 通过 createPortal 渲染，node 环境的 renderToStaticMarkup 不支持 portal，
// 故此处只覆盖关闭态/无图守卫（打开态视觉走双主题手测，见任务验收）。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageLightbox } from './ImageLightbox'

function t(key: string): string {
  return key
}

describe('ImageLightbox', () => {
  it('open=false 时不渲染任何内容', () => {
    const html = renderToStaticMarkup(
      createElement(ImageLightbox, {
        open: false,
        src: 'https://cdn.example/a.png',
        prompt: 'p',
        onClose: () => undefined,
        t
      })
    )
    expect(html).toBe('')
  })

  it('src 为空时守卫不渲染（即使 open）', () => {
    const html = renderToStaticMarkup(
      createElement(ImageLightbox, {
        open: true,
        src: null,
        prompt: 'p',
        onClose: () => undefined,
        t
      })
    )
    expect(html).toBe('')
  })
})
