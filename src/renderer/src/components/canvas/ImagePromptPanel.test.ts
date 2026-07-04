// ImagePromptPanel 静态渲染测试（生图重构：宽高比图标网格 + 分辨率 + 质量 + 输出格式 + 参考图）。
// node 环境、renderToStaticMarkup + 注入 props/mock t。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImagePromptPanel } from './ImagePromptPanel'

function t(key: string, opts?: Record<string, unknown>): string {
  if (opts && typeof opts.prompt === 'string') return `${key}:${opts.prompt}`
  return key
}

const base = {
  prompt: '',
  model: 'flux-pro',
  aspectPreset: 'square',
  resolution: '2K' as const,
  quality: 'auto' as const,
  outputFormat: 'png' as const,
  size: '2048x2048',
  n: 1,
  referenceImage: null,
  imageModels: ['flux-pro', 'dall-e-3'],
  generating: false,
  onChangePrompt: () => undefined,
  onChangeModel: () => undefined,
  onChangeAspect: () => undefined,
  onChangeResolution: () => undefined,
  onChangeQuality: () => undefined,
  onChangeOutputFormat: () => undefined,
  onChangeCount: () => undefined,
  onPickReference: () => undefined,
  onClearReference: () => undefined,
  onSubmit: () => undefined,
  onRefreshModels: () => undefined,
  t
}

describe('ImagePromptPanel · 工具型面板', () => {
  it('渲染 prompt / 模型 / 宽高比网格 / 分辨率 / 张数 / 质量 / 输出格式 / 生成按钮', () => {
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(html).toContain('image-prompt-panel')
    expect(html).toContain('image-prompt-input')
    expect(html).toContain('image-model-select')
    expect(html).toContain('image-aspect-square')
    expect(html).toContain('image-aspect-widescreen')
    expect(html).toContain('image-resolution-2K')
    expect(html).toContain('image-count-select')
    expect(html).toContain('image-quality-auto')
    expect(html).toContain('image-output-format-select')
    expect(html).toContain('image-generate-button')
    expect(html).toContain('canvasGenerate')
    // 尺寸预览显示派生像素
    expect(html).toContain('2048')
    // 断言不出现独立登录 / API Key 配置字样
    expect(html.toLowerCase()).not.toContain('api key')
    expect(html.toLowerCase()).not.toContain('apikey')
  })

  it('模型触发器展示当前选中的 image 模型（不硬编码 gpt-image-2）', () => {
    // 阶段4：原生 select 换 ui/Select（Popover 浮层），关闭态只渲染触发器与选中项。
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(html).toContain('image-model-select')
    expect(html).toContain('flux-pro')
    expect(html).not.toContain('gpt-image-2')
  })

  it('宽高比网格覆盖 10 档预设，含常见比例标签', () => {
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(html).toContain('1:1')
    expect(html).toContain('16:9')
    expect(html).toContain('9:16')
    expect(html).toContain('21:9')
    expect(html).toContain('image-aspect-exclusive')
  })

  it('无参考图时显示上传入口；有参考图时显示预览 + 移除', () => {
    const empty = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(empty).toContain('image-reference-input')
    expect(empty).toContain('canvasReferenceUpload')
    const withRef = renderToStaticMarkup(
      createElement(ImagePromptPanel, { ...base, referenceImage: 'data:image/png;base64,AAA' })
    )
    expect(withRef).toContain('image-reference-preview')
    expect(withRef).toContain('canvasReferenceRemove')
    expect(withRef).not.toContain('image-reference-input')
  })

  it('无 image 模型时显示空态 + 刷新按钮，生成按钮禁用', () => {
    const html = renderToStaticMarkup(
      createElement(ImagePromptPanel, { ...base, imageModels: [], model: '' })
    )
    expect(html).toContain('image-no-models')
    expect(html).toContain('canvasNoImageModels')
    expect(html).toContain('canvasRefreshModels')
    expect(html).toContain('disabled')
    expect(html).not.toContain('image-model-select')
  })

  it('生成中显示 canvasGenerating 且按钮禁用', () => {
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, { ...base, generating: true }))
    expect(html).toContain('canvasGenerating')
    expect(html).toContain('disabled')
  })
})
