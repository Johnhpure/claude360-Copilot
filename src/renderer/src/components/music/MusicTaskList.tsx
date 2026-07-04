import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { Copy, Download, Music4, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'
import type { MusicGenTask } from '../../music/music-task-store'
import { Button, Card, EmptyState } from '../ui'
import { TaskCard, type TaskCardStatus } from '../task'
import { MusicCard, formatSongDuration } from './MusicCard'

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

function isGenerating(status: MusicGenTask['status']): boolean {
  return status === 'submitting' || status === 'queued' || status === 'in_progress'
}

/** 任务状态 → TaskCard 三态映射（阶段4 design §4：纯函数收敛，便于测试）。 */
export function toTaskCardStatus(status: MusicGenTask['status']): TaskCardStatus {
  if (status === 'failure') return 'error'
  if (status === 'success') return 'success'
  return 'running'
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

/** 工具栏胶囊 chip（筛选/清空/批量入口）：Calm Blue 小控件走 pill。 */
function ToolbarChip({
  active,
  danger,
  disabled,
  onClick,
  role,
  ariaSelected,
  children
}: {
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
  role?: string
  ariaSelected?: boolean
  children: ReactElement | string
}): ReactElement {
  const tone = active
    ? 'bg-ds-accent-soft font-medium text-ds-accent'
    : danger
      ? 'text-ds-danger hover:bg-ds-danger-soft'
      : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  return (
    <button
      type="button"
      role={role}
      aria-selected={ariaSelected}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[12px] transition-colors duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  )
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
      className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** 批量选择角标（封面右上角覆盖层）。 */
function SelectBox({ selected }: { selected: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] border text-[11px] ${
        selected ? 'border-ds-accent bg-ds-accent text-white' : 'border-ds-border bg-ds-card text-transparent'
      }`}
    >
      ✓
    </span>
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

// 音乐作品宫格（阶段4 迁移）：生成任务全链路走统一视觉——
//   submitting/queued/in_progress → TaskCard（running 呼吸 + 不确定进度扫动）
//   failure → TaskCard（error 态 + 失败原因 + 重试/删除）
//   success → MusicCard（封面 12px 圆角 + 播放态波形）
// 状态映射用纯函数 toTaskCardStatus；卡间距 16px（Calm Blue 语义常量）。
// 纯 UI 状态（筛选/批量选择）留在组件内；生成、播放、删除等副作用由容器注入。
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
    <section data-testid="music-task-list" className="flex min-h-0 flex-col gap-4">
      {/* 作品管理栏：标题/数量 + 状态筛选（胶囊 chip）+ 清空 / 批量选择 */}
      <div
        data-testid="music-works-toolbar"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2"
      >
        <h2 className="text-[13.5px] font-medium text-ds-ink">{t('musicWorksTitle')}</h2>
        <span className="text-[12px] text-ds-muted">{t('musicWorksCount', { count: allCards.length })}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1" role="tablist">
          {FILTERS.map((item) => (
            <ToolbarChip
              key={item}
              role="tab"
              ariaSelected={filter === item}
              active={filter === item}
              onClick={() => setFilter(item)}
            >
              {filterLabel(item, t)}
            </ToolbarChip>
          ))}
          <span className="mx-1 h-4 w-px bg-ds-border" aria-hidden="true" />
          <ToolbarChip onClick={onClear}>{t('musicClearAll')}</ToolbarChip>
          {selectMode ? (
            <>
              <ToolbarChip danger disabled={selectedCount === 0} onClick={removeSelected}>
                {t('musicBatchDelete', { count: selectedCount })}
              </ToolbarChip>
              <ToolbarChip onClick={toggleSelectMode}>{t('musicBatchCancel')}</ToolbarChip>
            </>
          ) : (
            <ToolbarChip onClick={toggleSelectMode}>{t('musicBatchSelect')}</ToolbarChip>
          )}
        </div>
      </div>

      {allCards.length === 0 ? (
        <Card
          data-testid="music-works-empty"
          className="flex min-h-[260px] flex-1 items-center justify-center border-dashed"
        >
          <EmptyState icon={Music4} title={t('musicWorksEmpty')} />
        </Card>
      ) : visibleCards.length === 0 ? (
        <Card className="flex min-h-[220px] items-center justify-center border-dashed">
          <EmptyState icon={Music4} title={t('musicFilterEmpty')} />
        </Card>
      ) : (
        <div
          data-testid="music-song-grid"
          className="grid min-h-0 items-start gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
        >
          {visibleCards.map((card) => {
            const task = card.task
            const prompt = promptText(task)
            const status = card.status
            const title = cardTitle(card, t)
            const selected = Boolean(selectedIds[card.id])

            // 非 success：统一 TaskCard 表达（running 呼吸 / failure 重试）
            if (card.kind !== 'song') {
              const failed = status === 'failure'
              return (
                <div
                  key={card.id}
                  data-testid="music-work-card"
                  data-status={status}
                  onClick={selectMode ? () => toggleSelected(card.id) : undefined}
                  className={`relative ${selected ? 'rounded-xl ring-2 ring-ds-accent' : ''} ${
                    selectMode ? 'cursor-pointer' : ''
                  }`}
                >
                  <TaskCard
                    status={toTaskCardStatus(status)}
                    title={title}
                    meta={t(STATUS_LABEL_KEY[status])}
                  >
                    {failed ? (
                      <div className="flex flex-col gap-2">
                        <p className="line-clamp-3 text-[12px] leading-[18px] text-ds-danger">
                          {task.failReason || t('musicStatusFailure')}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {/* TaskCard 内置 Retry 文案未接 i18n，操作在展开区用本地化按钮表达 */}
                          <Button variant="secondary" size="sm" onClick={() => onRegenerate(task)}>
                            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                            {t('musicRetry')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-ds-danger hover:text-ds-danger"
                            onClick={() => onRemoveTask(task.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                            {t('musicDelete')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[12px] text-ds-muted">{t('musicWorkGenerating')}</p>
                    )}
                  </TaskCard>
                  {selectMode ? <SelectBox selected={selected} /> : null}
                </div>
              )
            }

            // success：MusicCard 焦点块
            const song = card.song
            const isPlaying = Boolean(playing && currentSongId === song.id)
            const queue = playableSongsForTask(task)
            const canPlay = Boolean(song.audioUrl.trim())
            const meta = [
              cardModel(card),
              cardTags(card),
              formatCreatedAt(task.createdAt),
              task.params.instrumental ? t('musicInstrumental') : ''
            ].filter(Boolean)
            return (
              <MusicCard
                key={card.id}
                data-testid="music-work-card"
                data-status={status}
                data-playing={isPlaying ? 'true' : undefined}
                title={title}
                subtitle={prompt || t('musicPromptEmpty')}
                duration={formatSongDuration(song)}
                metaItems={meta}
                coverUrl={song.imageUrl}
                playing={isPlaying}
                selected={selected}
                resolveCover={resolveCover}
                openLabel={
                  selectMode ? t('musicBatchToggle') : isPlaying ? t('musicPause') : t('musicPlay')
                }
                onOpen={
                  selectMode
                    ? () => toggleSelected(card.id)
                    : canPlay
                      ? () => (isPlaying ? onPause() : onPlay(song, queue))
                      : undefined
                }
                overlay={
                  <>
                    <span className="absolute left-2 top-2 rounded-[var(--radius-sm)] bg-ds-card px-1.5 py-0.5 text-[10.5px] font-medium text-ds-success">
                      {t(STATUS_LABEL_KEY[status])}
                    </span>
                    {isPlaying && !selectMode ? (
                      <span className="absolute right-2 top-2 rounded-[var(--radius-sm)] bg-accent px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
                        {t('musicPlaying')}
                      </span>
                    ) : null}
                    {selectMode ? <SelectBox selected={selected} /> : null}
                  </>
                }
                notice={
                  !canPlay ? (
                    <div
                      data-testid="music-audio-missing"
                      className="rounded-[var(--radius-sm)] border border-ds-border bg-ds-accent-soft px-2.5 py-2 text-[12px] leading-4 text-ds-accent"
                    >
                      {t('musicAudioMissing')}
                    </div>
                  ) : null
                }
                actions={
                  <>
                    <ActionButton
                      label={isPlaying ? t('musicPause') : t('musicPlay')}
                      disabled={!canPlay}
                      onClick={canPlay ? () => (isPlaying ? onPause() : onPlay(song, queue)) : undefined}
                    >
                      {isPlaying ? (
                        <Pause className="h-3.5 w-3.5" strokeWidth={1.75} />
                      ) : (
                        <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                    </ActionButton>
                    <ActionButton
                      label={t('musicDownload')}
                      disabled={!canPlay}
                      onClick={() => onDownload(song)}
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
                    <ActionButton label={t('musicRegenerate')} onClick={() => onRegenerate(task)}>
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                    <ActionButton label={t('musicDelete')} onClick={() => onRemoveSong(song.id)}>
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </ActionButton>
                  </>
                }
                t={t}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
