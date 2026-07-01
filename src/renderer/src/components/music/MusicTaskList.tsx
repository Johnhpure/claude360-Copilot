import type { ReactElement } from 'react'
import { Download, Loader2, Music4, Play, Trash2, XCircle } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'
import type { MusicGenTask } from '../../music/music-task-store'

type TFn = (key: string, opts?: Record<string, unknown>) => string

// 歌曲副标题：优先展示有意义信息（曲风 tags / 时长），否则中性「已生成」文案；
// 绝不把原始 audioUrl 作为可见文本暴露给用户。
function songSubtitle(song: Claude360Song, t: TFn): string {
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

type Props = {
  tasks: MusicGenTask[]
  onPlay: (song: Claude360Song, queue: Claude360Song[]) => void
  onDownload: (song: Claude360Song) => void
  onRemove: (id: string) => void
  t: TFn
}

const STATUS_LABEL_KEY: Record<MusicGenTask['status'], string> = {
  submitting: 'musicStatusSubmitting',
  queued: 'musicStatusQueued',
  in_progress: 'musicStatusInProgress',
  success: 'musicStatusSuccess',
  failure: 'musicStatusFailure'
}

// 任务列表 + 成功歌曲卡片。纯展示：播放/下载/删除都通过回调注入。
export function MusicTaskList({ tasks, onPlay, onDownload, onRemove, t }: Props): ReactElement {
  if (tasks.length === 0) {
    return (
      <section data-testid="music-task-list" className="rounded-2xl border border-ds-border bg-ds-card p-6 text-center">
        <Music4 className="mx-auto h-6 w-6 text-ds-faint" strokeWidth={1.5} />
        <p className="mt-2 text-[13px] text-ds-faint">{t('musicTaskEmpty')}</p>
      </section>
    )
  }
  return (
    <section data-testid="music-task-list" className="flex flex-col gap-3">
      {tasks.map((task) => {
        const inFlight = task.status === 'submitting' || task.status === 'queued' || task.status === 'in_progress'
        const songs = task.songs
        return (
          <article key={task.id} className="rounded-2xl border border-ds-border bg-ds-card p-4">
            <header className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {inFlight ? <Loader2 className="h-4 w-4 animate-spin text-ds-muted" strokeWidth={1.75} /> : null}
                {task.status === 'failure' ? <XCircle className="h-4 w-4 text-red-500" strokeWidth={1.75} /> : null}
                <h3 className="min-w-0 truncate text-[13.5px] font-medium text-ds-ink">{task.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-ds-main px-2 py-0.5 text-[11px] text-ds-muted">
                  {t(STATUS_LABEL_KEY[task.status])}
                </span>
                <button
                  type="button"
                  aria-label={t('musicRemoveTask')}
                  onClick={() => onRemove(task.id)}
                  className="text-ds-faint hover:text-ds-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            </header>

            {task.status === 'failure' && task.failReason ? (
              <p className="mt-2 text-[12px] text-red-600 dark:text-red-300">{task.failReason}</p>
            ) : null}

            {songs.length > 0 ? (
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {songs.map((song) => (
                  <li
                    key={song.id}
                    data-testid="music-song-card"
                    className="flex items-center gap-3 rounded-xl border border-ds-border bg-ds-main p-2"
                  >
                    {song.imageUrl ? (
                      <img
                        src={song.imageUrl}
                        alt={t('musicCoverAlt', { title: song.title })}
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ds-card text-ds-faint">
                        <Music4 className="h-5 w-5" strokeWidth={1.5} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-ds-ink">{song.title}</div>
                      <div className="truncate text-[11px] text-ds-faint">{songSubtitle(song, t)}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={t('musicPlay')}
                        onClick={() => onPlay(song, songs)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                      >
                        <Play className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('musicDownload')}
                        onClick={() => onDownload(song)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                      >
                        <Download className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        )
      })}
    </section>
  )
}
