import { useState, type ChangeEvent, type ReactElement } from 'react'
import { Download, Music4, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'

type TFn = (key: string, opts?: Record<string, unknown>) => string

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

function PlayerCover({ song, t }: { song: Claude360Song; t: TFn }): ReactElement {
  const [failed, setFailed] = useState(false)
  if (song.imageUrl && !failed) {
    return (
      <img
        src={song.imageUrl}
        alt={t('musicCoverAlt', { title: song.title })}
        onError={() => setFailed(true)}
        className="h-11 w-11 shrink-0 rounded-lg object-cover"
      />
    )
  }
  return (
    <div
      data-testid="music-player-cover-placeholder"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-ds-border bg-ds-main text-accent"
    >
      <Music4 className="h-5 w-5" strokeWidth={1.5} />
    </div>
  )
}

// 底部增强播放器：封面 / 标题 / 副标题 + 上一首·播放暂停·下一首 + 进度条(可拖动) +
// 音量 + 下载。音频副作用由容器把 store 状态桥接到 <audio>，本组件纯展示 + 回调。
export function MusicPlayer({
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
  if (!current) {
    return (
      <footer
        data-testid="music-player"
        className="rounded-2xl border border-ds-border bg-ds-card px-4 py-3 text-center text-[12.5px] text-ds-faint"
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
      className="flex flex-col gap-2.5 rounded-2xl border border-ds-border bg-ds-card px-4 py-3 shadow-panel"
    >
      <div className="flex items-center gap-3">
        <PlayerCover song={current} t={t} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ds-ink">{current.title}</div>
          <div className="truncate text-[11px] text-ds-faint" data-testid="music-player-subtitle">
            {playerSubtitle(current, t)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('musicPrev')}
            onClick={onPrev}
            disabled={!hasPrev}
            className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SkipBack className="h-4 w-4" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label={playing ? t('musicPause') : t('musicPlay')}
            onClick={onTogglePlay}
            className="grid h-9 w-9 place-items-center rounded-full bg-accent text-white shadow-sm transition hover:opacity-90"
          >
            {playing ? <Pause className="h-4 w-4" strokeWidth={2} /> : <Play className="h-4 w-4" strokeWidth={2} />}
          </button>
          <button
            type="button"
            aria-label={t('musicNext')}
            onClick={onNext}
            disabled={!hasNext}
            className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SkipForward className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 进度条 + 时间 */}
      <div className="flex items-center gap-2.5">
        <span className="w-9 shrink-0 text-right text-[10.5px] tabular-nums text-ds-faint">{fmtTime(currentTime)}</span>
        <input
          type="range"
          data-testid="music-player-seek"
          aria-label={t('musicSeek')}
          min={0}
          max={duration > 0 ? duration : 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          disabled={duration <= 0}
          onChange={handleSeek}
          className="h-1 flex-1 accent-[color:var(--ds-accent)]"
        />
        <span className="w-9 shrink-0 text-[10.5px] tabular-nums text-ds-faint">{fmtTime(duration)}</span>
      </div>

      {/* 音量 + 下载 */}
      <div className="flex items-center gap-2.5">
        <Volume2 className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
        <input
          type="range"
          data-testid="music-player-volume"
          aria-label={t('musicVolume')}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={handleVolume}
          className="h-1 w-24 accent-[color:var(--ds-accent)]"
        />
        <div className="flex-1" />
        <button
          type="button"
          aria-label={t('musicDownload')}
          onClick={() => onDownload(current)}
          className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <Download className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </footer>
  )
}
