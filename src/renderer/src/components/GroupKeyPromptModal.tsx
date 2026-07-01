import { type ReactElement, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Loader2 } from 'lucide-react'
import { useGroupKeyPromptStore } from '../store/group-key-prompt-store'

/**
 * 「是否为该分组创建 API Key」优雅模态。选定一个还没有 Key 的分组模型时弹出，
 * 由 useGroupKeyPromptStore 驱动（open/confirm/cancel）。Code 与写作共用。
 */
export function GroupKeyPromptModal(): ReactElement | null {
  const { t } = useTranslation('common')
  const group = useGroupKeyPromptStore((s) => s.group)
  const submitting = useGroupKeyPromptStore((s) => s.submitting)
  const confirm = useGroupKeyPromptStore((s) => s.confirm)
  const cancel = useGroupKeyPromptStore((s) => s.cancel)

  useEffect(() => {
    if (!group) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !submitting) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [group, submitting, cancel])

  if (!group) return null

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('groupKeyPromptTitle', { group })}
    >
      <div className="w-full max-w-sm rounded-2xl border border-ds-border bg-ds-card p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-300">
            <KeyRound className="h-5 w-5" />
          </span>
          <h2 className="text-[15px] font-semibold text-ds-strong">
            {t('groupKeyPromptTitle', { group })}
          </h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ds-muted">{t('groupKeyPromptBody')}</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button
            type="button"
            disabled={submitting}
            onClick={cancel}
            className="rounded-full border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-strong disabled:opacity-50"
          >
            {t('groupKeyPromptCancel')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void confirm()}
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('groupKeyPromptCreating')}
              </>
            ) : (
              t('groupKeyPromptConfirm')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
