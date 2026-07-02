import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Music2 } from 'lucide-react'
import type { Claude360Song } from '@shared/claude360-music'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { emptyForm } from '../../music/suno-params'
import type { Claude360MusicCreateForm } from '@shared/claude360-music'
import {
  MUSIC_POLL_INTERVAL_MS,
  hasActiveTask,
  selectActiveTaskIds,
  useMusicTaskStore
} from '../../music/music-task-store'
import {
  currentSong,
  hasNext as playerHasNext,
  hasPrev as playerHasPrev,
  useMusicPlayerStore
} from '../../music/music-player-store'
import {
  downloadSong,
  pollActiveTasksOnce,
  submitMusic,
  type MusicWorkbenchApi
} from '../../music/music-workbench-actions'
import type { LyricsStreamApi } from '../../music/lyrics-ai'
import { ensureGroupKeyForSelection } from '../../lib/group-key-ensure'
import { useGroupKeyPromptStore } from '../../store/group-key-prompt-store'
import { MusicCreatePanel } from './MusicCreatePanel'
import { MusicTaskList } from './MusicTaskList'
import { MusicPlayer } from './MusicPlayer'
import { LyricsAssistantDrawer } from './LyricsAssistantDrawer'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
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

  const [form, setForm] = useState<Claude360MusicCreateForm>(() => emptyForm())
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [lyricsOpen, setLyricsOpen] = useState(false)
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
  const togglePlayAction = useStore(useMusicPlayerStore, (s) => s.togglePlay)
  const pauseAction = useStore(useMusicPlayerStore, (s) => s.pause)
  const nextAction = useStore(useMusicPlayerStore, (s) => s.next)
  const prevAction = useStore(useMusicPlayerStore, (s) => s.prev)
  const endedAction = useStore(useMusicPlayerStore, (s) => s.ended)
  const setProgress = useStore(useMusicPlayerStore, (s) => s.setProgress)
  const setVolume = useStore(useMusicPlayerStore, (s) => s.setVolume)
  const current = currentSong({ queue, index: playIndex })

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const api = (): MusicWorkbenchApi | null =>
    typeof window !== 'undefined' && window.kunGui ? (window.kunGui as unknown as MusicWorkbenchApi) : null

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

  const handleSubmit = useCallback(async (): Promise<void> => {
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
        { feature: '音乐', model: form.model }
      )
      if (!ready) return
      const result = await submitMusic(k, { addSubmitting, markSubmitted, markFailed }, form)
      if (!result.ok && result.errors) setErrors(result.errors)
    } finally {
      setSubmitting(false)
    }
  }, [addSubmitting, form, markFailed, markSubmitted, musicGroup, submitting, t])

  // 播放：把点击的歌曲 + 其所在列表设为播放队列（支持连续播放 / 上下曲）。
  const playSong = useCallback(
    (song: Claude360Song, list: Claude360Song[]): void => {
      const q = list.length > 0 ? list : [song]
      const start = Math.max(0, q.findIndex((s) => s.id === song.id))
      setQueue(q, start)
    },
    [setQueue]
  )

  // 把播放器 store 状态桥接到 <audio>：切歌换 src、按 playing 播放/暂停。
  useEffect(() => {
    const el = audioRef.current
    if (!el || !current) return
    if (el.src !== current.audioUrl) el.src = current.audioUrl
    if (playing) {
      void el.play().catch(() => pauseAction())
    } else {
      el.pause()
    }
  }, [current, playing, pauseAction])

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

  const handleDownload = useCallback((song: Claude360Song): void => {
    void downloadSong(song.audioUrl, song.title, {
      fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
      createObjectURL: (b) => URL.createObjectURL(b),
      revokeObjectURL: (u) => URL.revokeObjectURL(u),
      triggerDownload: (url, filename) => {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
      },
      openFallback: (url) => window.open(url, '_blank', 'noopener')
    })
  }, [])

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
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div className={`flex min-w-0 items-center gap-2.5 ${headerInset}`}>
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <Music2 className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">{t('musicWorkbenchTitle')}</h1>
            </div>
          </div>
        </header>
      </div>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
          <div className="flex min-h-0 flex-col gap-4 lg:flex-row">
            <div className="flex w-full flex-col gap-4 lg:max-w-[380px]">
              <MusicCreatePanel
                form={form}
                submitting={submitting}
                onChange={patchForm}
                onSubmit={() => void handleSubmit()}
                onOpenLyricsAssistant={() => setLyricsOpen(true)}
                errors={errors}
                t={t}
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <MusicTaskList
                tasks={tasks}
                onPlay={(song, list) => playSong(song, list)}
                onDownload={handleDownload}
                onRemove={removeTask}
                t={t}
              />
              <MusicPlayer
                current={current}
                playing={playing}
                currentTime={currentTime}
                duration={duration}
                volume={volume}
                hasPrev={playerHasPrev({ index: playIndex })}
                hasNext={playerHasNext({ queue, index: playIndex })}
                onTogglePlay={togglePlayAction}
                onSeek={handleSeek}
                onVolume={setVolume}
                onPrev={prevAction}
                onNext={nextAction}
                onDownload={handleDownload}
                t={t}
              />
            </div>

            <LyricsAssistantDrawer
              open={lyricsOpen}
              onClose={() => setLyricsOpen(false)}
              onInsert={insertLyrics}
              defaultTheme={form.description}
              textModels={textModels}
              streamApi={lyricsStreamApi()}
              t={t}
            />
          </div>
        </div>
      </main>

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
