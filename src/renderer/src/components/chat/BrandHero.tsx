import type { ReactElement } from 'react'

/**
 * 首页欢迎区品牌展示（07-05 home-brand-animation）：
 * 以动态文字「Claude360 Copilot」替换原 Logo 图片（KunHeroStage）。
 *
 * 动效组合（克制、低干扰，纯 CSS：transform/opacity/background-position）：
 * - 入场：两段文字先后淡入上浮（一次性）；
 * - 常驻：渐变流光缓慢扫过文字 + 低频呼吸发光；
 * - 底部：一条微弱的动态光线；
 * - `prefers-reduced-motion` 下全部持续动画停用（见 base-shell.css）。
 * 颜色全部来自 --ds-accent-gradient 等主题 token，明暗主题自适应。
 */
export function BrandHero(): ReactElement {
  return (
    <div className="ds-brand-hero" data-testid="brand-hero" aria-label="Claude360 Copilot">
      <h1 className="ds-brand-hero-title">
        <span className="ds-brand-hero-word ds-brand-hero-word-1">Claude360</span>{' '}
        <span className="ds-brand-hero-word ds-brand-hero-word-2">Copilot</span>
      </h1>
      <span className="ds-brand-hero-beam" aria-hidden="true" />
    </div>
  )
}
