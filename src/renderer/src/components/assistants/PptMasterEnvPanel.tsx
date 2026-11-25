import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertCircle, Check, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  PptMasterPythonState,
  PptMasterSkillState,
  PptMasterState
} from '../../../../shared/ppt-master'

/**
 * Environment readiness for the PPT assistant.
 *
 * Its skill package and Python venv are provisioned in the background after
 * startup, so in the normal case this panel just confirms both are ready. It
 * exists for the cases that need a human: no Python on the machine, no network
 * during provisioning, or a half-built venv that needs rebuilding.
 */

type RowStatus = 'ready' | 'pending' | 'busy' | 'error'

export function PptMasterEnvPanel(): ReactElement | null {
  const { t } = useTranslation('common')
  const [state, setState] = useState<PptMasterState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    if (typeof window.kunGui?.pptMasterStatus !== 'function') return
    try {
      const next = await window.kunGui.pptMasterStatus()
      if (mounted.current) setState(next)
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause))
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    // Background provisioning pushes the same state shape, so an install that
    // started without the user (or from the marketplace card) shows up here live.
    const unsubscribe = typeof window.kunGui?.onPptMasterProgress === 'function'
      ? window.kunGui.onPptMasterProgress((next) => {
        if (mounted.current) setState(next)
      })
      : undefined
    return () => {
      mounted.current = false
      unsubscribe?.()
    }
  }, [refresh])

  const runAction = useCallback(async (action: 'install' | 'repair') => {
    const invoke = action === 'install'
      ? window.kunGui?.pptMasterInstall
      : window.kunGui?.pptMasterRepair
    if (typeof invoke !== 'function') return
    setBusy(true)
    setError(null)
    try {
      const result = await invoke()
      if (!mounted.current) return
      setState(result.state)
      if (!result.ok) setError(result.message)
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  if (state === null && error === null) return null

  const skill = state?.skill
  const python = state?.python
  const ready = skill?.status === 'ready' && python?.status === 'ready'
  const installing = busy ||
    skill?.status === 'downloading' ||
    skill?.status === 'extracting' ||
    skill?.status === 'verifying' ||
    python?.status === 'installing'

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-ds-border bg-ds-raised px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ds-faint">
          {t('pptMasterEnvTitle')}
        </h3>
        {ready ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-ds-muted">
            <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} />
            {t('pptMasterEnvReady')}
          </span>
        ) : null}
      </div>

      <StatusRow
        label={t('pptMasterEnvSkill')}
        status={rowStatusForSkill(skill)}
        detail={skillDetail(skill, t)}
      />
      <StatusRow
        label={t('pptMasterEnvPython')}
        status={rowStatusForPython(python)}
        detail={pythonDetail(python, t)}
      />

      {error ? (
        <p className="text-[11.5px] leading-snug text-ds-danger">{error}</p>
      ) : (
        <p className="text-[11.5px] leading-snug text-ds-faint">
          {ready ? t('pptMasterEnvSandboxHint') : t('pptMasterEnvAutoHint')}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={installing}
          className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('pptMasterEnvRecheck')}
        </button>
        {ready ? (
          <button
            type="button"
            onClick={() => void runAction('repair')}
            disabled={installing}
            className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          >
            <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('pptMasterEnvRepair')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runAction('install')}
            disabled={installing}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : null}
            {installing ? t('pptMasterEnvInstalling') : t('pptMasterEnvInstall')}
          </button>
        )}
      </div>
    </section>
  )
}

function StatusRow({
  label,
  status,
  detail
}: {
  label: string
  status: RowStatus
  detail: string
}): ReactElement {
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <StatusIcon status={status} />
      <span className="shrink-0 text-ds-ink">{label}</span>
      <span className="min-w-0 flex-1 text-right text-ds-muted">{detail}</span>
    </div>
  )
}

function StatusIcon({ status }: { status: RowStatus }): ReactElement {
  if (status === 'ready') {
    return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} />
  }
  if (status === 'busy') {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-ds-muted" strokeWidth={2} />
  }
  return (
    <AlertCircle
      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${status === 'error' ? 'text-ds-danger' : 'text-ds-faint'}`}
      strokeWidth={1.9}
    />
  )
}

export function rowStatusForSkill(skill: PptMasterSkillState | undefined): RowStatus {
  if (!skill) return 'pending'
  if (skill.status === 'ready') return 'ready'
  if (skill.status === 'error') return 'error'
  if (skill.status === 'missing') return 'pending'
  return 'busy'
}

export function rowStatusForPython(python: PptMasterPythonState | undefined): RowStatus {
  if (!python) return 'pending'
  if (python.status === 'ready') return 'ready'
  if (python.status === 'error') return 'error'
  if (python.status === 'installing') return 'busy'
  return 'pending'
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export function skillDetail(skill: PptMasterSkillState | undefined, t: Translate): string {
  if (!skill) return t('pptMasterEnvChecking')
  switch (skill.status) {
    case 'ready':
      return skill.version ? `v${skill.version}` : t('pptMasterEnvReady')
    case 'downloading':
      return t('pptMasterEnvDownloading', { progress: formatProgress(skill) })
    case 'extracting':
      return t('pptMasterEnvExtracting')
    case 'verifying':
      return t('pptMasterEnvVerifying')
    case 'error':
      return skill.message ?? t('pptMasterEnvError')
    default:
      return t('pptMasterEnvMissing')
  }
}

export function pythonDetail(python: PptMasterPythonState | undefined, t: Translate): string {
  if (!python) return t('pptMasterEnvChecking')
  switch (python.status) {
    case 'ready':
      return python.version ? `Python ${python.version}` : t('pptMasterEnvReady')
    case 'installing':
      return python.progress ?? t('pptMasterEnvInstalling')
    case 'error':
      return python.message ?? t('pptMasterEnvError')
    default:
      return python.missingModules?.length
        ? t('pptMasterEnvMissingModules', { count: python.missingModules.length })
        : t('pptMasterEnvMissing')
  }
}

/** `12.3 MB / 116.0 MB` when the server sent a length, otherwise just the received size. */
export function formatProgress(skill: PptMasterSkillState): string {
  const received = formatBytes(skill.receivedBytes ?? 0)
  const total = skill.totalBytes
  return total && total > 0 ? `${received} / ${formatBytes(total)}` : received
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
