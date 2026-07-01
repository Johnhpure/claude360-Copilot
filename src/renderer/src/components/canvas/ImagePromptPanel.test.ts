// ImagePromptPanel 静态渲染测试（plan-06 Task 5+7）。
// node 环境、renderToStaticMarkup + 注入 props/mock t。
// 覆盖：是工具型面板（prompt/模型/尺寸/张数/生成按钮）、image 模型下拉、
// 无 image 模型显示空态 + 刷新按钮（Task7）、生成态禁用。
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
  size: '1024x1024' as const,
  n: 1,
  imageModels: ['flux-pro', 'dall-e-3'],
  generating: false,
  onChangePrompt: () => undefined,
  onChangeModel: () => undefined,
  onChangeSize: () => undefined,
  onChangeCount: () => undefined,
  onSubmit: () => undefined,
  onRefreshModels: () => undefined,
  t
}

describe('ImagePromptPanel · 工具型面板', () => {
  it('渲染 prompt 输入 / 模型选择 / 尺寸 / 张数 / 生成按钮', () => {
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(html).toContain('image-prompt-panel')
    expect(html).toContain('image-prompt-input')
    expect(html).toContain('image-model-select')
    expect(html).toContain('image-size-select')
    expect(html).toContain('image-count-select')
    expect(html).toContain('image-generate-button')
    expect(html).toContain('canvasGenerate')
    // 断言不出现独立登录 / API Key 配置字样
    expect(html.toLowerCase()).not.toContain('api key')
    expect(html.toLowerCase()).not.toContain('apikey')
  })

  it('模型下拉展示传入的 image 模型（不硬编码 gpt-image-2）', () => {
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(html).toContain('flux-pro')
    expect(html).toContain('dall-e-3')
    expect(html).not.toContain('gpt-image-2')
  })

  it('无 image 模型时显示空态 + 刷新按钮，生成按钮禁用（Task7）', () => {
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

  it('尺寸下拉包含 auto 等允许集合', () => {
    const html = renderToStaticMarkup(createElement(ImagePromptPanel, base))
    expect(html).toContain('1024x1024')
    expect(html).toContain('auto')
  })
})
