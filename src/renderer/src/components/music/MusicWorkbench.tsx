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
  detectMusicAccess,
  downloadSong,
  pollActiveTasksOnce,
  submitMusic,
  type MusicAccess,
  type MusicWorkbenchApi
} from '../../music/music-workbench-actions'
import { MusicCreatePanel } from './MusicCreatePanel'
import { MusicTaskList } from './MusicTaskList'
import { MusicPlayer } from './MusicPlayer'
import { LyricsAssistantDrawer } from './LyricsAssistantDrawer'
import { MusicFixBanner } from './MusicFixBanner'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  /** 跳转「我的」页（未登录 / 无 music 分组时的修复入口）。容器只调用，不感知 setRoute。 */
  onOpenMy: () => void
}

// 音乐工作台容器：拥有表单 state 与副作用编排（提交 / 轮询 / 播放 / 下载 / 权限探测）。
// 具体副作用委托给 music-workbench-actions.ts（可注入依赖），本容器只做 state/effect 编排，
// 便于 node 单测直接测 actions 与展示子组件。renderer 全程不持有 / 输入 API Key。
export function MusicWorkbench({ leftSidebarCollapsed, onToggleLeftSidebar, onOpenMy }: Props): ReactElement {
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
  const [current, setCurrent] = useState<Claude360Song | null>(null)
  const [playing, setPlaying] = useState(false)
  const [access, setAccess] = useState<MusicAccess | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const api = (): MusicWorkbenchApi | null =>
    typeof window !== 'undefined' && window.kunGui ? (window.kunGui as unknown as MusicWorkbenchApi) : null

  // 权限探测：拉取 token 列表判断登录态与 music 分组。
  useEffect(() => {
    let alive = true
    const k = api()
    if (!k) {
      setAccess({ loggedIn: false, hasMusicGroup: false })
      return
    }
    void detectMusicAccess(k).then((a) => {
      if (alive) setAccess(a)
    })
    return () => {
      alive = false
    }
  }, [])

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
    setSubmitting(true)
    setErrors([])
    const result = await submitMusic(k, { addSubmitting, markSubmitted, markFailed }, form)
    if (!result.ok && result.errors) setErrors(result.errors)
    setSubmitting(false)
  }, [addSubmitting, form, markFailed, markSubmitted, submitting, t])

  const playSong = useCallback((song: Claude360Song): void => {
    setCurrent(song)
    setPlaying(true)
    const el = audioRef.current
    if (el) {
      el.src = song.audioUrl
      void el.play().catch(() => setPlaying(false))
    }
  }, [])

  const togglePlay = useCallback((): void => {
    const el = audioRef.current
    if (!el || !current) return
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      el.pause()
      setPlaying(false)
    }
  }, [current])

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
          <MusicFixBanner access={access} onOpenMy={onOpenMy} t={t} />

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
                onPlay={(song) => playSong(song)}
                onDownload={handleDownload}
                onRemove={removeTask}
                t={t}
              />
              <MusicPlayer current={current} playing={playing} onTogglePlay={togglePlay} onDownload={handleDownload} t={t} />
            </div>

            <LyricsAssistantDrawer open={lyricsOpen} onClose={() => setLyricsOpen(false)} onInsert={insertLyrics} t={t} />
          </div>
        </div>
      </main>

      {/* 隐藏的 audio 元素，播放器条通过 ref 控制。 */}
      <audio ref={audioRef} onEnded={() => setPlaying(false)} className="hidden" />
    </div>
  )
}
