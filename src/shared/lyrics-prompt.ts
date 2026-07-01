// AI 写词提示词构造（纯函数，迁移自 claude360-music-web src/lib/lyrics-prompt.ts）。
//
// 供渲染进程写词助手把 主题/语言/情绪/结构 组装成 system/user，再经 IPC 走
// /v1/chat/completions 流式生成歌词。无任何网络/凭据依赖，main/renderer 共享。

export interface LyricsPromptOpts {
  theme: string
  lang: string
  mood: string
  structure: string
}

export function buildLyricsPrompt(o: LyricsPromptOpts): { system: string; user: string } {
  const system = [
    '你是专业作词人。只输出歌词本身，使用 [Verse]/[Chorus]/[Bridge] 等结构标记。',
    '不要任何解释、标题、前后缀或 Markdown 代码块。',
    `语言：${o.lang}。情绪：${o.mood}。结构：${o.structure}。`
  ].join('\n')
  const user = `请根据以下主题创作歌词：${o.theme || '自由发挥'}`
  return { system, user }
}
