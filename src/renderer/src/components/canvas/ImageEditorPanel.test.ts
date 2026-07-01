// ImageEditorPanel 静态渲染测试（plan-06 Task 5）。
// 覆盖：上传区、编辑 prompt、编辑按钮；未上传时禁用并提示需上传；上传后显示预览。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImageEditorPanel } from './ImageEditorPanel'

function t(key: string): string {
  return key
}

const base = {
  editPrompt: '',
  sourceDataUrl: '',
  editing: false,
  hasModels: true,
  onChangePrompt: () => undefined,
  onPickFile: () => undefined,
  onSubmit: () => undefined,
  t
}

describe('ImageEditorPanel · 图片编辑面板', () => {
  it('渲染上传区 / 编辑 prompt / 编辑按钮', () => {
    const html = renderToStaticMarkup(createElement(ImageEditorPanel, base))
    expect(html).toContain('image-editor-panel')
    expect(html).toContain('image-editor-file-input')
    expect(html).toContain('image-editor-prompt')
    expect(html).toContain('image-edit-button')
    expect(html).toContain('canvasUploadImage')
  })

  it('未上传源图时按钮禁用并提示需上传', () => {
    const html = renderToStaticMarkup(createElement(ImageEditorPanel, base))
    expect(html).toContain('canvasEditNeedsImage')
    expect(html).toContain('disabled')
  })

  it('已上传 + 有 prompt 时显示预览且按钮可用', () => {
    const html = renderToStaticMarkup(
      createElement(ImageEditorPanel, {
        ...base,
        sourceDataUrl: 'data:image/png;base64,AAA',
        editPrompt: '加个帽子'
      })
    )
    expect(html).toContain('image-editor-preview')
    expect(html).toContain('data:image/png;base64,AAA')
    // 满足条件时按钮不带 disabled 属性（className 里的 disabled: 变体不算）
    expect(html).not.toContain('disabled=""')
  })

  it('编辑中显示 canvasEditing', () => {
    const html = renderToStaticMarkup(
      createElement(ImageEditorPanel, {
        ...base,
        sourceDataUrl: 'data:image/png;base64,AAA',
        editPrompt: 'x',
        editing: true
      })
    )
    expect(html).toContain('canvasEditing')
    expect(html).toContain('disabled=""')
  })
})
