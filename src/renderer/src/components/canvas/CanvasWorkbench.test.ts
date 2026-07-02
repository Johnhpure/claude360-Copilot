// CanvasWorkbench 静态渲染测试（plan-06 Task 5 → 作品宫格重构）。
// node 环境：mock react-i18next（t 返回 key）+ 用真实 useCanvasStore（静态渲染不跑 useEffect）。
// 覆盖：左右分栏结构（创作配置区 + 作品区）、作品管理栏、空态；
// 注意：zustand v5 在 renderToStaticMarkup 下读 getInitialState()，setState 注入不可见，
// 故非空作品的三态卡片/筛选/批量选择断言放在 ArtworkGrid.test.ts（props 注入）与
// canvas-store.test.ts（reducer 纯函数），此处只断初始结构。
// CanvasToolbar：低余额 → 去充值（分组模式下不再有「缺 Key 去我的页」初始化报错）。
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh' }
  })
}))

import { CanvasWorkbench } from './CanvasWorkbench'
import { CanvasToolbar } from './CanvasToolbar'

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

describe('CanvasWorkbench · 左右分栏工作台', () => {
  it('渲染 左=创作配置区（prompt/比例/质量/生成按钮），右=作品区（管理栏+空态）', () => {
    const html = renderWorkbench()
    expect(html).toContain('canvas-workbench')
    expect(html).toContain('canvasWorkbenchTitle')
    // 左右两个区域有清晰边界（独立 testid 容器）
    expect(html).toContain('canvas-config-pane')
    expect(html).toContain('canvas-artworks-pane')
    // 生图面板控件（宽高比图标网格 + 分辨率 + 质量 + 输出格式 + 参考图）
    expect(html).toContain('image-prompt-input')
    expect(html).toContain('image-aspect-square')
    expect(html).toContain('image-resolution-2K')
    expect(html).toContain('image-quality-auto')
    expect(html).toContain('image-output-format-select')
    expect(html).toContain('image-generate-button')
    // 管理栏：标题/数量/筛选/清空/批量选择
    expect(html).toContain('canvas-artworks-toolbar')
    expect(html).toContain('canvasArtworksTitle')
    expect(html).toContain('canvasArtworksCount')
    expect(html).toContain('canvasFilterAll')
    expect(html).toContain('canvas-clear-button')
    expect(html).toContain('canvas-batch-select-button')
    // 空态文案
    expect(html).toContain('artwork-grid-empty')
    expect(html).toContain('canvasArtworksEmpty')
  })

  it('首屏非营销 hero：不出现常见 landing 文案', () => {
    const html = renderWorkbench().toLowerCase()
    expect(html).not.toContain('get started for free')
    expect(html).not.toContain('sign up')
    // 不误进旧 infinite-canvas iframe
    expect(html).not.toContain('<iframe')
  })
})

describe('CanvasToolbar · 低余额入口', () => {
  it('低余额显示充值入口', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, { lowBalance: true, onOpenMy: () => undefined, t })
    )
    expect(html).toContain('canvas-lowbalance-banner')
    expect(html).toContain('canvasLowBalance')
    expect(html).toContain('canvasTopup')
  })
  it('余额正常不渲染', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, { lowBalance: false, onOpenMy: () => undefined, t })
    )
    expect(html).toBe('')
  })
})
