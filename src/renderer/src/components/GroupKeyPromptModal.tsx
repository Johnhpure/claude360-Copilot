import { type ReactElement, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, KeyRound } from 'lucide-react'
import { useGroupKeyPromptStore } from '../store/group-key-prompt-store'
import { Button, Modal } from './ui'

/**
 * 「是否为该分组创建 API Key」优雅模态。选定一个还没有 Key 的分组模型时弹出，
 * 由 useGroupKeyPromptStore 驱动（open/confirm/cancel）。Code 与写作共用。
 *
 * 阶段2 迁移到统一 Modal 基类（遮罩/圆角/动画由基类接管），
 * 色彩从旧硬编码蓝/绿字面量归一到 accent / success token。
 */
export function GroupKeyPromptModal(): ReactElement | null {
  const { t } = useTranslation('common')
  const group = useGroupKeyPromptStore((s) => s.group)
  const submitting = useGroupKeyPromptStore((s) => s.submitting)
  const succeeded = useGroupKeyPromptStore((s) => s.succeeded)
  const error = useGroupKeyPromptStore((s) => s.error)
  const confirm = useGroupKeyPromptStore((s) => s.confirm)
  const cancel = useGroupKeyPromptStore((s) => s.cancel)
  const reset = useGroupKeyPromptStore((s) => s.reset)

  // 创建成功后短暂展示成功提示，然后自动关闭模态（本次任务已在 confirm 里 resolve 续跑）。
  useEffect(() => {
    if (!succeeded) return
    const id = window.setTimeout(() => reset(), 1600)
    return () => window.clearTimeout(id)
  }, [succeeded, reset])

  if (!group) return null

  if (succeeded) {
    return (
      <Modal open onClose={reset} ariaLabel={t('groupKeySuccess')} size="sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-ds-success-soft text-ds-success">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <p className="text-[14px] font-medium text-ds-ink" data-testid="group-key-success">
            {t('groupKeySuccess')}
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={cancel}
      ariaLabel={t('groupKeyPromptTitle')}
      size="sm"
      dismissable={!submitting}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
          <KeyRound className="h-5 w-5" />
        </span>
        <h2 className="text-[15px] font-semibold text-ds-ink">{t('groupKeyPromptTitle')}</h2>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ds-muted">{t('groupKeyPromptBody')}</p>
      {error ? (
        <p className="mt-3 text-sm leading-relaxed text-ds-danger" role="alert" data-testid="group-key-error">
          {t('groupKeyPromptError', { message: error })}
        </p>
      ) : null}
      <div className="mt-5 flex justify-end gap-2.5">
        <Button variant="secondary" size="md" disabled={submitting} onClick={cancel}>
          {t('groupKeyPromptCancel')}
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={submitting}
          onClick={() => void confirm()}
        >
          {submitting ? t('groupKeyPromptCreating') : t('groupKeyPromptConfirm')}
        </Button>
      </div>
    </Modal>
  )
}
