// CanvasWorkbench 静态渲染测试（plan-06 Task 5）。
// node 环境：mock react-i18next（t 返回 key）+ 用真实 useCanvasStore（静态渲染不跑 useEffect）。
// 覆盖：首屏是工具型工作台（非营销 hero）、含 prompt/模型/尺寸/生成按钮、结果区、历史区；
// CanvasToolbar：无 image Key → 去我的页；低余额 → 去充值。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh' }
  })
}))

import { CanvasWorkbench } from './CanvasWorkbench'
import { CanvasToolbar } from './CanvasToolbar'
import { useCanvasStore } from '../../canvas/canvas-store'

function t(key: string): string {
  return key
}

function renderWorkbench(): string {
  return renderToStaticMarkup(
    createElement(CanvasWorkbench, {
      leftSidebarCollapsed: false,
      onToggleLeftSidebar: () => undefined,
      onOpenMy: () => undefined
    })
  )
}

describe('CanvasWorkbench · 首屏是工具型工作台', () => {
  beforeEach(() => {
    // 隔离残留状态：清干净历史与结果，避免其它用例污染。
    useCanvasStore.setState({ lastResult: [], history: [], error: null, activeImageId: null })
  })

  it('渲染工作台容器 + prompt/模型/比例/质量/生成按钮 + 结果区 + 历史区', () => {
    const html = renderWorkbench()
    expect(html).toContain('canvas-workbench')
    expect(html).toContain('canvasWorkbenchTitle')
    // 生图面板控件（宽高比图标网格 + 分辨率 + 质量 + 输出格式 + 参考图）
    expect(html).toContain('image-prompt-input')
    expect(html).toContain('image-aspect-square')
    expect(html).toContain('image-resolution-2K')
    expect(html).toContain('image-quality-auto')
    expect(html).toContain('image-output-format-select')
    expect(html).toContain('image-generate-button')
    // 已移除独立图像编辑面板
    expect(html).not.toContain('image-editor-panel')
    // 结果区（空态）+ 历史区
    expect(html).toContain('image-result-grid-empty')
    expect(html).toContain('image-history-panel')
  })

  it('首屏非营销 hero：不出现常见 landing 文案', () => {
    const html = renderWorkbench().toLowerCase()
    expect(html).not.toContain('get started for free')
    expect(html).not.toContain('sign up')
    // 不误进旧 infinite-canvas iframe
    expect(html).not.toContain('<iframe')
  })
})

describe('CanvasToolbar · 修复 / 低余额入口', () => {
  it('探测中（access=null）不渲染修复条', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, { access: null, lowBalance: false, onOpenMy: () => undefined, t })
    )
    expect(html).toBe('')
  })
  it('未登录显示 canvasNeedsLogin + 去我的页', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        access: { loggedIn: false, hasImageGroup: false },
        lowBalance: false,
        onOpenMy: () => undefined,
        t
      })
    )
    expect(html).toContain('canvas-fix-banner')
    expect(html).toContain('canvasNeedsLogin')
    expect(html).toContain('canvasGoToMy')
  })
  it('已登录但无 image 分组显示 canvasNeedsGroup', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        access: { loggedIn: true, hasImageGroup: false },
        lowBalance: false,
        onOpenMy: () => undefined,
        t
      })
    )
    expect(html).toContain('canvasNeedsGroup')
    expect(html).toContain('canvasGoToMy')
  })
  it('权限齐全 + 低余额显示充值入口', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        access: { loggedIn: true, hasImageGroup: true },
        lowBalance: true,
        onOpenMy: () => undefined,
        t
      })
    )
    expect(html).toContain('canvas-lowbalance-banner')
    expect(html).toContain('canvasLowBalance')
    expect(html).toContain('canvasTopup')
  })
  it('权限齐全且余额正常不渲染', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        access: { loggedIn: true, hasImageGroup: true },
        lowBalance: false,
        onOpenMy: () => undefined,
        t
      })
    )
    expect(html).toBe('')
  })
})
