import type { ReactElement } from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, FolderOpen } from 'lucide-react'

export function RuntimeBanner({
  message,
  detail,
  code,
  logPath,
  onOpenLogDir,
  onOpenSettings,
  onRetryConnection,
  runtimeReady,
  stageInsetClass,
  t
}: {
  message: string
  detail?: string | null
  code?: string | null
  logPath?: string | null
  onOpenLogDir?: () => Promise<{ ok: boolean; message?: string }>
  onOpenSettings: () => void
  onRetryConnection: () => void
  runtimeReady: boolean
  stageInsetClass: string
  t: (key: string) => string
}): ReactElement {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [logOpenError, setLogOpenError] = useState<string | null>(null)
  const cleanedLogPath = logPath?.trim() ?? ''
  const technicalDetailText = [
    code ? `Code: ${code}` : '',
    detail?.trim() ?? ''
  ].filter(Boolean).join('\n\n')
  const detailText = [
    technicalDetailText,
    cleanedLogPath ? `${t('runtimeErrorLogPath')}: ${cleanedLogPath}` : ''
  ].filter(Boolean).join('\n\n')
  const hasDetail = technicalDetailText.trim().length > 0

  const copyDetails = async (): Promise<void> => {
    if (!hasDetail || !navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(detailText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const openLogDir = async (): Promise<void> => {
    if (!onOpenLogDir) return
    setLogOpenError(null)
    try {
      const result = await onOpenLogDir()
      if (!result.ok) setLogOpenError(result.message ?? t('runtimeErrorOpenLogsFailed'))
    } catch (error) {
      setLogOpenError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="ds-no-drag shrink-0 border-b border-ds-warning-soft bg-ds-warning-soft">
      <div className={`${stageInsetClass} w-full min-w-0`}>
        <div className="flex w-full min-w-0 flex-col gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex w-full min-w-0 items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-[14px] leading-6 text-ds-warning">
              {message}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {hasDetail ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-medium text-ds-warning transition hover:bg-ds-warning-soft"
                  onClick={() => setDetailsOpen((value) => !value)}
                >
                  {detailsOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                  {t('runtimeErrorDetails')}
                </button>
              ) : null}
              {!runtimeReady ? (
                <>
                  <button
                    type="button"
                    className="rounded-lg border border-ds-warning-soft bg-ds-card px-3 py-1 text-[12px] font-medium text-ds-warning transition hover:bg-ds-warning-soft"
                    onClick={onRetryConnection}
                  >
                    {t('retryConnection')}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1 text-[12px] font-medium text-ds-warning transition hover:bg-ds-warning-soft"
                    onClick={onOpenSettings}
                  >
                    {t('openSettings')}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {cleanedLogPath ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] leading-5 text-ds-warning">
              <span className="font-medium">{t('runtimeErrorLogPath')}</span>
              <code className="min-w-0 max-w-full break-all rounded-md bg-ds-card px-2 py-0.5 font-mono text-[12px] text-ds-ink">
                {cleanedLogPath}
              </code>
              {onOpenLogDir ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-ds-warning transition hover:bg-ds-warning-soft"
                  onClick={() => void openLogDir()}
                >
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('windowsMenuOpenLogDir')}
                </button>
              ) : null}
              {logOpenError ? (
                <span className="text-ds-danger">{logOpenError}</span>
              ) : null}
            </div>
          ) : null}
          {hasDetail && detailsOpen ? (
            <div className="rounded-lg border border-ds-warning-soft bg-ds-card p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold text-ds-warning">
                  {t('runtimeErrorTechnicalDetails')}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-ds-warning transition hover:bg-ds-warning-soft"
                  onClick={() => void copyDetails()}
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                  {copied ? t('copySuccess') : t('copyDetails')}
                </button>
              </div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ds-ink">
                {detailText}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
