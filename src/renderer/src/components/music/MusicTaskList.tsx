import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import {
  Copy,
  Download,
  Loader2,
  MoreHorizontal,
  Music4,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'
import type { MusicGenTask } from '../../music/music-task-store'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type MusicFilter = 'all' | 'success' | 'generating' | 'failure'

type WorkCard =
  | {
      kind: 'song'
      id: string
      task: MusicGenTask
      song: Claude360Song
      status: 'success'
    }
  | {
      kind: 'task'
      id: string
      task: MusicGenTask
      status: Exclude<MusicGenTask['status'], 'success'>
    }

const FILTERS: readonly MusicFilter[] = ['all', 'success', 'generating', 'failure']

const STATUS_LABEL_KEY: Record<MusicGenTask['status'], string> = {
  submitting: 'musicStatusSubmitting',
  queued: 'musicStatusQueued',
  in_progress: 'musicStatusInProgress',
  success: 'musicStatusSuccess',
  failure: 'musicStatusFailure'
}

const STATUS_CLASS: Record<MusicGenTask['status'], string> = {
  submitting: 'bg-accent-soft text-accent',
  queued: 'bg-accent-soft text-accent',
  in_progress: 'bg-accent-soft text-accent',
  success: 'bg-ds-success-soft text-ds-success',
  failure: 'bg-ds-danger-soft text-ds-danger'
}

function isGenerating(status: MusicGenTask['status']): boolean {
  return status === 'submitting' || status === 'queued' || status === 'in_progress'
}

function formatDuration(song: Claude360Song): string {
  if (typeof song.duration === 'number' && song.duration > 0) {
    const total = Math.round(song.duration)
    const mm = Math.floor(total / 60)
    const ss = String(total % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }
  return ''
}

function formatCreatedAt(createdAt: number): string {
  const date = new Date(createdAt)
  if (!Number.isFinite(createdAt) || Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function promptText(task: MusicGenTask): string {
  const prompt = task.params.prompt?.trim()
  if (prompt) return prompt
  const style = task.params.style?.trim()
  if (style) return style
  return task.title
}

function fallbackTitle(task: MusicGenTask, t: TFn): string {
  const text = promptText(task).replace(/\s+/g, ' ').trim()
  if (!text) return t('musicUntitled')
  return text.length > 18 ? `${text.slice(0, 18)}...` : text
}

function cardsFromTasks(tasks: MusicGenTask[]): WorkCard[] {
  const cards: WorkCard[] = []
  for (const task of tasks) {
    if (task.status === 'success') {
      cards.push(...task.songs.map((song): WorkCard => ({
        kind: 'song' as const,
        id: `song:${song.id}`,
        task,
        song,
        status: 'success' as const
      })))
      continue
    }
    cards.push({ kind: 'task', id: `task:${task.id}`, task, status: task.status })
  }
  return cards
}

function cardMatchesFilter(card: WorkCard, filter: MusicFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'success') return card.status === 'success'
  if (filter === 'failure') return card.status === 'failure'
  return card.status !== 'success' && isGenerating(card.status)
}

function filterLabel(filter: MusicFilter, t: TFn): string {
  if (filter === 'success') return t('musicFilterSuccess')
  if (filter === 'generating') return t('musicFilterGenerating')
  if (filter === 'failure') return t('musicFilterFailure')
  return t('musicFilterAll')
}

function cardTitle(card: WorkCard, t: TFn): string {
  if (card.kind === 'song') return card.song.title || fallbackTitle(card.task, t)
  return card.task.title || fallbackTitle(card.task, t)
}

function cardModel(card: WorkCard): string {
  if (card.kind === 'song' && card.song.modelName?.trim()) return card.song.modelName.trim()
  return String(card.task.params.model || '').trim()
}

function cardTags(card: WorkCard): string {
  if (card.kind === 'song' && card.song.tags?.trim()) return card.song.tags.trim()
  return card.task.params.style?.trim() ?? ''
}

function playableSongsForTask(task: MusicGenTask): Claude360Song[] {
  return task.songs.filter((song) => Boolean(song.audioUrl.trim()))
}

function ActionButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function CoverPlaceholder({ active, testId = 'music-cover-placeholder' }: { active?: boolean; testId?: string }): ReactElement {
  return (
    <div
      data-testid={testId}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,var(--ds-accent-soft),transparent_36%),linear-gradient(135deg,var(--ds-surface-subtle),var(--ds-bg-canvas))]"
    >
      <Music4 className="h-9 w-9 text-ds-muted" strokeWidth={1.4} />
      {active ? (
        <span className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-end gap-1" aria-hidden="true">
          <span className="h-3 w-1 rounded-full bg-accent animate-pulse" />
          <span className="h-5 w-1 rounded-full bg-accent animate-pulse" />
          <span className="h-4 w-1 rounded-full bg-accent animate-pulse" />
        </span>
      ) : null}
    </div>
  )
}

function MusicCoverImage({
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
      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
    />
  )
}

type Props = {
  tasks: MusicGenTask[]
  currentSongId: string | null
  playing: boolean
  onPlay: (song: Claude360Song, queue: Claude360Song[]) => void
  onPause: () => void
  onDownload: (song: Claude360Song) => void
  onRemoveTask: (id: string) => void
  onRemoveSong: (id: string) => void
  onClear: () => void
  onCopyPrompt: (prompt: string) => void
  onRegenerate: (task: MusicGenTask) => void
  /** 封面直连失败时的代理兜底（media-blob → objectURL）。 */
  resolveCover?: (url: string) => Promise<string | null>
  t: TFn
}

// 音乐作品宫格。纯 UI 状态（筛选/批量选择）留在组件内；生成、播放、删除等副作用由容器注入。
export function MusicTaskList({
  tasks,
  currentSongId,
  playing,
  onPlay,
  onPause,
  onDownload,
  onRemoveTask,
  onRemoveSong,
  onClear,
  onCopyPrompt,
  onRegenerate,
  resolveCover,
  t
}: Props): ReactElement {
  const [filter, setFilter] = useState<MusicFilter>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({})

  const allCards = useMemo(() => cardsFromTasks(tasks), [tasks])
  const visibleCards = useMemo(() => allCards.filter((card) => cardMatchesFilter(card, filter)), [allCards, filter])
  const selectedCount = Object.keys(selectedIds).length

  const toggleSelectMode = (): void => {
    setSelectMode((v) => !v)
    if (selectMode) setSelectedIds({})
  }

  const toggleSelected = (id: string): void => {
    setSelectedIds((prev) => {
      if (prev[id]) {
        const { [id]: _removed, ...next } = prev
        return next
      }
      return { ...prev, [id]: true }
    })
  }

  const removeSelected = (): void => {
    for (const id of Object.keys(selectedIds)) {
      if (id.startsWith('song:')) onRemoveSong(id.slice('song:'.length))
      if (id.startsWith('task:')) onRemoveTask(id.slice('task:'.length))
    }
    setSelectedIds({})
    setSelectMode(false)
  }

  return (
    <section data-testid="music-task-list" className="flex min-h-0 flex-col gap-3">
      <div
        data-testid="music-works-toolbar"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 shadow-sm"
      >
        <h2 className="text-[14px] font-semibold text-ds-ink">{t('musicWorksTitle')}</h2>
        <span className="text-[12px] text-ds-muted">{t('musicWorksCount', { count: allCards.length })}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1" role="tablist">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={filter === item}
              onClick={() => setFilter(item)}
              className={`rounded-md px-2 py-1 text-[12px] transition ${
                filter === item ? 'bg-ds-hover font-medium text-ds-ink' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {filterLabel(item, t)}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-ds-border" aria-hidden="true" />
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-[12px] text-ds-muted transition hover:text-ds-ink"
          >
            {t('musicClearAll')}
          </button>
          {selectMode ? (
            <>
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={removeSelected}
                className="rounded-md px-2 py-1 text-[12px] text-red-300 transition hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('musicBatchDelete', { count: selectedCount })}
              </button>
              <button
                type="button"
                onClick={toggleSelectMode}
                className="rounded-md px-2 py-1 text-[12px] text-ds-muted transition hover:text-ds-ink"
              >
                {t('musicBatchCancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={toggleSelectMode}
              className="rounded-md px-2 py-1 text-[12px] text-ds-muted transition hover:text-ds-ink"
            >
              {t('musicBatchSelect')}
            </button>
          )}
        </div>
      </div>

      {allCards.length === 0 ? (
        <div
          data-testid="music-works-empty"
          className="flex min-h-[260px] flex-1 items-center justify-center rounded-2xl border border-dashed border-ds-border bg-ds-card px-6 text-center"
        >
          <div className="max-w-[280px]">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Music4 className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <p className="mt-3 text-[13px] leading-5 text-ds-muted">{t('musicWorksEmpty')}</p>
          </div>
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-ds-border bg-ds-card px-6 text-center text-[13px] text-ds-muted">
          {t('musicFilterEmpty')}
        </div>
      ) : (
        <div
          data-testid="music-song-grid"
          className="grid min-h-0 gap-3.5"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
        >
          {visibleCards.map((card) => {
            const task = card.task
            const isSong = card.kind === 'song'
            const song = isSong ? card.song : null
            const prompt = promptText(task)
            const status = card.status
            const isPlaying = Boolean(song && playing && currentSongId === song.id)
            const title = cardTitle(card, t)
            const model = cardModel(card)
            const tags = cardTags(card)
            const duration = song ? formatDuration(song) : ''
            const createdAt = formatCreatedAt(task.createdAt)
            const meta = [
              model,
              tags,
              duration,
              createdAt,
              task.params.instrumental ? t('musicInstrumental') : ''
            ].filter(Boolean)
            const selected = Boolean(selectedIds[card.id])
            const queue = playableSongsForTask(task)
            const canPlay = Boolean(song?.audioUrl.trim())
            return (
              <article
                key={card.id}
                data-testid="music-work-card"
                data-status={status}
                data-playing={isPlaying ? 'true' : undefined}
                className={`group flex min-h-0 flex-col overflow-hidden rounded-xl border bg-ds-card transition ${
                  isPlaying ? 'border-accent ring-2 ring-accent/20 shadow-panel' : selected ? 'border-accent ring-2 ring-accent/20' : 'border-ds-border hover:border-accent hover:bg-ds-hover'
                }`}
              >
                <div className="relative aspect-square overflow-hidden bg-ds-main">
                  <MusicCoverImage
                    src={song?.imageUrl}
                    title={title}
                    active={isPlaying || isGenerating(status)}
                    resolveCover={resolveCover}
                    t={t}
                  />
                  <span
                    className={`absolute left-2 top-2 rounded-md px-2 py-1 text-[11px] font-medium backdrop-blur ${STATUS_CLASS[status]}`}
                  >
                    {t(STATUS_LABEL_KEY[status])}
                  </span>
                  {isGenerating(status) ? (
                    <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[12px] text-ds-ink shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={1.75} />
                      {t('musicWorkGenerating')}
                    </span>
                  ) : null}
                  {isPlaying ? (
                    <span className="absolute right-2 top-2 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-white">
                      {t('musicPlaying')}
                    </span>
                  ) : null}
                  {selectMode ? (
                    <button
                      type="button"
                      aria-label={t('musicBatchToggle')}
                      onClick={() => toggleSelected(card.id)}
                      className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md border text-[11px] ${
                        selected ? 'border-accent bg-accent text-white' : 'border-ds-border bg-ds-card text-transparent'
                      }`}
                    >
                      ✓
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[13.5px] font-semibold text-ds-ink" title={title}>
                      {title}
                    </h3>
                    <p className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-[18px] text-ds-muted" title={prompt}>
                      {prompt || t('musicPromptEmpty')}
                    </p>
                  </div>

                  {status === 'failure' ? (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-2.5 py-2 text-[12px] leading-4 text-red-200">
                      <div className="flex items-start gap-2">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                        <span>{task.failReason || t('musicStatusFailure')}</span>
                      </div>
                    </div>
                  ) : null}

                  {song && !canPlay ? (
                    <div
                      data-testid="music-audio-missing"
                      className="rounded-lg border border-ds-border bg-accent-soft px-2.5 py-2 text-[12px] leading-4 text-accent"
                    >
                      {t('musicAudioMissing')}
                    </div>
                  ) : null}

                  <p className="flex min-h-9 flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-ds-faint">
                    {meta.map((item, index) => (
                      <span key={`${item}-${index}`}>{item}</span>
                    ))}
                  </p>

                  <div className="mt-auto flex items-center gap-0.5 pt-1">
                    <ActionButton
                      label={isPlaying ? t('musicPause') : t('musicPlay')}
                      disabled={!canPlay}
                      onClick={song && canPlay ? () => (isPlaying ? onPause() : onPlay(song, queue)) : undefined}
                    >
                      {isPlaying ? <Pause className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Play className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    </ActionButton>
                    <ActionButton
                      label={t('musicDownload')}
                      disabled={!canPlay}
                      onClick={song ? () => onDownload(song) : undefined}
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                    <ActionButton
                      label={t('musicCopyPrompt')}
                      disabled={!prompt}
                      onClick={() => onCopyPrompt(prompt)}
                    >
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                    <ActionButton label={status === 'failure' ? t('musicRetry') : t('musicRegenerate')} onClick={() => onRegenerate(task)}>
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                    <ActionButton
                      label={t('musicDelete')}
                      onClick={() => (song ? onRemoveSong(song.id) : onRemoveTask(task.id))}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                    <ActionButton label={t('musicMoreActions')}>
                      <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
