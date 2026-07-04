import type { ReactElement } from 'react'
import { FilePenLine, FilePlus2, FolderOpen, ListTodo, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WriteWorkspaceStart({
  onAskAssistant,
  onCreateDraft,
  onPickWorkspace,
  onRefreshWorkspace,
  workspaceName,
  workspacePathLabel
}: {
  onAskAssistant: () => void
  onCreateDraft: () => void
  onPickWorkspace: () => void
  onRefreshWorkspace: () => void
  workspaceName: string
  workspacePathLabel: string
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="write-start-shell relative h-full min-h-[420px] overflow-auto rounded-[28px] bg-[linear-gradient(180deg,color-mix(in_srgb,white_82%,transparent),color-mix(in_srgb,var(--ds-bg-canvas)_62%,transparent))] px-5 py-5 dark:bg-[linear-gradient(180deg,color-mix(in_srgb,white_7%,transparent),color-mix(in_srgb,white_2.5%,transparent))] sm:px-8 sm:py-8">
      <div className="write-start-grid mx-auto grid min-h-full w-full max-w-6xl gap-6">
        <section className="write-start-hero min-w-0 py-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--ds-accent)_15%,transparent)] bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-accent">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
            <span>{t('writeStudio')}</span>
          </div>
          <h2 className="write-start-heading mt-5 max-w-[12ch] text-[clamp(2.25rem,5vw,3.25rem)] font-semibold leading-[1.08] tracking-[0] text-ds-ink">
            {t('writeStartTitle')}
          </h2>
          <p className="write-start-copy mt-4 max-w-[56ch] text-[15px] leading-7 text-ds-muted">
            {t('writeStartSub')}
          </p>

          <div className="write-start-primary-actions mt-7 grid gap-3">
            <button
              type="button"
              onClick={onCreateDraft}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white shadow-[0_14px_30px_color-mix(in_srgb,var(--ds-accent)_22%,transparent)] transition hover:brightness-110"
            >
              <FilePlus2 className="h-4 w-4" strokeWidth={1.9} />
              {t('writeStartNewDraft')}
            </button>
            <button
              type="button"
              onClick={onAskAssistant}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-ds-border bg-white/70 px-5 text-[14px] font-semibold text-ds-ink shadow-sm transition hover:bg-white dark:bg-white/[0.055] dark:hover:bg-white/[0.08]"
            >
              <ListTodo className="h-4 w-4 text-ds-success" strokeWidth={1.9} />
              {t('writeStartAskAi')}
            </button>
          </div>

          <div className="write-start-shortcuts mt-7 grid gap-3">
            <button
              type="button"
              onClick={onRefreshWorkspace}
              className="group flex min-h-[82px] items-center gap-3 rounded-2xl border border-ds-border-muted bg-ds-card px-4 py-3 text-left transition hover:border-[color-mix(in_srgb,var(--ds-accent)_25%,transparent)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <RefreshCw className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ds-ink">
                  {t('writeStartRefresh')}
                </span>
                <span className="mt-1 block text-[12.5px] leading-5 text-ds-faint">
                  {t('writeStartRefreshSub')}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={onPickWorkspace}
              className="group flex min-h-[82px] items-center gap-3 rounded-2xl border border-ds-border-muted bg-ds-card px-4 py-3 text-left transition hover:border-[color-mix(in_srgb,var(--ds-accent)_25%,transparent)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ds-skill-soft text-ds-skill">
                <FolderOpen className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ds-ink">
                  {t('writeStartChangeWorkspace')}
                </span>
                <span className="mt-1 block truncate text-[12.5px] leading-5 text-ds-faint">
                  {workspaceName}
                </span>
              </span>
            </button>
          </div>
        </section>

        <aside className="write-start-card min-w-0 rounded-[24px] border border-ds-border-muted bg-ds-card p-5 shadow-[var(--c360-shadow-sm)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-ds-faint">
                {t('writeStartWorkspaceLabel')}
              </div>
              <div className="mt-1 truncate text-[18px] font-semibold text-ds-ink">
                {workspaceName}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-ds-success-soft px-2.5 py-1 text-[11.5px] font-semibold text-ds-success">
              {t('writeStartReadyLabel')}
            </span>
          </div>

          <div className="mt-5 rounded-[20px] border border-ds-border-muted bg-ds-subtle p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <FilePenLine className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ds-ink">
                  {t('writeStartPreviewTitle')}
                </div>
                <div className="mt-1 text-[12.5px] leading-5 text-ds-faint">
                  {t('writeStartPreviewSub')}
                </div>
              </div>
            </div>
            <div className="mt-6 space-y-3" aria-hidden="true">
              <div className="h-3 w-2/3 rounded-full bg-[color-mix(in_srgb,var(--ds-text)_10%,transparent)]" />
              <div className="h-2.5 w-full rounded-full bg-[color-mix(in_srgb,var(--ds-text)_6%,transparent)]" />
              <div className="h-2.5 w-11/12 rounded-full bg-[color-mix(in_srgb,var(--ds-text)_6%,transparent)]" />
              <div className="h-2.5 w-4/5 rounded-full bg-[color-mix(in_srgb,var(--ds-text)_6%,transparent)]" />
              <div className="pt-2">
                <div className="h-2.5 w-1/2 rounded-full bg-accent-soft" />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-ds-border-muted bg-ds-subtle px-4 py-3">
            <div className="text-[12px] font-semibold text-ds-faint">
              {t('writeStartWorkspacePath')}
            </div>
            <div className="mt-2 break-all font-mono text-[12px] leading-5 text-ds-muted" title={workspacePathLabel}>
              {workspacePathLabel}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
