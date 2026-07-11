import { useEffect, useState, type ReactElement } from 'react'
import { Play } from 'lucide-react'
import type { ImageWorkflowV1, ImageWorkflowVariableV1 } from '@shared/app-settings-types'
import { Button, Input, Modal, Select, Textarea } from '../ui'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  open: boolean
  workflow: ImageWorkflowV1 | null
  /** 校验通过后回调（容器关闭弹窗并启动运行编排）。 */
  onStart: (values: Record<string, string>) => void
  onClose: () => void
  t: TFn
}

/** 按变量定义初始化表单值（默认值回填）。 */
export function initialWorkflowValues(variables: ImageWorkflowVariableV1[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const variable of variables) values[variable.key] = variable.defaultValue
  return values
}

/** 必填校验：返回缺失的变量 key 列表（值为空白即缺失）。 */
export function missingRequiredKeys(
  variables: ImageWorkflowVariableV1[],
  values: Record<string, string>
): string[] {
  return variables
    .filter((variable) => variable.required && !(values[variable.key] ?? '').trim())
    .map((variable) => variable.key)
}

// 运行工作流的变量表单弹窗（prd R4，design §7.5）：按变量类型渲染控件
// （text→Input / textarea→Textarea / number→Input[type=number] / select→Select），
// 必填标记与校验、默认值回填；「开始生成」通过后交容器启动运行。
export function WorkflowRunModal({ open, workflow, onStart, onClose, t }: Props): ReactElement | null {
  const [values, setValues] = useState<Record<string, string>>({})
  const [attempted, setAttempted] = useState(false)

  useEffect(() => {
    if (!open || !workflow) return
    setValues(initialWorkflowValues(workflow.variables))
    setAttempted(false)
  }, [open, workflow])

  if (!open || !workflow) return null

  const missing = new Set(missingRequiredKeys(workflow.variables, values))
  const setValue = (key: string, value: string): void =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleStart = (): void => {
    if (missing.size > 0) {
      setAttempted(true)
      return
    }
    onStart(values)
  }

  const renderControl = (variable: ImageWorkflowVariableV1): ReactElement => {
    const value = values[variable.key] ?? ''
    const invalid = attempted && missing.has(variable.key)
    if (variable.type === 'textarea') {
      return (
        <Textarea
          value={value}
          onChange={(e) => setValue(variable.key, e.target.value)}
          rows={3}
          invalid={invalid}
          className="resize-none text-[12.5px]"
        />
      )
    }
    if (variable.type === 'select') {
      return (
        <Select
          value={value || null}
          options={variable.options.map((option) => ({ value: option, label: option }))}
          onChange={(next) => setValue(variable.key, next)}
          invalid={invalid}
          aria-label={variable.label || variable.key}
        />
      )
    }
    return (
      <Input
        type={variable.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => setValue(variable.key, e.target.value)}
        invalid={invalid}
      />
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={t('canvasWorkflowRunTitle')}
      size="md"
      className="flex max-h-[80vh] flex-col"
    >
      <h2 className="pb-1 text-[15px] font-semibold text-ds-ink">{t('canvasWorkflowRunTitle')}</h2>
      <p className="pb-3 text-[12.5px] text-ds-muted">{workflow.name}</p>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {workflow.variables.map((variable) => (
          <label key={variable.key} className="flex flex-col gap-1" data-testid="workflow-run-field">
            <span className="text-[12px] text-ds-muted">
              {variable.label || variable.key}
              {variable.required ? (
                <span className="text-ds-danger" aria-hidden="true">
                  {' '}
                  *
                </span>
              ) : null}
            </span>
            {renderControl(variable)}
            {attempted && missing.has(variable.key) ? (
              <span role="alert" className="text-[11.5px] text-ds-danger">
                {t('canvasWorkflowRunRequired', { label: variable.label || variable.key })}
              </span>
            ) : null}
          </label>
        ))}
      </div>

      <footer className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-ds-border pt-3">
        <Button variant="secondary" size="md" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="primary" size="md" data-testid="workflow-run-start" onClick={handleStart}>
          <Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('canvasWorkflowRunStart')}
        </Button>
      </footer>
    </Modal>
  )
}
