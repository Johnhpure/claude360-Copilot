import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { useState } from 'react'
import { Music4 } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'
import { Card } from '../ui'

type TFn = (key: string, opts?: Record<string, unknown>) => string

/**
 * 音乐作品卡 MusicCard（Feature，阶段4 design §2.4；父任务 §4.4）。
 *
 * 封面 --radius-md(12px) 圆角 + 标题 + 时长；播放态 = 封面角标蓝色 3-bar 波形动效
 * （accent + motion token，keyframes 见 ui-primitives.css 的 ds-ui-wave）。
 * 纯展示组件：播放/下载/删除等回调由 MusicTaskList 注入，不订阅任何 store；
 * 生成中的任务不走本卡，由 TaskCard（呼吸态）统一表达。
 */

/** 歌曲时长（秒）→ m:ss；缺失/非法返回空串（阶段4 从 MusicTaskList 收敛至此）。 */
export function formatSongDuration(song: Claude360Song): string {
  if (typeof song.duration === 'number' && song.duration > 0) {
    const total = Math.round(song.duration)
    const mm = Math.floor(total / 60)
    const ss = String(total % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }
  return ''
}

/** 封面占位（无封面/加载失败兜底）：token 渐变 + 播放态波形。 */
export function CoverPlaceholder({
  active,
  testId = 'music-cover-placeholder'
}: {
  active?: boolean
  testId?: string
}): ReactElement {
  return (
    <div
      data-testid={testId}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,var(--ds-accent-soft),transparent_36%),linear-gradient(135deg,var(--ds-surface-subtle),var(--ds-bg-canvas))]"
    >
      <Music4 className="h-9 w-9 text-ds-muted" strokeWidth={1.4} />
      {active ? (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <PlayingWave />
        </span>
      ) : null}
    </div>
  )
}

/** 播放态蓝色 3-bar 波形（design §2.4）：相位差走 motion token，节奏见 ui-primitives.css。 */
export function PlayingWave(): ReactElement {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden="true" data-testid="music-playing-wave">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`ds-ui-wave w-1 rounded-full bg-accent ${i === 1 ? 'h-4' : 'h-3'}`}
          style={{ animationDelay: `calc(var(--motion-fast) * ${i})` }}
        />
      ))}
    </span>
  )
}

/** 封面图：直连失败 → 注入的 media-blob 代理兜底 → 再失败回占位图。 */
export function MusicCoverImage({
  src,
  title,
  active,
  resolveCover,
  t
}: {
  src?: string
  title: string
  active?: boolean
  /** 直连加载失败时的代理兜底（容器注入 media-blob → objectURL）；再失败才回占位图。 */
  resolveCover?: (url: string) => Promise<string | null>
  t: TFn
}): ReactElement {
  // forSrc 绑定当前封面地址：src 变化（换卡片复用组件）时自动重置兜底状态。
  // proxyUrl === null 表示代理也失败，回占位图。
  const [fallback, setFallback] = useState<{ forSrc: string; proxyUrl: string | null } | null>(null)
  const proxyUrl = fallback && fallback.forSrc === src ? fallback.proxyUrl : undefined
  if (!src || proxyUrl === null) return <CoverPlaceholder active={active} />
  const displaySrc = proxyUrl ?? src
  const handleError = (): void => {
    // 打印失败 URL，方便排查（鉴权/跨域/字段映射错误）。
    if (proxyUrl) {
      console.error('[claude360-music] cover proxy objectURL load failed', { coverUrl: src })
      setFallback({ forSrc: src, proxyUrl: null })
      return
    }
    console.error('[claude360-music] cover image load failed, trying media-blob proxy', { coverUrl: src })
    if (!resolveCover) {
      setFallback({ forSrc: src, proxyUrl: null })
      return
    }
    resolveCover(src)
      .then((url) => setFallback({ forSrc: src, proxyUrl: url }))
      .catch((error) => {
        console.error('[claude360-music] cover proxy fetch threw', { coverUrl: src, error })
        setFallback({ forSrc: src, proxyUrl: null })
      })
  }
  return (
    <img
      src={displaySrc}
      alt={t('musicCoverAlt', { title })}
      loading="lazy"
      onError={handleError}
      className="h-full w-full object-cover transition-transform duration-[var(--motion-base)] ease-[var(--ease-oneui)] group-hover:scale-[1.03]"
    />
  )
}

type MusicCardProps = HTMLAttributes<HTMLDivElement> & {
  title: string
  /** 副文案（提示词摘要），同时作 title tooltip */
  subtitle?: string
  /** 已格式化的时长（m:ss），标题右侧展示 */
  duration?: string
  /** 元信息（模型/标签/时间等） */
  metaItems?: string[]
  coverUrl?: string
  /** 播放态：封面角标蓝色波形 + accent 描边 */
  playing?: boolean
  /** 批量选择态高亮 */
  selected?: boolean
  /** 点击封面（播放/暂停 或 批量选择切换） */
  onOpen?: () => void
  /** 封面按钮无障碍名称 */
  openLabel?: string
  /** 封面直连失败时的代理兜底 */
  resolveCover?: (url: string) => Promise<string | null>
  /** 封面覆盖层（状态角标/选择框等，调用方自带定位类） */
  overlay?: ReactNode
  /** 卡内提示（如缺少音频地址） */
  notice?: ReactNode
  /** 底部操作行 */
  actions?: ReactNode
  t: TFn
}

export function MusicCard({
  title,
  subtitle,
  duration,
  metaItems = [],
  coverUrl,
  playing = false,
  selected = false,
  onOpen,
  openLabel,
  resolveCover,
  overlay,
  notice,
  actions,
  className = '',
  t,
  ...rest
}: MusicCardProps): ReactElement {
  return (
    <Card
      variant="interactive"
      unpadded
      className={`group flex min-h-0 flex-col gap-2 p-2.5 ${
        playing || selected ? 'border-ds-accent ring-2 ring-ds-accent' : ''
      } ${className}`}
      {...rest}
    >
      {/* 封面区：--radius-md(12px) 圆角，统一 1:1 比例避免宫格高低不齐 */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={openLabel}
        title={subtitle || title}
        className="relative block aspect-square w-full overflow-hidden rounded-[var(--radius-md)] bg-ds-main"
      >
        <MusicCoverImage src={coverUrl} title={title} active={playing} resolveCover={resolveCover} t={t} />
        {playing && coverUrl ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-ds-card px-1.5 py-1">
            <PlayingWave />
          </span>
        ) : null}
        {overlay}
      </button>

      {/* 信息区：标题 + 时长 + 简短描述 + 操作行 */}
      <div className="flex flex-1 flex-col gap-1.5 px-1 pb-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="min-w-0 truncate text-[13.5px] font-semibold text-ds-ink" title={title}>
            {title}
          </h3>
          {duration ? (
            <span className="shrink-0 text-[11px] tabular-nums text-ds-faint">{duration}</span>
          ) : null}
        </div>
        {subtitle ? (
          <p className="line-clamp-1 text-[12px] leading-[18px] text-ds-muted" title={subtitle}>
            {subtitle}
          </p>
        ) : null}
        {notice}
        {metaItems.length > 0 ? (
          <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-ds-faint">
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
