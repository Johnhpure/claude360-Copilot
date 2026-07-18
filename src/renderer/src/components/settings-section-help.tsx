import { useEffect, useState, type ReactElement } from 'react'
import { AlertCircle, CheckCircle2, Download } from 'lucide-react'
import type { DiagnosticsExportResult } from '@shared/diagnostics'
import { Button } from './ui'
import brandLogoUrl from '../assets/claude360-copilot-logo.png'

export type DiagnosticsExportUiState =
  | { status: 'idle' }
  | { status: 'success'; path: string }
  | { status: 'error'; message: string }

export async function runDiagnosticsExport(
  exporter: (() => Promise<DiagnosticsExportResult>) | undefined
): Promise<DiagnosticsExportUiState> {
  if (!exporter) return { status: 'error', message: 'diagnostics-unavailable' }
  try {
    const result = await exporter()
    if (result.ok === true) return { status: 'success', path: result.path }
    if ('canceled' in result && result.canceled) return { status: 'idle' }
    return { status: 'error', message: result.message }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function HelpSettingsSection({
  t
}: {
  t: (key: string) => string
}): ReactElement {
  const [isExporting, setIsExporting] = useState(false)
  const [result, setResult] = useState<DiagnosticsExportUiState>({ status: 'idle' })
  const [appVersion, setAppVersion] = useState('')
  const exporter = typeof window !== 'undefined' && typeof window.kunGui?.exportDiagnostics === 'function'
    ? () => window.kunGui.exportDiagnostics()
    : undefined

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.kunGui?.getAppVersion !== 'function') return
    let disposed = false
    void window.kunGui
      .getAppVersion()
      .then((version) => {
        if (!disposed && typeof version === 'string') setAppVersion(version)
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [])

  const handleExport = async (): Promise<void> => {
    if (isExporting) return
    setIsExporting(true)
    setResult({ status: 'idle' })
    const next = await runDiagnosticsExport(exporter)
    setResult(next)
    setIsExporting(false)
  }

  return (
    <section aria-labelledby="help-center-title">
      <div className="mb-4">
        <h2 id="help-center-title" className="text-[18px] font-semibold text-ds-ink">
          {t('helpCenter')}
        </h2>
      </div>
      <div className="pb-5">
        <div className="text-[14px] font-semibold text-ds-ink">{t('aboutTitle')}</div>
        <div className="mt-3 flex items-start gap-4">
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
            <img src={brandLogoUrl} alt="" draggable={false} className="h-full w-full select-none" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[15px] font-semibold text-ds-ink">Claude360 Copilot</span>
              {appVersion ? (
                <span className="text-[12.5px] text-ds-faint">v{appVersion}</span>
              ) : null}
            </div>
            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ds-muted">{t('aboutIntro')}</p>
            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ds-muted">{t('aboutFeatures')}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4 border-y border-ds-border py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ds-ink">{t('exportDiagnostics')}</div>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ds-muted">
            {t('exportDiagnosticsDesc')}
          </p>
        </div>
        <Button
          variant="secondary"
          className="min-w-[148px] shrink-0"
          loading={isExporting}
          disabled={!exporter}
          onClick={() => void handleExport()}
        >
          {!isExporting ? <Download className="h-4 w-4" aria-hidden /> : null}
          {isExporting ? t('exportDiagnosticsWorking') : t('exportDiagnostics')}
        </Button>
      </div>
      <div className="min-h-10 pt-3" aria-live="polite">
        {!exporter ? (
          <div className="flex items-start gap-2 text-[13px] text-ds-warning">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t('exportDiagnosticsUnavailable')}</span>
          </div>
        ) : result.status === 'success' ? (
          <div className="flex min-w-0 items-start gap-2 text-[13px] text-ds-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-all">
              {t('exportDiagnosticsSuccess')} {result.path}
            </span>
          </div>
        ) : result.status === 'error' ? (
          <div role="alert" className="flex min-w-0 items-start gap-2 text-[13px] text-ds-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              {t('exportDiagnosticsFailed')}: {result.message}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
