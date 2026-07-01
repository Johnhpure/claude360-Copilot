import type { ReactElement } from 'react'
import { Download, Music4, Pause, Play } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  current: Claude360Song | null
  playing: boolean
  onTogglePlay: () => void
  onDownload: (song: Claude360Song) => void
  t: TFn
}

// 副标题：曲风 tags / 时长优先，否则中性文案；不暴露原始 audioUrl。
function playerSubtitle(song: Claude360Song, t: TFn): string {
  const parts: string[] = []
  if (song.tags && song.tags.trim()) parts.push(song.tags.trim())
  if (typeof song.duration === 'number' && song.duration > 0) {
    const total = Math.round(song.duration)
    const mm = Math.floor(total / 60)
    const ss = String(total % 60).padStart(2, '0')
    parts.push(`${mm}:${ss}`)
  }
  return parts.length > 0 ? parts.join(' · ') : t('musicSongReady')
}

// 底部播放器条：展示当前歌曲标题 / 封面 / 状态副标题，提供播放-暂停与下载。
export function MusicPlayer({ current, playing, onTogglePlay, onDownload, t }: Props): ReactElement {
  if (!current) {
    return (
      <footer data-testid="music-player" className="rounded-2xl border border-ds-border bg-ds-card px-4 py-3 text-center text-[12.5px] text-ds-faint">
        {t('musicPlayerEmpty')}
      </footer>
    )
  }
  return (
    <footer
      data-testid="music-player"
      className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-card px-4 py-3"
    >
      {current.imageUrl ? (
        <img
          src={current.imageUrl}
          alt={t('musicCoverAlt', { title: current.title })}
          className="h-11 w-11 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-ds-main text-ds-faint">
          <Music4 className="h-5 w-5" strokeWidth={1.5} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ds-ink">{current.title}</div>
        <div className="truncate text-[11px] text-ds-faint" data-testid="music-player-subtitle">
          {playerSubtitle(current, t)}
        </div>
      </div>
      <button
        type="button"
        aria-label={playing ? t('musicPause') : t('musicPlay')}
        onClick={onTogglePlay}
        className="grid h-9 w-9 place-items-center rounded-full bg-ds-ink text-ds-main"
      >
        {playing ? <Pause className="h-4 w-4" strokeWidth={2} /> : <Play className="h-4 w-4" strokeWidth={2} />}
      </button>
      <button
        type="button"
        aria-label={t('musicDownload')}
        onClick={() => onDownload(current)}
        className="grid h-9 w-9 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
      >
        <Download className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </footer>
  )
}
