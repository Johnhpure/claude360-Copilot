import type { ReactElement } from 'react'
import { X } from 'lucide-react'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  open: boolean
  onClose: () => void
  onInsert: (lyrics: string) => void
  t: TFn
}

// 歌词助手抽屉：提供几段常用歌词结构模板，点击即插入到创作面板歌词框。
// 纯展示 + 回调注入，不含任何网络/AI 调用（第一阶段仅结构模板）。
const TEMPLATE_KEYS = ['musicLyricsTplPop', 'musicLyricsTplBallad', 'musicLyricsTplRap'] as const

const TEMPLATE_BODY: Record<(typeof TEMPLATE_KEYS)[number], string> = {
  musicLyricsTplPop: '[Verse]\n\n[Pre-Chorus]\n\n[Chorus]\n\n[Verse]\n\n[Chorus]\n\n[Outro]',
  musicLyricsTplBallad: '[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Bridge]\n\n[Chorus]',
  musicLyricsTplRap: '[Intro]\n\n[Verse 1]\n\n[Hook]\n\n[Verse 2]\n\n[Hook]\n\n[Outro]'
}

export function LyricsAssistantDrawer({ open, onClose, onInsert, t }: Props): ReactElement | null {
  if (!open) return null
  return (
    <aside
      data-testid="music-lyrics-drawer"
      className="flex w-full max-w-[320px] shrink-0 flex-col gap-3 rounded-2xl border border-ds-border bg-ds-card p-4"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-[13.5px] font-semibold text-ds-ink">{t('musicLyricsAssistant')}</h3>
        <button type="button" aria-label={t('musicClose')} onClick={onClose} className="text-ds-faint hover:text-ds-ink">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </header>
      <p className="text-[12px] text-ds-faint">{t('musicLyricsAssistantHint')}</p>
      <ul className="flex flex-col gap-2">
        {TEMPLATE_KEYS.map((key) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => onInsert(TEMPLATE_BODY[key])}
              className="w-full rounded-xl border border-ds-border bg-ds-main px-3 py-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
            >
              {t(key)}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
