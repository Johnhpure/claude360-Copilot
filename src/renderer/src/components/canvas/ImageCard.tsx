import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { Card } from '../ui'

/**
 * 生图作品卡 ImageCard（Feature，阶段4 design §2.2；父任务 §4.3）。
 *
 * 基于 ui/Card interactive 变体：--radius-lg(16px) 圆角、hover 提亮 + 上浮 2px
 * （--motion-fast，由 Card 原语提供）。
 * loading 态：纯色 surface 占位 + 呼吸动效——keyframes 复用 ui-primitives.css 的
 * ds-ui-breathe（与 TaskCard 共用，DRY）。
 * 纯展示组件：点击/操作回调由 ArtworkGrid 注入，不订阅任何 store。
 */
type ImageCardProps = HTMLAttributes<HTMLDivElement> & {
  /** 图片地址；null（或 loading=true）时显示呼吸占位 */
  src: string | null
  alt: string
  /** 卡片主文案（提示词摘要，同时作图片区 title） */
  prompt: string
  /** 元信息（模型/尺寸/质量/格式/时间） */
  metaItems?: string[]
  /** 生成中占位：surface 呼吸块替代图片（design §2.2） */
  loading?: boolean
  /** 图片区覆盖层（状态角标/选择框等，调用方自带定位类） */
  overlay?: ReactNode
  /** 底部操作行 */
  actions?: ReactNode
  /** 点击图片区（打开 Lightbox / 选择切换） */
  onOpen?: () => void
  /** 图片区无障碍名称 */
  openLabel?: string
  /** 图片加载失败回调（排查鉴权/CSP 问题） */
  onImageError?: () => void
  /** 批量选择态高亮 */
  selected?: boolean
}

export function ImageCard({
  src,
  alt,
  prompt,
  metaItems = [],
  loading = false,
  overlay,
  actions,
  onOpen,
  openLabel,
  onImageError,
  selected = false,
  className = '',
  ...rest
}: ImageCardProps): ReactElement {
  return (
    <Card
      variant="interactive"
      unpadded
      className={`group flex flex-col overflow-hidden ${
        selected ? 'border-ds-accent ring-2 ring-ds-accent' : ''
      } ${className}`}
      {...rest}
    >
      {/* 图片 / 占位区：统一 1:1 比例避免宫格高低不齐 */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        title={prompt}
        className="relative block aspect-square w-full overflow-hidden bg-ds-main"
      >
        {loading || !src ? (
          <span
            aria-hidden="true"
            data-testid="image-card-placeholder"
            className="ds-ui-breathe absolute inset-0 bg-ds-subtle"
          />
        ) : (
          <img
            src={src}
            alt={alt}
            onError={onImageError}
            className="h-full w-full object-cover transition-transform duration-[var(--motion-base)] ease-[var(--ease-oneui)] group-hover:scale-[1.03]"
          />
        )}
        {overlay}
      </button>

      {/* 信息区：提示词摘要 + 元信息 + 操作行 */}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <p className="line-clamp-2 text-[12px] leading-[18px] text-ds-ink" title={prompt}>
          {prompt}
        </p>
        {metaItems.length > 0 ? (
          <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-ds-muted">
            {metaItems.map((item, index) => (
              <span key={`${item}-${index}`}>{item}</span>
            ))}
          </p>
        ) : null}
        {actions ? <div className="mt-auto flex items-center gap-0.5 pt-0.5">{actions}</div> : null}
      </div>
    </Card>
  )
}
