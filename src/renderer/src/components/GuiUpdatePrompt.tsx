import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { AlertCircle, ArrowUpCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GuiUpdateCompletedInfo, GuiUpdateInfo, GuiUpdateState } from '@shared/gui-update'

type Translate = (key: string, values?: Record<string, unknown>) => string

type PromptInfo = Extract<GuiUpdateInfo, { ok: true }>
type ReleaseNoteBlock = { kind: 'paragraph' | 'item'; text: string }

function normalizeVersion(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^v/i, '')
}

function promptInfoFromState(state: GuiUpdateState): PromptInfo | null {
  if (
    state.status === 'available' ||
    state.status === 'downloading' ||
    state.status === 'downloaded' ||
    state.status === 'installing'
  ) {
    return state.info?.ok && state.info.hasUpdate ? state.info : null
  }
  if (state.status === 'error' && state.info?.ok && state.info.hasUpdate) {
    return state.info
  }
  return null
}

function updatedInfoFromState(state: GuiUpdateState): GuiUpdateCompletedInfo | null {
  return state.status === 'updated' ? state.info : null
}

export function shouldShowGuiUpdatePrompt(
  state: GuiUpdateState,
  dismissedVersion: string | null | undefined,
  hiddenVersion: string | null | undefined
): boolean {
  if (state.status !== 'available') return false
  const info = state.info
  if (!info.ok || !info.hasUpdate || info.manualOnly) return false
  const latestVersion = normalizeVersion(info.latestVersion)
  if (!latestVersion) return false
  return latestVersion !== normalizeVersion(dismissedVersion) && latestVersion !== normalizeVersion(hiddenVersion)
}

function formatPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase()
    if (normalized in namedEntities) return namedEntities[normalized]
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    }
    return match
  })
}

function cleanReleaseNoteLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseReleaseNoteBlocks(value: string | undefined, fallback: string): ReleaseNoteBlock[] {
  const source = (value?.trim() || fallback).trim()
  if (!source) return []
  const normalized = decodeHtmlEntities(source)
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|section|article|h[1-6]|ul|ol)\s*>/gi, '\n\n')
    .replace(/<\s*(p|div|section|article|h[1-6]|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')

  const blocks: ReleaseNoteBlock[] = []
  let paragraphLines: string[] = []
  const flushParagraph = (): void => {
    const text = cleanReleaseNoteLine(paragraphLines.join(' '))
    if (text) blocks.push({ kind: 'paragraph', text })
    paragraphLines = []
  }

  for (const paragraph of normalized.split(/\n{2,}/)) {
    for (const rawLine of paragraph.split('\n')) {
      const line = cleanReleaseNoteLine(rawLine)
      if (!line) continue
      const item = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/)
      if (item) {
        flushParagraph()
        const text = cleanReleaseNoteLine(item[1])
        if (text) blocks.push({ kind: 'item', text })
        continue
      }
      paragraphLines.push(line)
    }
    flushParagraph()
  }

  return blocks
}

function ReleaseNotesContent({ blocks }: { blocks: ReleaseNoteBlock[] }): ReactElement {
  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.kind === 'item' ? (
          <div key={`${block.kind}-${index}`} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-[0.48rem] h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-ds-muted"
            />
            <span className="min-w-0 break-words">{block.text}</span>
          </div>
        ) : (
          <p key={`${block.kind}-${index}`} className="break-words">
            {block.text}
          </p>
        )
      )}
    </div>
  )
}

export function GuiUpdatePromptPanel({
  state,
  error,
  onDownload,
  onInstall,
  onLater,
  onViewChangelog,
  t
}: {
  state: GuiUpdateState
  error: string | null
  onDownload: () => void | Promise<void>
  onInstall: () => void | Promise<void>
  onLater: () => void | Promise<void>
  onViewChangelog?: () => void | Promise<void>
  t: Translate
}): ReactElement | null {
  const updatedInfo = updatedInfoFromState(state)
  if (updatedInfo) {
    const notes = parseReleaseNoteBlocks(
      updatedInfo.releaseNotes,
      t('guiUpdatePromptReleaseNotesCompletedFallback')
    )

    return (
      <div className="ds-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[var(--blur-overlay)]">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="gui-update-prompt-title"
          className="w-full max-w-[30rem] rounded-[var(--radius-md)] border border-ds-border bg-ds-elevated p-5 text-ds-ink shadow-[var(--c360-shadow-overlay)]"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-ds-success-soft text-ds-success">
              <CheckCircle2 className="h-5 w-5" strokeWidth={1.85} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="gui-update-prompt-title" className="break-words text-[17px] font-semibold text-ds-ink">
                {t('guiUpdatePromptUpdatedTitle', { version: updatedInfo.currentVersion })}
              </h2>
            </div>
          </div>

          <div className="mt-4">
            <h3 className="text-[13px] font-semibold text-ds-ink">
              {t('guiUpdatePromptReleaseNotesHeading')}
            </h3>
            <div className="mt-2 max-h-60 overflow-y-auto rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-card px-3 py-2.5 text-[13px] leading-5 text-ds-muted">
              <ReleaseNotesContent blocks={notes} />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => void onViewChangelog?.()}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('guiUpdatePromptViewChangelog')}
            </button>
            <button
              type="button"
              onClick={() => void onLater()}
              className="rounded-[var(--radius-md)] border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('guiUpdatePromptLater')}
            </button>
          </div>
        </section>
      </div>
    )
  }

  const info = promptInfoFromState(state)
  if (!info) return null

  const downloading = state.status === 'downloading'
  const downloaded = state.status === 'downloaded' || info.downloaded === true
  const installing = state.status === 'installing'
  const percent = state.status === 'downloading' ? formatPercent(state.progress.percent) : 0
  const busy = downloading || installing
  const notes = parseReleaseNoteBlocks(info.releaseNotes, t('guiUpdatePromptReleaseNotesFallback'))
  const statusText = downloading
    ? t('guiUpdatePromptDownloading', { percent })
    : downloaded
      ? t('guiUpdatePromptDownloaded')
      : installing
        ? t('guiUpdatePromptInstalling')
        : t('guiUpdatePromptVersion', { current: info.currentVersion, latest: info.latestVersion })

  return (
    <div className="ds-no-drag fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[var(--blur-overlay)]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="gui-update-prompt-title"
        className="w-full max-w-[32rem] rounded-[var(--radius-md)] border border-ds-border bg-ds-elevated p-5 text-ds-ink shadow-[var(--c360-shadow-overlay)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-ds-warning-soft text-ds-warning">
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowUpCircle className="h-5 w-5" strokeWidth={1.85} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="gui-update-prompt-title" className="break-words text-[17px] font-semibold text-ds-ink">
              {t('guiUpdatePromptTitle', { version: info.latestVersion })}
            </h2>
            <p className="mt-1 break-words text-[13px] leading-5 text-ds-muted">{statusText}</p>
          </div>
        </div>

        {downloading ? (
          <div className="mt-4">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 overflow-hidden rounded-[var(--radius-pill)] bg-ds-border-muted"
            >
              <div className="h-full bg-ds-warning" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : null}

        <div className="mt-4 max-h-48 overflow-y-auto rounded-[var(--radius-md)] border border-ds-border-muted bg-ds-card px-3 py-2.5 text-[13px] leading-5 text-ds-muted">
          <ReleaseNotesContent blocks={notes} />
        </div>

        {error ? (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft px-3 py-2 text-[12.5px] leading-5 text-ds-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
            <span className="break-words">{error}</span>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {!downloaded && !downloading && !installing ? (
            <button
              type="button"
              onClick={() => void onLater()}
              className="rounded-[var(--radius-md)] border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('guiUpdatePromptLater')}
            </button>
          ) : null}
          {downloaded ? (
            <button
              type="button"
              onClick={() => void onInstall()}
              disabled={installing}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {t('guiUpdatePromptInstall')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onDownload()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {t('guiUpdatePromptDownload')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

export function GuiUpdatePrompt(): ReactElement | null {
  const { t } = useTranslation('common')
  const [state, setState] = useState<GuiUpdateState>({ status: 'idle' })
  const [dismissedVersion, setDismissedVersion] = useState<string | undefined>()
  const [dismissedLoaded, setDismissedLoaded] = useState(false)
  const [hiddenVersion, setHiddenVersion] = useState<string | null>(null)
  const [hiddenCompletedVersion, setHiddenCompletedVersion] = useState<string | null>(null)
  const [promptVersion, setPromptVersion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window.kunGui?.onGuiUpdateState === 'function') {
      const unsubscribe = window.kunGui.onGuiUpdateState(setState)
      return unsubscribe
    }
    return undefined
  }, [])

  useEffect(() => {
    if (typeof window.kunGui?.getGuiUpdateState === 'function') {
      void window.kunGui.getGuiUpdateState().then(setState).catch(() => undefined)
    }
    if (typeof window.kunGui?.getDismissedGuiUpdateVersion === 'function') {
      void window.kunGui.getDismissedGuiUpdateVersion()
        .then(setDismissedVersion)
        .catch(() => undefined)
        .finally(() => setDismissedLoaded(true))
    } else {
      setDismissedLoaded(true)
    }
  }, [])

  const info = useMemo(() => promptInfoFromState(state), [state])
  const updatedInfo = useMemo(() => updatedInfoFromState(state), [state])
  const shouldOpen = dismissedLoaded && shouldShowGuiUpdatePrompt(state, dismissedVersion, hiddenVersion)

  useEffect(() => {
    if (shouldOpen && info) {
      setPromptVersion(normalizeVersion(info.latestVersion))
    }
  }, [info, shouldOpen])

  useEffect(() => {
    if (!info && promptVersion) {
      setPromptVersion(null)
      setError(null)
    }
  }, [info, promptVersion])

  const handleLater = useCallback(async (): Promise<void> => {
    if (updatedInfo) {
      setHiddenCompletedVersion(normalizeVersion(updatedInfo.currentVersion))
      setError(null)
      return
    }
    if (!info) return
    const version = normalizeVersion(info.latestVersion)
    if (typeof window.kunGui?.dismissGuiUpdateVersion === 'function') {
      await window.kunGui.dismissGuiUpdateVersion(version)
    }
    setDismissedVersion(version)
    setHiddenVersion(version)
    setPromptVersion(null)
    setError(null)
  }, [info, updatedInfo])

  const handleViewChangelog = useCallback(async (): Promise<void> => {
    if (!updatedInfo) return
    if (typeof window.kunGui?.openExternal === 'function') {
      await window.kunGui.openExternal(updatedInfo.releaseUrl)
    }
    setHiddenCompletedVersion(normalizeVersion(updatedInfo.currentVersion))
  }, [updatedInfo])

  const handleDownload = useCallback(async (): Promise<void> => {
    if (!info || typeof window.kunGui?.downloadGuiUpdate !== 'function') return
    setError(null)
    const result = await window.kunGui.downloadGuiUpdate(info.channel)
    if (!result.ok) {
      setError(result.message)
    }
  }, [info])

  const handleInstall = useCallback(async (): Promise<void> => {
    if (typeof window.kunGui?.installGuiUpdate !== 'function') return
    setError(null)
    const result = await window.kunGui.installGuiUpdate()
    if (!result.ok) {
      setError(result.message)
    }
  }, [])

  if (updatedInfo) {
    const version = normalizeVersion(updatedInfo.currentVersion)
    if (version && version === hiddenCompletedVersion) return null
    return (
      <GuiUpdatePromptPanel
        state={state}
        error={null}
        onDownload={handleDownload}
        onInstall={handleInstall}
        onLater={handleLater}
        onViewChangelog={handleViewChangelog}
        t={t}
      />
    )
  }

  if (!info || normalizeVersion(info.latestVersion) !== promptVersion) return null

  return (
    <GuiUpdatePromptPanel
      state={state}
      error={error}
      onDownload={handleDownload}
      onInstall={handleInstall}
      onLater={handleLater}
      t={t}
    />
  )
}
