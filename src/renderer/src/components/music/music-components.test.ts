// 音乐工作台展示组件的静态渲染测试（阶段4 Calm Blue 迁移后）。
// 按仓库约定：node 环境、无 jsdom，用 renderToStaticMarkup + 注入 props/mock t。
// 容器 MusicWorkbench 的副作用（提交/轮询/下载）已在 music-workbench-actions.test.ts 覆盖，
// 这里只验证「是创作台、有表单/任务列表/播放条、成功歌曲有标题/cover/下载、
// 生成任务走 TaskCard 三态、成功作品走 MusicCard」。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Claude360Song } from '@shared/claude360-music'
import type { MusicGenTask } from '../../music/music-task-store'
import { emptyForm } from '../../music/suno-params'
import { MusicCreatePanel } from './MusicCreatePanel'
import { MusicTaskList, toTaskCardStatus } from './MusicTaskList'
import { MiniPlayerBar } from './MiniPlayerBar'
import { MusicCard, formatSongDuration } from './MusicCard'
import { LyricsAssistantDrawer } from './LyricsAssistantDrawer'

// 直通式 t：返回 key（含插值 title），便于断言文案 key 已接入。
function t(key: string, opts?: Record<string, unknown>): string {
  if (opts && typeof opts.title === 'string') return `${key}:${opts.title}`
  return key
}

const song = (id: string): Claude360Song => ({
  id,
  audioUrl: `https://cdn.example/${id}.mp3`,
  imageUrl: `https://cdn.example/${id}.png`,
  title: `歌曲-${id}`,
  tags: 'synthwave',
  duration: 126,
  modelName: 'Suno V5.5'
})

describe('MusicCreatePanel · 创作配置区', () => {
  it('渲染简单/标准模式、歌曲描述、可选歌词、纯伴奏、模型和开始创作按钮（无 API Key / 登录配置）', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCreatePanel, {
        form: emptyForm(),
        submitting: false,
        onChange: () => undefined,
        onSubmit: () => undefined,
        onOpenLyricsAssistant: () => undefined,
        errors: [],
        t
      })
    )
    expect(html).toContain('music-create-panel')
    expect(html).toContain('musicModeOneshot')
    expect(html).toContain('musicModeStandard')
    expect(html).toContain('musicDescriptionLabel')
    expect(html).toContain('0 / 500')
    expect(html).toContain('musicLyricsLabel')
    expect(html).toContain('musicLyricsAssistant')
    expect(html).toContain('musicInstrumental')
    expect(html).toContain('musicModelLabel')
    expect(html).toContain('musicGenerateTwo')
    expect(html).toContain('musicGenerateHint')
    // 断言不出现独立登录 / API Key 配置字样
    expect(html.toLowerCase()).not.toContain('api key')
    expect(html.toLowerCase()).not.toContain('apikey')
    expect(html).not.toContain('musicLogin')
  })

  it('标准模式渲染 歌词助手 / 曲风预设 chips / 排除风格 / 高级参数(人声性别)', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCreatePanel, {
        form: { ...emptyForm(), mode: 'standard' },
        submitting: false,
        onChange: () => undefined,
        onSubmit: () => undefined,
        onOpenLyricsAssistant: () => undefined,
        errors: [],
        t
      })
    )
    expect(html).toContain('musicLyricsAssistant')
    expect(html).toContain('musicStylePresetsLabel')
    expect(html).toContain('合成波') // STYLE_PRESETS 首项
    expect(html).toContain('musicNegativeTagsLabel')
    expect(html).toContain('musicAdvancedTitle')
    expect(html).toContain('musicVocalGender')
  })

  it('生成中显示 musicGenerating 且按钮禁用', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCreatePanel, {
        form: emptyForm(),
        submitting: true,
        onChange: () => undefined,
        onSubmit: () => undefined,
        onOpenLyricsAssistant: () => undefined,
        errors: [],
        t
      })
    )
    expect(html).toContain('musicGenerating')
    expect(html).toContain('disabled')
  })

  it('校验错误渲染在面板内', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCreatePanel, {
        form: emptyForm(),
        submitting: false,
        onChange: () => undefined,
        onSubmit: () => undefined,
        onOpenLyricsAssistant: () => undefined,
        errors: ['请填写歌曲描述'],
        t
      })
    )
    expect(html).toContain('请填写歌曲描述')
  })

  it('控件走 token 类，不输出字面量色值', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCreatePanel, {
        form: { ...emptyForm(), mode: 'standard' },
        submitting: false,
        onChange: () => undefined,
        onSubmit: () => undefined,
        onOpenLyricsAssistant: () => undefined,
        errors: ['e'],
        t
      })
    )
    expect(html).toContain('bg-ds-card')
    expect(html).toContain('text-ds-danger')
    expect(html).not.toContain('border-red-')
    expect(html).not.toContain('bg-red-')
  })
})

describe('toTaskCardStatus · 任务状态映射（纯函数）', () => {
  it('submitting/queued/in_progress → running；failure → error；success → success', () => {
    expect(toTaskCardStatus('submitting')).toBe('running')
    expect(toTaskCardStatus('queued')).toBe('running')
    expect(toTaskCardStatus('in_progress')).toBe('running')
    expect(toTaskCardStatus('failure')).toBe('error')
    expect(toTaskCardStatus('success')).toBe('success')
  })
})

function renderTasks(tasks: MusicGenTask[], extra: Partial<Parameters<typeof MusicTaskList>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(MusicTaskList, {
      tasks,
      currentSongId: null,
      playing: false,
      onPlay: () => undefined,
      onPause: () => undefined,
      onDownload: () => undefined,
      onRemoveTask: () => undefined,
      onRemoveSong: () => undefined,
      onClear: () => undefined,
      onCopyPrompt: () => undefined,
      onRegenerate: () => undefined,
      t,
      ...extra
    })
  )
}

describe('MusicTaskList · 作品管理栏 + 宫格', () => {
  it('空态显示作品管理栏和 musicWorksEmpty', () => {
    const html = renderTasks([])
    expect(html).toContain('music-task-list')
    expect(html).toContain('music-works-toolbar')
    expect(html).toContain('musicWorksTitle')
    expect(html).toContain('musicWorksCount')
    expect(html).toContain('musicWorksEmpty')
  })

  it('成功歌曲以 MusicCard 展示封面、状态、标题、简短描述、时长和操作按钮', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'success',
      createdAt: 1,
      title: '我的创作',
      params: { prompt: '城市夜晚的合成波', model: 'V5_5', style: 'synthwave', instrumental: true },
      songs: [song('a')]
    }
    const html = renderTasks([task])
    expect(html).toContain('music-song-grid')
    expect(html).toContain('music-work-card')
    expect(html).toContain('musicStatusSuccess')
    expect(html).toContain('歌曲-a')
    expect(html).toContain('synthwave')
    expect(html).toContain('2:06')
    expect(html).not.toContain('城市夜晚的合成波')
    expect(html).not.toContain('Suno V5.5')
    expect(html).not.toContain('chirp-fenix')
    expect(html).not.toContain('musicInstrumental')
    expect(html).not.toContain('https://cdn.example/a.mp3')
    expect(html).toContain('https://cdn.example/a.png')
    expect(html).toContain('musicPlay')
    expect(html).toContain('musicDownload')
    expect(html).toContain('musicCopyPrompt')
    expect(html).toContain('musicRegenerate')
    expect(html).toContain('musicDelete')
  })

  it('无封面时显示默认封面占位，无音频地址时显示明确错误提示', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'success',
      createdAt: 1,
      title: '缺少资源',
      params: { prompt: 'p', model: 'V5_5' },
      songs: [{ ...song('missing'), audioUrl: '', imageUrl: undefined }]
    }
    const html = renderTasks([task])
    expect(html).toContain('music-cover-placeholder')
    expect(html).toContain('musicAudioMissing')
    expect(html).toContain('disabled')
  })

  it('当前播放中的卡片有播放中状态与波形动效', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'success',
      createdAt: 1,
      title: '我的创作',
      params: { prompt: 'p', model: 'V5_5' },
      songs: [song('a')]
    }
    const html = renderTasks([task], { currentSongId: 'a', playing: true })
    expect(html).toContain('data-playing="true"')
    expect(html).toContain('musicPlaying')
    expect(html).toContain('ds-ui-wave')
  })

  it('生成中任务显示 TaskCard 呼吸态（running + 不确定进度扫动）', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'in_progress',
      createdAt: 1,
      title: '城市清晨',
      params: { prompt: 'p', model: 'V5_5' },
      songs: []
    }
    const html = renderTasks([task])
    expect(html).toContain('music-work-card')
    expect(html).toContain('data-status="running"')
    expect(html).toContain('musicStatusInProgress')
    expect(html).toContain('musicWorkGenerating')
    expect(html).toContain('ds-ui-breathe')
    expect(html).toContain('ds-ui-progress-sweep')
  })

  it('失败任务显示 TaskCard error 态、失败原因和重试按钮', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'failure',
      createdAt: 1,
      title: '失败任务',
      params: { prompt: 'p', model: 'V5_5' },
      songs: [],
      failReason: '余额不足'
    }
    const html = renderTasks([task])
    expect(html).toContain('余额不足')
    expect(html).toContain('data-status="error"')
    expect(html).toContain('musicStatusFailure')
    expect(html).toContain('musicRetry')
    expect(html).toContain('musicDelete')
  })

  it('工具栏包含状态筛选、清空和批量选择入口', () => {
    const html = renderTasks([])
    expect(html).toContain('musicFilterAll')
    expect(html).toContain('musicFilterSuccess')
    expect(html).toContain('musicFilterGenerating')
    expect(html).toContain('musicFilterFailure')
    expect(html).toContain('musicClearAll')
    expect(html).toContain('musicBatchSelect')
  })

  it('作品区复用 ds 主题 token，不输出黑金硬编码颜色', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'success',
      createdAt: 1,
      title: '我的创作',
      params: { prompt: 'p', model: 'V5_5' },
      songs: [song('a')]
    }
    const html = renderTasks([task], { currentSongId: 'a', playing: true })
    expect(html).toContain('bg-ds-card')
    expect(html).toContain('border-ds-border')
    expect(html).toContain('text-ds-ink')
    expect(html).not.toContain('#f5c542')
    expect(html).not.toContain('#050505')
    expect(html).not.toContain('#080808')
    expect(html).not.toContain('#090909')
    expect(html).not.toContain('#0b0b0b')
    expect(html).not.toContain('bg-black')
  })
})

describe('MusicCard · 音乐作品卡（Feature）', () => {
  it('渲染封面（12px 圆角）、标题、时长；播放态显示波形角标', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCard, {
        title: '深夜城市',
        subtitle: '一首合成波',
        duration: '2:06',
        coverUrl: 'https://cdn.example/cover.png',
        playing: true,
        t
      })
    )
    expect(html).toContain('深夜城市')
    expect(html).toContain('2:06')
    expect(html).toContain('https://cdn.example/cover.png')
    expect(html).toContain('rounded-[var(--radius-md)]')
    expect(html).toContain('music-playing-wave')
    expect(html).toContain('ds-ui-wave')
    expect(html).toContain('bg-accent')
  })

  it('非播放态不渲染波形；无封面时回占位图', () => {
    const html = renderToStaticMarkup(
      createElement(MusicCard, { title: '安静的卡', t })
    )
    expect(html).not.toContain('music-playing-wave')
    expect(html).toContain('music-cover-placeholder')
  })

  it('formatSongDuration：秒 → m:ss，缺失返回空串', () => {
    expect(formatSongDuration(song('a'))).toBe('2:06')
    expect(formatSongDuration({ ...song('a'), duration: undefined })).toBe('')
    expect(formatSongDuration({ ...song('a'), duration: 0 })).toBe('')
  })
})

describe('MiniPlayerBar · 底部迷你播放条', () => {
  const playerBase = {
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    hasPrev: false,
    hasNext: false,
    onTogglePlay: () => undefined,
    onSeek: () => undefined,
    onVolume: () => undefined,
    onPrev: () => undefined,
    onNext: () => undefined,
    onDownload: () => undefined,
    t
  }
  it('无当前歌曲显示胶囊空态', () => {
    const html = renderToStaticMarkup(createElement(MiniPlayerBar, { ...playerBase, current: null }))
    expect(html).toContain('music-player')
    expect(html).toContain('musicPlayerEmpty')
    expect(html).toContain('rounded-full')
  })
  it('有当前歌曲显示标题 / 副标题 / 进度滑块 / 音量 / 下载（不暴露 audioUrl）', () => {
    const html = renderToStaticMarkup(
      createElement(MiniPlayerBar, {
        ...playerBase,
        current: { ...song('b'), tags: undefined },
        playing: true,
        currentTime: 12,
        duration: 154,
        hasNext: true
      })
    )
    expect(html).toContain('歌曲-b')
    expect(html).toContain('music-player-subtitle')
    expect(html).not.toContain('https://cdn.example/b.mp3')
    expect(html).toContain('musicSongReady')
    expect(html).toContain('musicDownload')
    // 增强控件
    expect(html).toContain('music-player-seek')
    expect(html).toContain('music-player-volume')
    expect(html).toContain('musicPrev')
    expect(html).toContain('musicNext')
    // 粗胶囊滑块：accent 已播放段
    expect(html).toContain('bg-accent')
  })

  it('播放条无封面时显示默认封面占位', () => {
    const html = renderToStaticMarkup(
      createElement(MiniPlayerBar, {
        ...playerBase,
        current: { ...song('c'), imageUrl: undefined }
      })
    )
    expect(html).toContain('music-player-cover-placeholder')
  })
})

describe('LyricsAssistantDrawer · AI 写词模态', () => {
  const drawerBase = {
    onClose: () => undefined,
    onInsert: () => undefined,
    defaultTheme: '深夜城市',
    textModels: ['gpt-4o', 'claude-3.5-sonnet'],
    streamApi: null,
    t
  }
  it('open=false 不渲染', () => {
    const html = renderToStaticMarkup(createElement(LyricsAssistantDrawer, { ...drawerBase, open: false }))
    expect(html).toBe('')
  })
  it('open=true 使用居中 Modal 承载 AI 写词内容', () => {
    const source = LyricsAssistantDrawer.toString()
    expect(source).toContain('Modal')
    expect(source).toContain('music-lyrics-drawer')
    expect(source).toContain('musicLyricsAiTitle')
    expect(source).toContain('lyrics-ai-model')
    expect(source).toContain('lyrics-ai-generate')
    expect(source).toContain('lyrics-ai-result')
    expect(source).toContain('lyrics-ai-apply')
    expect(source).toContain('STRUCTURE_OPTIONS')
    expect(source).not.toContain('fixed inset-0 z-[200]')
  })
})
