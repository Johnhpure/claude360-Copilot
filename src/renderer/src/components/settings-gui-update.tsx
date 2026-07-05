import type { ReactElement } from 'react'
import type { GuiUpdateInfo, GuiUpdateProgress } from '@shared/gui-update'
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

export function GuiUpdateControl({
  info,
  checking,
  downloading,
  installing,
  downloaded,
  progress,
  error,
  onCheck,
  onDownload,
  onInstall,
  t
}: {
  info: GuiUpdateInfo | null
  checking: boolean
  downloading: boolean
  installing: boolean
  downloaded: boolean
  progress: GuiUpdateProgress | null
  error: string | null
  onCheck: () => Promise<void>
  onDownload: () => Promise<void>
  onInstall: () => Promise<void>
  t: (key: string, values?: Record<string, unknown>) => string
}): ReactElement {
  const busy = checking || downloading || installing

  let title = ''
  let detail: string | null = null
  let tone: 'neutral' | 'good' | 'warn' | 'error' = 'neutral'

  if (downloading) {
    title = t('guiUpdateDownloading', { percent: Math.max(0, Math.round(progress?.percent ?? 0)) })
    detail = progress
      ? t('guiUpdateDownloadProgress', {
          transferred: formatBytes(progress.transferred),
          total: formatBytes(progress.total),
          speed: formatBytes(progress.bytesPerSecond)
        })
      : null
    tone = 'warn'
  } else if (installing) {
    title = t('guiUpdateInstalling')
    tone = 'warn'
  } else if (downloaded && info?.ok) {
    title = t('guiUpdateDownloaded', { version: info.latestVersion })
    detail = t('guiUpdateDownloadedDesc')
    tone = 'warn'
  } else if (checking && !info) {
    title = t('guiUpdateChecking')
  } else if (error) {
    title = t('guiUpdateCheckFailed')
    detail = error
    tone = 'error'
  } else if (info && !info.ok && info.code === 'not_configured') {
    title = t('guiUpdateNotConfiguredTitle')
    detail = t('guiUpdateErrNotConfigured')
    tone = 'warn'
  } else if (info?.ok && info.hasUpdate) {
    title = info.manualOnly
      ? t('guiUpdateAvailableManual', { current: info.currentVersion, latest: info.latestVersion })
      : t('guiUpdateAvailable', { current: info.currentVersion, latest: info.latestVersion })
    tone = 'warn'
  } else if (info?.ok) {
    title = t('guiUpdateCurrent', { version: info.currentVersion })
    tone = 'good'
  }

  const releaseUrl: string | null =
    info?.ok && info.hasUpdate ? info.releaseUrl : !info?.ok && info?.releaseUrl ? info.releaseUrl : null
  const canDownload = Boolean(info?.ok && info.hasUpdate && !info.manualOnly && !downloaded)
  const canInstall = Boolean(info?.ok && downloaded)

  const panelClass =
    tone === 'error'
      ? 'border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft text-ds-danger'
      : tone === 'warn'
        ? 'border-[color-mix(in_srgb,var(--ds-warning)_35%,transparent)] bg-ds-warning-soft text-ds-warning'
        : tone === 'good'
          ? 'border-[color-mix(in_srgb,var(--ds-success)_35%,transparent)] bg-ds-success-soft text-ds-success'
          : 'border-ds-border bg-ds-card text-ds-ink'

  return (
    <div className="w-full min-w-0 md:max-w-md">
      <div className={`rounded-[var(--radius-md)] border px-3 py-2.5 ${panelClass}`}>
        <div className="flex items-start gap-2">
          {busy ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
          ) : error ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          )}
          <div className="min-w-0">
            <div className="break-words text-[13px] font-semibold">
              {title}
            </div>
            {detail ? (
              <div className="mt-0.5 break-words text-[12px] leading-5 opacity-75">{detail}</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void onCheck()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          {t('guiUpdateCheck')}
        </button>
        {canDownload || downloading ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={!canDownload || busy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('guiUpdateDownload')}
          </button>
        ) : null}
        {canInstall || installing ? (
          <button
            type="button"
            onClick={() => void onInstall()}
            disabled={!canInstall || installing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t('guiUpdateInstall')}
          </button>
        ) : null}
        {releaseUrl ? (
          <button
            type="button"
            onClick={() => void window.kunGui.openExternal(releaseUrl).catch(() => undefined)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
          >
            {t('guiUpdateOpenRelease')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
