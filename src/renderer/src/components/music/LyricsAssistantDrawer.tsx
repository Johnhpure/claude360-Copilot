import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { generateLyrics, type LyricsStreamApi, type LyricsStreamHandle } from '../../music/lyrics-ai'
import { Button, Card, Input, Select } from '../ui'

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

// ✨ AI 写词助手（overlay 抽屉模态，阶段4 迁移）：主题/语言/情绪/结构 → 流式生成歌词 → 采用并填入。
// 维持抽屉交互（Esc/遮罩关闭、原地渲染便于静态测试），视觉归一 Calm Blue：
// 遮罩 = bg-black/45 + blur(var(--blur-overlay))（浮层唯一 blur 场景，随 data-blur 降级）；
// 面板 = surface-elevated + --radius-2xl；表单控件走 ui/ 原语；结果容器接 ui/Card。
// 生成副作用走注入的 streamApi（generateLyrics），组件本身保持 props 注入可静态渲染测试。
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

  return (
    <>
      <div
        className="ds-ui-anim-overlay-fade fixed inset-0 z-[200] bg-black/45 backdrop-blur-[var(--blur-overlay)]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        data-testid="music-lyrics-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lyrics-ai-title"
        className="ds-ui-anim-modal-panel fixed left-1/2 top-1/2 z-[201] flex max-h-[calc(100dvh-48px)] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-ds-border bg-ds-elevated shadow-[var(--c360-shadow-overlay)]"
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
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-ds-faint transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div data-testid="lyrics-ai-model" className="flex flex-col gap-1 text-[12px] text-ds-muted">
            <span>{t('musicLyricsAiModel')}</span>
            <Select
              value={usedModel || null}
              options={textModels.map((m) => ({ value: m, label: m }))}
              onChange={setModel}
              placeholder="—"
              aria-label={t('musicLyricsAiModel')}
            />
          </div>

          <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
            <span className="flex items-center justify-between">
              {t('musicLyricsAiTheme')}
              <button
                type="button"
                onClick={() => setTheme(defaultTheme)}
                className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('musicLyricsAiThemeFromDesc')}
              </button>
            </span>
            <Input
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="城市夜晚 · 霓虹 · 孤独又自由"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
              {t('musicLyricsAiLang')}
              <Input value={lang} onChange={(e) => setLang(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ds-muted">
              {t('musicLyricsAiMood')}
              <Input value={mood} onChange={(e) => setMood(e.target.value)} />
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
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors duration-[var(--motion-fast)] ${
                    s === structure
                      ? 'border-ds-accent bg-ds-accent-soft font-semibold text-ds-accent'
                      : 'border-ds-border bg-ds-main text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="primary"
            size="lg"
            data-testid="lyrics-ai-generate"
            onClick={generate}
            disabled={!usedModel || !streamApi}
            loading={busy}
            className="w-full"
          >
            {busy ? null : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            {busy ? t('musicLyricsAiGenerating') : t('musicLyricsAiGenerate')}
          </Button>

          {/* 生成结果容器（接 ui/Card） */}
          <Card unpadded className="p-3">
            <div className="mb-2 text-[11.5px] font-medium text-ds-muted">{t('musicLyricsAiResult')}</div>
            <div
              data-testid="lyrics-ai-result"
              className="min-h-[120px] whitespace-pre-wrap rounded-[var(--radius-md)] border border-ds-border bg-ds-main p-2.5 text-[12.5px] leading-6 text-ds-ink"
            >
              {text ? text : <span className="text-ds-faint">{t('musicLyricsAiResultEmpty')}</span>}
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-[11.5px] text-ds-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                data-testid="lyrics-ai-apply"
                disabled={!text || busy}
                onClick={() => {
                  onInsert(text)
                  onClose()
                }}
                className="flex-1"
              >
                {t('musicLyricsAiApply')}
              </Button>
              <Button variant="secondary" disabled={busy || !usedModel || !streamApi} onClick={generate}>
                {t('musicLyricsAiRegenerate')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
