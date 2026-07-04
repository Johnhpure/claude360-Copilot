import { useState, type ChangeEvent, type ReactElement } from 'react'
import { Download, Music4, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'

type TFn = (key: string, opts?: Record<string, unknown>) => string

/**
 * 迷你播放条 MiniPlayerBar（Feature，阶段4 design §2.5；父任务 §4.4）。
 *
 * 底部常驻胶囊条（--radius-pill、surface-elevated、--c360-shadow-sm 极轻投影）：
 * 封面缩略 + 标题 + 上一首/播放/下一首 + 粗胶囊进度滑块（轨道 6px、已播放段 accent）+
 * 音量 + 下载。播放/拖拽逻辑沿用 music-player-store 现有 action——
 * 音频副作用由容器把 store 状态桥接到 <audio>，本组件纯展示 + 回调（仅换壳）。
 * 仅在 music 工作台内常驻（design §5：不做跨工作台全局播放条）。
 */
type Props = {
  current: Claude360Song | null
  playing: boolean
  currentTime: number
  duration: number
  volume: number // 0–1
  hasPrev: boolean
  hasNext: boolean
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onVolume: (volume: number) => void
  onPrev: () => void
  onNext: () => void
  onDownload: (song: Claude360Song) => void
  t: TFn
}

// 秒 → m:ss（非有限值显示 0:00）。
function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const mm = Math.floor(total / 60)
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// 副标题：曲风 tags 优先，否则中性文案；不暴露原始 audioUrl。
function playerSubtitle(song: Claude360Song, t: TFn): string {
  if (song.tags && song.tags.trim()) return song.tags.trim()
  return t('musicSongReady')
}

/** One UI 式粗胶囊滑块：6px 胶囊轨道 + accent 已播放段；拖拽走透明原生 range（保留原生交互）。 */
function PillSlider({
  value,
  max,
  step,
  disabled,
  ariaLabel,
  testId,
  onChange,
  className = ''
}: {
  value: number
  max: number
  step: number
  disabled?: boolean
  ariaLabel: string
  testId: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  className?: string
}): ReactElement {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0
  return (
    <div className={`relative flex h-4 items-center ${className}`}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ds-subtle" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
      <input
        type="range"
        data-testid={testId}
        aria-label={ariaLabel}
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      />
    </div>
  )
}

function PlayerCover({ song, t }: { song: Claude360Song; t: TFn }): ReactElement {
  const [failed, setFailed] = useState(false)
  if (song.imageUrl && !failed) {
    return (
      <img
        src={song.imageUrl}
        alt={t('musicCoverAlt', { title: song.title })}
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div
      data-testid="music-player-cover-placeholder"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ds-border bg-ds-main text-accent"
    >
      <Music4 className="h-4 w-4" strokeWidth={1.5} />
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function MiniPlayerBar({
  current,
  playing,
  currentTime,
  duration,
  volume,
  hasPrev,
  hasNext,
  onTogglePlay,
  onSeek,
  onVolume,
  onPrev,
  onNext,
  onDownload,
  t
}: Props): ReactElement {
  const pillShell =
    'rounded-full border border-ds-border bg-ds-elevated shadow-[var(--c360-shadow-sm)]'

  if (!current) {
    return (
      <footer
        data-testid="music-player"
        className={`flex h-12 items-center justify-center px-5 text-[12.5px] text-ds-faint ${pillShell}`}
      >
        {t('musicPlayerEmpty')}
      </footer>
    )
  }
  const handleSeek = (e: ChangeEvent<HTMLInputElement>): void => onSeek(Number(e.target.value))
  const handleVolume = (e: ChangeEvent<HTMLInputElement>): void => onVolume(Number(e.target.value))

  return (
    <footer
      data-testid="music-player"
      className={`flex items-center gap-3 py-1.5 pl-1.5 pr-4 ${pillShell}`}
    >
      {/* 封面 + 标题 / 副标题 */}
      <PlayerCover song={current} t={t} />
      <div className="w-40 min-w-0 shrink-0 sm:w-48">
        <div className="truncate text-[13px] font-medium text-ds-ink">{current.title}</div>
        <div className="truncate text-[11px] text-ds-faint" data-testid="music-player-subtitle">
          {playerSubtitle(current, t)}
        </div>
      </div>

      {/* 上一首 / 播放暂停 / 下一首 */}
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label={t('musicPrev')} onClick={onPrev} disabled={!hasPrev}>
          <SkipBack className="h-4 w-4" strokeWidth={2} />
        </IconButton>
        <button
          type="button"
          aria-label={playing ? t('musicPause') : t('musicPlay')}
          onClick={onTogglePlay}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white shadow-[var(--c360-shadow-sm)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--c360-accent-hover)]"
        >
          {playing ? <Pause className="h-4 w-4" strokeWidth={2} /> : <Play className="h-4 w-4" strokeWidth={2} />}
        </button>
        <IconButton label={t('musicNext')} onClick={onNext} disabled={!hasNext}>
          <SkipForward className="h-4 w-4" strokeWidth={2} />
        </IconButton>
      </div>

      {/* 进度：时间 + 粗胶囊滑块 */}
      <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-ds-faint">
        {fmtTime(currentTime)}
      </span>
      <PillSlider
        value={Math.min(currentTime, duration || 0)}
        max={duration > 0 ? duration : 0}
        step={0.1}
        disabled={duration <= 0}
        ariaLabel={t('musicSeek')}
        testId="music-player-seek"
        onChange={handleSeek}
        className="min-w-0 flex-1"
      />
      <span className="w-9 shrink-0 text-[10.5px] tabular-nums text-ds-faint">{fmtTime(duration)}</span>

      {/* 音量（窄屏隐藏）+ 下载 */}
      <div className="hidden shrink-0 items-center gap-2 md:flex">
        <Volume2 className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} aria-hidden />
        <PillSlider
          value={volume}
          max={1}
          step={0.01}
          ariaLabel={t('musicVolume')}
          testId="music-player-volume"
          onChange={handleVolume}
          className="w-20"
        />
      </div>
      <IconButton label={t('musicDownload')} onClick={() => onDownload(current)}>
        <Download className="h-4 w-4" strokeWidth={1.75} />
      </IconButton>
    </footer>
  )
}
