// 音乐工作台展示组件的静态渲染测试（Task 6）。
// 按仓库约定：node 环境、无 jsdom，用 renderToStaticMarkup + 注入 props/mock t。
// 容器 MusicWorkbench 的副作用（提交/轮询/下载）已在 music-workbench-actions.test.ts 覆盖，
// 这里只验证「是创作台、有表单/任务列表/播放器、未登录显示去我的页入口、成功歌曲有标题/audioUrl/cover/下载」。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Claude360Song } from '@shared/claude360-music'
import type { MusicGenTask } from '../../music/music-task-store'
import { emptyForm } from '../../music/suno-params'
import { MusicCreatePanel } from './MusicCreatePanel'
import { MusicTaskList } from './MusicTaskList'
import { MusicPlayer } from './MusicPlayer'
import { MusicFixBanner } from './MusicFixBanner'
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
  title: `歌曲-${id}`
})

describe('MusicCreatePanel · 是创作台（表单）', () => {
  it('渲染模式 segmented control、模型选择、生成按钮（无 API Key / 登录配置）', () => {
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
    expect(html).toContain('musicModeSimple')
    expect(html).toContain('musicModeStandard')
    expect(html).toContain('musicGenerate')
    expect(html).toContain('musicLyricsAssistant')
    // 断言不出现独立登录 / API Key 配置字样
    expect(html.toLowerCase()).not.toContain('api key')
    expect(html.toLowerCase()).not.toContain('apikey')
    expect(html).not.toContain('musicLogin')
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
})

describe('MusicTaskList · 任务列表 + 成功歌曲', () => {
  it('空态显示 musicTaskEmpty', () => {
    const html = renderToStaticMarkup(
      createElement(MusicTaskList, { tasks: [], onPlay: () => undefined, onDownload: () => undefined, onRemove: () => undefined, t })
    )
    expect(html).toContain('music-task-list')
    expect(html).toContain('musicTaskEmpty')
  })

  it('成功歌曲显示 标题 / 中性副标题（不暴露 audioUrl） / cover / 下载按钮', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'success',
      createdAt: 1,
      title: '我的创作',
      params: { prompt: 'p', model: 'V5_5' },
      songs: [song('a')]
    }
    const html = renderToStaticMarkup(
      createElement(MusicTaskList, { tasks: [task], onPlay: () => undefined, onDownload: () => undefined, onRemove: () => undefined, t })
    )
    expect(html).toContain('music-song-card')
    expect(html).toContain('歌曲-a') // 标题
    expect(html).not.toContain('https://cdn.example/a.mp3') // 不暴露原始 audioUrl
    expect(html).toContain('musicSongReady') // 中性副标题
    expect(html).toContain('https://cdn.example/a.png') // cover
    expect(html).toContain('musicDownload') // 下载按钮 aria-label
    expect(html).toContain('musicStatusSuccess')
  })

  it('有 tags 的歌曲副标题展示 tags 而非 audioUrl', () => {
    const task: MusicGenTask = {
      id: 'x',
      taskId: 't',
      status: 'success',
      createdAt: 1,
      title: '我的创作',
      params: { prompt: 'p', model: 'V5_5' },
      songs: [{ ...song('a'), tags: 'synthwave, chill' }]
    }
    const html = renderToStaticMarkup(
      createElement(MusicTaskList, { tasks: [task], onPlay: () => undefined, onDownload: () => undefined, onRemove: () => undefined, t })
    )
    expect(html).toContain('synthwave, chill')
    expect(html).not.toContain('https://cdn.example/a.mp3')
  })

  it('失败任务显示 failReason', () => {
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
    const html = renderToStaticMarkup(
      createElement(MusicTaskList, { tasks: [task], onPlay: () => undefined, onDownload: () => undefined, onRemove: () => undefined, t })
    )
    expect(html).toContain('余额不足')
    expect(html).toContain('musicStatusFailure')
  })
})

describe('MusicPlayer · 播放器区', () => {
  it('无当前歌曲显示空态', () => {
    const html = renderToStaticMarkup(
      createElement(MusicPlayer, { current: null, playing: false, onTogglePlay: () => undefined, onDownload: () => undefined, t })
    )
    expect(html).toContain('music-player')
    expect(html).toContain('musicPlayerEmpty')
  })
  it('有当前歌曲显示标题 / 中性副标题（不暴露 audioUrl） / 下载', () => {
    const html = renderToStaticMarkup(
      createElement(MusicPlayer, { current: song('b'), playing: true, onTogglePlay: () => undefined, onDownload: () => undefined, t })
    )
    expect(html).toContain('歌曲-b')
    expect(html).toContain('music-player-subtitle')
    expect(html).not.toContain('https://cdn.example/b.mp3')
    expect(html).toContain('musicSongReady')
    expect(html).toContain('musicDownload')
  })
})

describe('MusicFixBanner · 未登录 / 无分组 → 去我的页', () => {
  it('探测中（null）不渲染', () => {
    const html = renderToStaticMarkup(createElement(MusicFixBanner, { access: null, onOpenMy: () => undefined, t }))
    expect(html).toBe('')
  })
  it('未登录显示 musicNeedsLogin + 去我的页入口', () => {
    const html = renderToStaticMarkup(
      createElement(MusicFixBanner, { access: { loggedIn: false, hasMusicGroup: false }, onOpenMy: () => undefined, t })
    )
    expect(html).toContain('music-fix-banner')
    expect(html).toContain('musicNeedsLogin')
    expect(html).toContain('musicGoToMy')
  })
  it('已登录但无 music 分组显示 musicNeedsGroup', () => {
    const html = renderToStaticMarkup(
      createElement(MusicFixBanner, { access: { loggedIn: true, hasMusicGroup: false }, onOpenMy: () => undefined, t })
    )
    expect(html).toContain('musicNeedsGroup')
    expect(html).toContain('musicGoToMy')
  })
  it('权限齐全不渲染 banner', () => {
    const html = renderToStaticMarkup(
      createElement(MusicFixBanner, { access: { loggedIn: true, hasMusicGroup: true }, onOpenMy: () => undefined, t })
    )
    expect(html).toBe('')
  })
})

describe('LyricsAssistantDrawer', () => {
  it('open=false 不渲染', () => {
    const html = renderToStaticMarkup(
      createElement(LyricsAssistantDrawer, { open: false, onClose: () => undefined, onInsert: () => undefined, t })
    )
    expect(html).toBe('')
  })
  it('open=true 渲染歌词结构模板', () => {
    const html = renderToStaticMarkup(
      createElement(LyricsAssistantDrawer, { open: true, onClose: () => undefined, onInsert: () => undefined, t })
    )
    expect(html).toContain('music-lyrics-drawer')
    expect(html).toContain('musicLyricsTplPop')
  })
})
