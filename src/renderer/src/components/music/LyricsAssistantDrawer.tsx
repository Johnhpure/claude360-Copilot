import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { generateLyrics, type LyricsStreamApi, type LyricsStreamHandle } from '../../music/lyrics-ai'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  open: boolean
  onClose: () => void
  onInsert: (lyrics: string) => void
  /** 左侧「歌曲描述」，作为主题留空时的回退。 */
  defaultTheme: string
  /** 文本模型下拉数据源（来自 text 分组模型列表）。 */
  textModels: string[]
  /** 流式写词 IPC（注入，便于测试）。为空时生成按钮禁用。 */
  streamApi: LyricsStreamApi | null
  t: TFn
}

const STRUCTURE_OPTIONS = ['主歌-副歌', '含 Bridge', '自由发挥']

// ✨ AI 写词助手（overlay 模态）：主题/语言/情绪/结构 → 流式生成歌词 → 采用并填入。
// 参考 claude360-music-web LyricsAiDrawer。生成副作用走注入的 streamApi（generateLyrics），
// 组件本身保持 props 注入可静态渲染测试。
export function LyricsAssistantDrawer({
  open,
  onClose,
  onInsert,
  defaultTheme,
  textModels,
  streamApi,
  t
}: Props): ReactElement | null {
  const [model, setModel] = useState('')
  const [theme, setTheme] = useState('')
  const [lang, setLang] = useState('中文')
  const [mood, setMood] = useState('忧郁而热烈')
  const [structure, setStructure] = useState(STRUCTURE_OPTIONS[0])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<LyricsStreamHandle | null>(null)

  const usedModel = model || textModels[0] || ''

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      handleRef.current?.cancel()
      handleRef.current = null
    }
  }, [open, onClose])

  if (!open) return null

  const generate = (): void => {
    if (!streamApi || !usedModel) return
    handleRef.current?.cancel()
    setText('')
    setError(null)
    setBusy(true)
    handleRef.current = generateLyrics(
      streamApi,
      { model: usedModel, theme: theme || defaultTheme, lang, mood, structure },
      {
        onDelta: (d) => setText((prev) => prev + d),
        onEnd: () => setBusy(false),
        onError: (m) => {
          setBusy(false)
          setError(m)
        }
      }
    )
  }

  const inputCls =
    'w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-2 text-[12.5px] text-ds-ink'

  return (
    <>
      <div
        className="fixed inset-0 z-[200] bg-[rgba(15,20,34,0.55)] backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        data-testid="music-lyrics-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lyrics-ai-title"
        className="fixed left-1/2 top-1/2 z-[201] flex max-h-[calc(100dvh-48px)] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl"
      >
        <header className="flex items-start gap-3 border-b border-ds-border px-5 py-4">
          <div className="min-w-0">
            <h3 id="lyrics-ai-title" className="text-[15px] font-bold text-ds-ink">
              {t('musicLyricsAiTitle')}
            </h3>
            <p className="mt-1 text-[12px] text-ds-faint">{t('musicLyricsAiDesc')}</p>
          </div>
          <button
            type="button"
            aria-label={t('musicClose')}
            onClick={onClose}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
            {t('musicLyricsAiModel')}
            <select
              data-testid="lyrics-ai-model"
              value={usedModel}
              onChange={(e) => setModel(e.target.value)}
              className={inputCls}
            >
              {textModels.length === 0 ? <option value="">—</option> : null}
              {textModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
            <span className="flex items-center justify-between">
              {t('musicLyricsAiTheme')}
              <button
                type="button"
                onClick={() => setTheme(defaultTheme)}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('musicLyricsAiThemeFromDesc')}
              </button>
            </span>
            <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="城市夜晚 · 霓虹 · 孤独又自由" className={inputCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
              {t('musicLyricsAiLang')}
              <input value={lang} onChange={(e) => setLang(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
              {t('musicLyricsAiMood')}
              <input value={mood} onChange={(e) => setMood(e.target.value)} className={inputCls} />
            </label>
          </div>

          <div className="flex flex-col gap-1.5 text-[12px] text-ds-muted">
            {t('musicLyricsAiStructure')}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('musicLyricsAiStructure')}>
              {STRUCTURE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={s === structure}
                  onClick={() => setStructure(s)}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${
                    s === structure
                      ? 'border-ds-accent bg-ds-accent-soft font-semibold text-ds-accent'
                      : 'border-ds-border bg-ds-main text-ds-muted hover:text-ds-ink'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            data-testid="lyrics-ai-generate"
            onClick={generate}
            disabled={busy || !usedModel || !streamApi}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-ds-ink px-4 text-[13px] font-semibold text-ds-main shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} />}
            {busy ? t('musicLyricsAiGenerating') : t('musicLyricsAiGenerate')}
          </button>

          <section className="rounded-xl border border-ds-border bg-ds-main p-3">
            <div className="mb-2 text-[11.5px] font-medium text-ds-muted">{t('musicLyricsAiResult')}</div>
            <div
              data-testid="lyrics-ai-result"
              className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-ds-border bg-ds-card p-2.5 text-[12.5px] leading-6 text-ds-ink"
            >
              {text ? text : <span className="text-ds-faint">{t('musicLyricsAiResultEmpty')}</span>}
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-[11.5px] text-ds-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="lyrics-ai-apply"
                disabled={!text || busy}
                onClick={() => {
                  onInsert(text)
                  onClose()
                }}
                className="flex-1 rounded-lg bg-ds-ink px-3 py-2 text-[12.5px] font-semibold text-ds-main transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('musicLyricsAiApply')}
              </button>
              <button
                type="button"
                disabled={busy || !usedModel || !streamApi}
                onClick={generate}
                className="rounded-lg border border-ds-border px-3 py-2 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('musicLyricsAiRegenerate')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
