import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Music2 } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { PageHeader } from '../shell'
import { Card, toast } from '../ui'
import { confirmDialog } from '../../lib/confirm-dialog'
import { emptyForm } from '../../music/suno-params'
import type { Claude360MusicCreateForm } from '@shared/claude360-music'
import {
  MUSIC_POLL_INTERVAL_MS,
  hasActiveTask,
  selectActiveTaskIds,
  useMusicTaskStore,
  type MusicGenTask
} from '../../music/music-task-store'
import {
  currentSong,
  hasNext as playerHasNext,
  hasPrev as playerHasPrev,
  useMusicPlayerStore
} from '../../music/music-player-store'
import {
  debugProbeSongs,
  downloadSong,
  playSongOnAudioElement,
  pollActiveTasksOnce,
  submitMusic,
  type MusicWorkbenchApi
} from '../../music/music-workbench-actions'
import type { LyricsStreamApi } from '../../music/lyrics-ai'
import { ensureGroupKeyForSelection } from '../../lib/group-key-ensure'
import { useGroupKeyPromptStore } from '../../store/group-key-prompt-store'
import { MusicCreatePanel } from './MusicCreatePanel'
import { MusicTaskList } from './MusicTaskList'
import { MiniPlayerBar } from './MiniPlayerBar'
import { MusicCoverImage } from './MusicCard'
import { LyricsAssistantDrawer } from './LyricsAssistantDrawer'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
}

type PlaybackSource = {
  songId: string
  url: string
  objectUrl?: string
}

function formFromTask(task: { title: string; params: MusicGenTask['params'] }): Claude360MusicCreateForm {
  const params = task.params
  const model = params.model as Claude360MusicCreateForm['model']
  if (params.custom_mode === false) {
    return {
      ...emptyForm(),
      mode: 'oneshot',
      description: params.prompt || task.title,
      instrumental: Boolean(params.instrumental),
      model
    }
  }
  return {
    ...emptyForm(),
    mode: 'standard',
    customMode: params.custom_mode ?? true,
    instrumental: Boolean(params.instrumental),
    model,
    title: params.title || task.title,
    style: params.style || '',
    lyrics: params.prompt || '',
    negativeTags: params.negative_tags || '',
    vocalGender: (params.vocal_gender || '') as Claude360MusicCreateForm['vocalGender'],
    styleWeight: typeof params.style_weight === 'number' ? params.style_weight : 0,
    weirdness: typeof params.weirdness_constraint === 'number' ? params.weirdness_constraint : 0,
    personaId: params.persona_id || '',
    personaModel: (params.persona_model || '') as Claude360MusicCreateForm['personaModel']
  }
}

function blobFromBase64(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType || 'audio/mpeg' })
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

// 「正在播放 + 歌词」右栏（阶段4 design §3.2）：当前歌曲封面 + 标题/曲风 + 歌词（song.text）。
// 纯展示；歌词缺失时只展示封面与标题，不引入新文案 key。
function NowPlayingCard({
  song,
  resolveCover,
  t
}: {
  song: Claude360Song
  resolveCover?: (url: string) => Promise<string | null>
  t: TFn
}): ReactElement {
  return (
    <Card unpadded data-testid="music-now-playing" className="flex min-h-0 flex-col overflow-hidden">
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-ds-main">
        <MusicCoverImage src={song.imageUrl} title={song.title} active resolveCover={resolveCover} t={t} />
      </div>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
        <span className="self-start rounded-full bg-ds-accent-soft px-2 py-0.5 text-[11px] font-medium text-ds-accent">
          {t('musicPlaying')}
        </span>
        <h3 className="text-[15px] font-semibold leading-snug text-ds-ink">{song.title}</h3>
        {song.tags?.trim() ? <p className="text-[12px] text-ds-muted">{song.tags.trim()}</p> : null}
        {song.text?.trim() ? (
          <p className="whitespace-pre-wrap text-[13px] leading-7 text-ds-muted">{song.text.trim()}</p>
        ) : null}
      </div>
    </Card>
  )
}

// 音乐工作台容器：拥有表单 state 与副作用编排（提交 / 轮询 / 播放 / 下载）。
// 具体副作用委托给 music-workbench-actions.ts（可注入依赖），本容器只做 state/effect 编排，
// 便于 node 单测直接测 actions 与展示子组件。renderer 全程不持有 / 输入 API Key。
// 分组模式：打开页面不检测 music 分组 Key；Key 在「点开始生成」时按所选分组检测/创建。
export function MusicWorkbench({ leftSidebarCollapsed, onToggleLeftSidebar }: Props): ReactElement {
  const { t } = useTranslation('common')
  const tasks = useStore(useMusicTaskStore, (s) => s.tasks)
  const addSubmitting = useStore(useMusicTaskStore, (s) => s.addSubmitting)
  const markSubmitted = useStore(useMusicTaskStore, (s) => s.markSubmitted)
  const markFailed = useStore(useMusicTaskStore, (s) => s.markFailed)
  const applyFetched = useStore(useMusicTaskStore, (s) => s.applyFetched)
  const removeTask = useStore(useMusicTaskStore, (s) => s.removeTask)
  const removeSong = useStore(useMusicTaskStore, (s) => s.removeSong)
  const clearFinishedTasks = useStore(useMusicTaskStore, (s) => s.clearFinishedTasks)

  const [form, setForm] = useState<Claude360MusicCreateForm>(() => emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  // 写词助手用的文本模型列表（来自 text 分组）。
  const [textModels, setTextModels] = useState<string[]>([])
  // 当前 music 分组（选模型时用于确保该分组已有 Key）。
  const [musicGroup, setMusicGroup] = useState('')

  // 播放器状态（队列 / 进度 / 音量）——store 管状态，容器把状态桥接到 <audio>。
  const queue = useStore(useMusicPlayerStore, (s) => s.queue)
  const playIndex = useStore(useMusicPlayerStore, (s) => s.index)
  const playing = useStore(useMusicPlayerStore, (s) => s.playing)
  const currentTime = useStore(useMusicPlayerStore, (s) => s.currentTime)
  const duration = useStore(useMusicPlayerStore, (s) => s.duration)
  const volume = useStore(useMusicPlayerStore, (s) => s.volume)
  const setQueue = useStore(useMusicPlayerStore, (s) => s.setQueue)
  const playAction = useStore(useMusicPlayerStore, (s) => s.play)
  const togglePlayAction = useStore(useMusicPlayerStore, (s) => s.togglePlay)
  const pauseAction = useStore(useMusicPlayerStore, (s) => s.pause)
  const nextAction = useStore(useMusicPlayerStore, (s) => s.next)
  const prevAction = useStore(useMusicPlayerStore, (s) => s.prev)
  const endedAction = useStore(useMusicPlayerStore, (s) => s.ended)
  const setProgress = useStore(useMusicPlayerStore, (s) => s.setProgress)
  const setVolume = useStore(useMusicPlayerStore, (s) => s.setVolume)
  const current = currentSong({ queue, index: playIndex })

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackSourceRef = useRef<PlaybackSource | null>(null)
  const api = (): MusicWorkbenchApi | null =>
    typeof window !== 'undefined' && window.kunGui ? (window.kunGui as unknown as MusicWorkbenchApi) : null

  const rememberPlaybackSource = useCallback((songId: string, url: string, usedFallback: boolean): void => {
    const previous = playbackSourceRef.current?.objectUrl
    if (previous && previous !== url) URL.revokeObjectURL(previous)
    playbackSourceRef.current = { songId, url, objectUrl: usedFallback ? url : undefined }
  }, [])

  useEffect(() => {
    return () => {
      const objectUrl = playbackSourceRef.current?.objectUrl
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      playbackSourceRef.current = null
    }
  }, [])

  const resolvePlayableObjectUrl = useCallback(async (audioUrl: string, error: unknown): Promise<string | null> => {
    const k = api()
    if (!k?.claude360MusicMediaBlob) return null
    const message = error instanceof Error ? error.message : String(error)
    console.error('[claude360-music] direct audio playback failed; trying blob fallback', {
      message,
      url: audioUrl
    })
    try {
      const result = await k.claude360MusicMediaBlob(audioUrl)
      if (!result.ok) {
        console.error('[claude360-music] blob fallback fetch failed', result)
        return null
      }
      const blob = blobFromBase64(result.base64, result.mimeType)
      return URL.createObjectURL(blob)
    } catch (fallbackError) {
      console.error('[claude360-music] blob fallback threw', fallbackError)
      return null
    }
  }, [])

  // 封面代理兜底产生的 objectURL 按 coverUrl 缓存复用（同一封面不重复代取、
  // 不重复 createObjectURL 累积内存），卸载时统一 revoke。
  const coverObjectUrlsRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const urls = coverObjectUrlsRef.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  // 封面直连失败时经 main media-blob 代取（同源自动附 Key）转 objectURL。
  const resolveCoverObjectUrl = useCallback(async (coverUrl: string): Promise<string | null> => {
    const cached = coverObjectUrlsRef.current.get(coverUrl)
    if (cached) return cached
    const k = api()
    if (!k?.claude360MusicMediaBlob) return null
    try {
      const result = await k.claude360MusicMediaBlob(coverUrl)
      if (!result.ok) {
        console.error('[claude360-music] cover blob proxy failed', { coverUrl, result })
        return null
      }
      const objectUrl = URL.createObjectURL(blobFromBase64(result.base64, result.mimeType))
      coverObjectUrlsRef.current.set(coverUrl, objectUrl)
      return objectUrl
    } catch (error) {
      console.error('[claude360-music] cover blob proxy threw', { coverUrl, error })
      return null
    }
  }, [])

  // 调试探针：任务转 success 后对每首歌验证 coverUrl / audioUrl 可访问性与
  // content-type（结果打控制台，不影响业务）。每首歌只探测一次。
  const probedSongIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const k = api()
    if (!k) return
    const pending = tasks
      .filter((task) => task.status === 'success')
      .flatMap((task) => task.songs)
      .filter((song) => !probedSongIdsRef.current.has(song.id))
    if (pending.length === 0) return
    for (const song of pending) probedSongIdsRef.current.add(song.id)
    void debugProbeSongs(k, pending)
  }, [tasks])

  // 拉取 text 分组的模型列表，供写词助手的文本模型下拉使用。
  useEffect(() => {
    let alive = true
    const w = typeof window !== 'undefined' ? window.kunGui : undefined
    if (!w?.getSettings || !w.claude360ModelsByGroup) return
    void w
      .getSettings()
      .then((s) => {
        if (alive) setMusicGroup((s.claude360?.selectedMusicGroup ?? '').trim())
        const group = (s.claude360?.selectedTextGroup || 'auto').trim() || 'auto'
        return w.claude360ModelsByGroup({ group })
      })
      .then((res) => {
        if (alive) setTextModels(res.models ?? [])
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // 写词助手流式 IPC 子集（注入模态，便于测试）。
  const lyricsStreamApi = (): LyricsStreamApi | null => {
    const w = typeof window !== 'undefined' ? window.kunGui : undefined
    if (!w?.claude360ChatStreamStart) return null
    return {
      claude360ChatStreamStart: w.claude360ChatStreamStart,
      claude360ChatStreamStop: w.claude360ChatStreamStop,
      onClaude360ChatDelta: w.onClaude360ChatDelta,
      onClaude360ChatEnd: w.onClaude360ChatEnd,
      onClaude360ChatError: w.onClaude360ChatError
    }
  }

  // 轮询：有活跃任务才 tick；无活跃任务清除定时器（失败上限在 store 侧兜底）。
  const activeKey = selectActiveTaskIds(tasks).join(',')
  useEffect(() => {
    if (activeKey === '') return
    const k = api()
    if (!k) return
    let alive = true
    const tick = async (): Promise<void> => {
      const ids = selectActiveTaskIds(useMusicTaskStore.getState().tasks)
      if (ids.length === 0 || !alive) return
      await pollActiveTasksOnce(k, { applyFetched }, ids)
    }
    void tick()
    const id = window.setInterval(() => void tick(), MUSIC_POLL_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [activeKey, applyFetched])

  // 选模型仅更新表单，不再即时检测 Key；Key 改到「点开始生成」时按所选分组检测/创建。
  const patchForm = useCallback((patch: Partial<Claude360MusicCreateForm>): void => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const submitForm = useCallback(async (nextForm: Claude360MusicCreateForm): Promise<void> => {
    const k = api()
    if (!k || submitting) return
    // 拦截并发提交：已有排队/生成中的任务时不再发起新任务（音乐按次计费，避免并发扣费）。
    if (hasActiveTask(useMusicTaskStore.getState().tasks)) {
      setErrors([t('musicTaskInProgress')])
      return
    }
    // submitting 必须在 Key 门禁（含网络往返）之前置位：否则弹窗/网络窗口内双击会
    // 双双通过上面的同步检查 → 双提交 → 双扣费。try/finally 兜底复位。
    setSubmitting(true)
    setErrors([])
    try {
      // 执行时按所选 music 分组确保有 Key：无则弹「需要创建分组 Key」模态，用户确认→
      // 自动创建 Key→续跑本次生成；取消/失败→静默中止（不留报错横幅）。
      const ready = await ensureGroupKeyForSelection(
        musicGroup.trim() || null,
        {
          listTokens: () => k.claude360TokensList(),
          promptCreateAndEnsure: (g) => useGroupKeyPromptStore.getState().open(g, 'music')
        },
        { feature: '音乐', model: nextForm.model }
      )
      if (!ready) return
      const result = await submitMusic(k, { addSubmitting, markSubmitted, markFailed }, nextForm)
      if (!result.ok && result.errors) setErrors(result.errors)
    } finally {
      setSubmitting(false)
    }
  }, [addSubmitting, markFailed, markSubmitted, musicGroup, submitting, t])

  const handleSubmit = useCallback(async (): Promise<void> => {
    await submitForm(form)
  }, [form, submitForm])

  // 播放：把点击的歌曲 + 其所在列表设为播放队列（支持连续播放 / 上下曲）。
  const playSong = useCallback(
    (song: Claude360Song, list: Claude360Song[]): void => {
      const q = list.length > 0 ? list : [song]
      const start = Math.max(0, q.findIndex((s) => s.id === song.id))
      const el = audioRef.current
      if (!el) {
        setPlaybackError(t('musicAudioPlayerUnavailable'))
        return
      }
      void playSongOnAudioElement(el, song, volume, {
        resolvePlayableUrl: resolvePlayableObjectUrl,
        logError: (message, detail) => console.error(message, detail)
      }).then((result) => {
        if (!result.ok) {
          pauseAction()
          const message = result.reason === 'missing-url' ? t('musicAudioMissing') : t('musicAudioPlayFailed')
          if (result.reason === 'play-failed') {
            console.error('[claude360-music] audio playback failed', {
              message: result.message,
              audioUrl: song.audioUrl
            })
          }
          setPlaybackError(message)
          return
        }
        rememberPlaybackSource(song.id, result.sourceUrl, result.usedFallback)
        setPlaybackError(null)
        setQueue(q, start)
      })
    },
    [pauseAction, rememberPlaybackSource, resolvePlayableObjectUrl, setQueue, t, volume]
  )

  const togglePlayerPlayback = useCallback((): void => {
    if (!current || playing) {
      togglePlayAction()
      return
    }
    const el = audioRef.current
    if (!el) {
      setPlaybackError(t('musicAudioPlayerUnavailable'))
      return
    }
    void playSongOnAudioElement(el, current, volume, {
      resolvePlayableUrl: resolvePlayableObjectUrl,
      logError: (message, detail) => console.error(message, detail)
    }).then((result) => {
      if (!result.ok) {
        pauseAction()
        const message = result.reason === 'missing-url' ? t('musicAudioMissing') : t('musicAudioPlayFailed')
        if (result.reason === 'play-failed') {
          console.error('[claude360-music] audio playback failed', {
            message: result.message,
            audioUrl: current.audioUrl
          })
        }
        setPlaybackError(message)
        return
      }
      rememberPlaybackSource(current.id, result.sourceUrl, result.usedFallback)
      setPlaybackError(null)
      playAction()
    })
  }, [current, pauseAction, playAction, playing, rememberPlaybackSource, resolvePlayableObjectUrl, t, togglePlayAction, volume])

  // 把播放器 store 状态桥接到 <audio>：切歌换 src、按 playing 播放/暂停。
  useEffect(() => {
    const el = audioRef.current
    if (!el || !current) return
    if (!current.audioUrl.trim()) {
      setPlaybackError(t('musicAudioMissing'))
      pauseAction()
      return
    }
    const remembered = playbackSourceRef.current?.songId === current.id ? playbackSourceRef.current.url : null
    const sourceUrl = remembered ?? current.audioUrl
    if (el.src !== sourceUrl) el.src = sourceUrl
    if (playing) {
      if (!el.paused) return
      if (remembered) {
        void el.play().catch((error) => {
          pauseAction()
          console.error('[claude360-music] remembered audio source failed', {
            message: error instanceof Error ? error.message : String(error),
            audioUrl: current.audioUrl,
            sourceUrl
          })
          setPlaybackError(t('musicAudioPlayFailed'))
        })
        return
      }
      void playSongOnAudioElement(el, current, volume, {
        resolvePlayableUrl: resolvePlayableObjectUrl,
        logError: (message, detail) => console.error(message, detail)
      }).then((result) => {
        if (result.ok) {
          rememberPlaybackSource(current.id, result.sourceUrl, result.usedFallback)
          setPlaybackError(null)
          return
        }
        pauseAction()
        if (result.reason === 'play-failed') {
          console.error('[claude360-music] audio playback failed', {
            message: result.message,
            audioUrl: current.audioUrl
          })
        }
        setPlaybackError(t('musicAudioPlayFailed'))
      })
    } else {
      el.pause()
    }
  }, [current, playing, pauseAction, rememberPlaybackSource, resolvePlayableObjectUrl, t, volume])

  // 音量同步。
  useEffect(() => {
    const el = audioRef.current
    if (el) el.volume = volume
  }, [volume])

  const handleSeek = useCallback((time: number): void => {
    const el = audioRef.current
    if (el) el.currentTime = time
    setProgress(time, audioRef.current?.duration ?? duration)
  }, [duration, setProgress])

  // 下载：只下载、绝不打开窗口/页面。main 经 media-blob 代取鉴权音频 →
  // file:save-as 弹系统保存对话框写盘；取消静默，失败给可见提示 + 控制台真实错误。
  // 一次性反馈走全局 toast（Toaster 已挂 AppShell，勿重复挂载）。
  const handleDownload = useCallback((song: Claude360Song): void => {
    const k = api()
    if (!k) return
    void downloadSong(k, song).then((result) => {
      if (result.ok) {
        toast.success(t('musicDownloadSaved'))
        return
      }
      if (result.canceled) return
      toast.error(t('musicDownloadFailed', { message: result.message }))
    })
  }, [t])

  const handleCopyPrompt = useCallback((prompt: string): void => {
    if (!navigator?.clipboard?.writeText) return
    void navigator.clipboard
      .writeText(prompt)
      .then(() => toast.success(t('musicPromptCopied')))
      .catch(() => toast.error(t('musicPromptCopyFailed')))
  }, [t])

  const handleClearFinished = useCallback((): void => {
    if (tasks.length === 0) return
    void confirmDialog(t('musicClearConfirm')).then((ok) => {
      if (ok) clearFinishedTasks()
    })
  }, [clearFinishedTasks, tasks.length, t])

  const handleRegenerate = useCallback((task: MusicGenTask): void => {
    const nextForm = formFromTask(task)
    setForm(nextForm)
    void submitForm(nextForm)
  }, [submitForm])

  const insertLyrics = useCallback((lyrics: string): void => {
    setForm((prev) => ({ ...prev, lyrics }))
    setLyricsOpen(false)
  }, [])

  const headerInset = useMemo(
    () => (leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''),
    [leftSidebarCollapsed]
  )

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-testid="music-workbench">
      {/* 统一页头（shell/PageHeader）：大标题 + 侧栏折叠开关；窗口控制留白沿用 inset 类 */}
      <PageHeader
        title={t('musicWorkbenchTitle')}
        leading={
          <div className={`flex items-center gap-2.5 ${headerInset}`}>
            <SidebarTitlebarToggleButton
              onClick={onToggleLeftSidebar}
              title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            />
            <Music2 className="h-4 w-4 text-ds-muted" strokeWidth={1.75} aria-hidden />
          </div>
        }
      />

      {/* 主区（design §3.2）：左=创作面板（固定宽、独立滚动），中=任务列表/作品宫格
          （running→TaskCard、done→MusicCard），右=正在播放+歌词（有当前歌曲时，宽屏显示）。
          小屏（<lg）回退为上下排布并整体滚动。页边距 24px / 卡间距 16px（Calm Blue 语义常量）。 */}
      <main className="ds-no-drag flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4 pt-1 lg:flex-row lg:overflow-hidden">
        <aside
          data-testid="music-create-pane"
          className="flex w-full shrink-0 flex-col gap-4 lg:w-[360px] lg:overflow-y-auto lg:pr-1"
        >
          <MusicCreatePanel
            form={form}
            submitting={submitting}
            onChange={patchForm}
            onSubmit={() => void handleSubmit()}
            onOpenLyricsAssistant={() => setLyricsOpen(true)}
            errors={errors}
            t={t}
          />
        </aside>

        <section
          data-testid="music-works-pane"
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:border-l lg:border-ds-border lg:pl-4"
        >
          <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
            <MusicTaskList
              tasks={tasks}
              currentSongId={current?.id ?? null}
              playing={playing}
              onPlay={(song, list) => playSong(song, list)}
              onPause={pauseAction}
              onDownload={handleDownload}
              onRemoveTask={removeTask}
              onRemoveSong={removeSong}
              onClear={handleClearFinished}
              onCopyPrompt={handleCopyPrompt}
              onRegenerate={handleRegenerate}
              resolveCover={resolveCoverObjectUrl}
              t={t}
            />
          </div>
          {playbackError ? (
            <div className="self-center rounded-full border border-ds-border bg-ds-danger-soft px-3 py-1.5 text-[12px] text-ds-danger">
              {playbackError}
            </div>
          ) : null}
        </section>

        {current ? (
          <aside className="hidden shrink-0 flex-col gap-4 xl:flex xl:w-[340px] xl:overflow-y-auto xl:border-l xl:border-ds-border xl:pl-4 2xl:w-[360px]">
            <NowPlayingCard song={current} resolveCover={resolveCoverObjectUrl} t={t} />
          </aside>
        ) : null}

        <LyricsAssistantDrawer
          open={lyricsOpen}
          onClose={() => setLyricsOpen(false)}
          onInsert={insertLyrics}
          defaultTheme={form.description}
          textModels={textModels}
          streamApi={lyricsStreamApi()}
          t={t}
        />
      </main>

      {/* 底部常驻迷你播放条（胶囊，design §2.5）：仅 music 工作台内常驻 */}
      <div className="ds-no-drag shrink-0 px-6 pb-6">
        <MiniPlayerBar
          current={current}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          hasPrev={playerHasPrev({ index: playIndex })}
          hasNext={playerHasNext({ queue, index: playIndex })}
          onTogglePlay={togglePlayerPlayback}
          onSeek={handleSeek}
          onVolume={setVolume}
          onPrev={prevAction}
          onNext={nextAction}
          onDownload={handleDownload}
          t={t}
        />
      </div>

      {/* 隐藏的 audio 元素，播放器条通过 store 状态桥接控制。 */}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime, e.currentTarget.duration)}
        onLoadedMetadata={(e) => setProgress(e.currentTarget.currentTime, e.currentTarget.duration)}
        onEnded={endedAction}
        className="hidden"
      />
    </div>
  )
}
