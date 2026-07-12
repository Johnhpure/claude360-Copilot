import { useMemo, useState, type ReactElement } from 'react'
import { Copy, Pencil, Play, Plus, Sparkles, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react'
import type { ImageWorkflowV1 } from '@shared/app-settings-types'
import { Button, Card, EmptyState, Input, Select } from '../ui'
import {
  filterImageWorkflows,
  formatWorkflowTime,
  listWorkflowCategories
} from '../../canvas/image-workflow-ui'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  workflows: ImageWorkflowV1[]
  /** 运行中状态（进度「x/N」）；null = 空闲。单实例运行：运行期间禁用各卡「运行」。 */
  running: { done: number; total: number } | null
  onRun: (workflow: ImageWorkflowV1) => void
  onEdit: (workflow: ImageWorkflowV1) => void
  onDuplicate: (workflow: ImageWorkflowV1) => void
  onDelete: (workflow: ImageWorkflowV1) => void
  onCreateAi: () => void
  onCreateMulti: () => void
  onCreateBlank: () => void
  onCancelRun: () => void
  /** 关闭面板（07-12 侧栏入口改造：面板改为按需展示）；缺省不渲染关闭按钮。 */
  onClose?: () => void
  t: TFn
}

/** 卡片标签 chip（选中态约定色：accent-soft 底 + accent 字）。 */
function Chip({ children }: { children: string }): ReactElement {
  return (
    <span className="max-w-full truncate rounded-full bg-ds-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-ds-accent">
      {children}
    </span>
  )
}

function CardAction({
  label,
  disabled,
  danger = false,
  testId,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  testId: string
  onClick: () => void
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'text-ds-muted hover:bg-ds-danger-soft hover:text-ds-danger'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {children}
    </button>
  )
}

// 右侧「创作工作流」面板（prd R1，design §7.2）：分类筛选 + 搜索 + 三个新建入口 +
// 工作流卡片列表（标签/描述/模板预览/时间/操作）+ 空态 + 运行进度态。
// 纯展示组件：CRUD 与运行编排全部经 props 回调委托容器（CanvasWorkbench）。
export function WorkflowPanel({
  workflows,
  running,
  onRun,
  onEdit,
  onDuplicate,
  onDelete,
  onCreateAi,
  onCreateMulti,
  onCreateBlank,
  onCancelRun,
  onClose,
  t
}: Props): ReactElement {
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')

  const categories = useMemo(() => listWorkflowCategories(workflows), [workflows])
  const visible = useMemo(
    () => filterImageWorkflows(workflows, category, query),
    [workflows, category, query]
  )
  // 分类被删空后回到「全部分类」（受控值失配时 Select 显示 placeholder，这里直接归位）。
  const effectiveCategory = categories.includes(category) ? category : ''

  const categoryOptions = [
    { value: '', label: t('canvasWorkflowCategoryAll') },
    ...categories.map((item) => ({ value: item, label: item }))
  ]

  return (
    <section data-testid="canvas-workflow-panel" className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <WorkflowIcon className="h-4 w-4 text-ds-muted" strokeWidth={1.75} aria-hidden />
        <h2 className="text-[14px] font-semibold text-ds-ink">{t('canvasWorkflowPanelTitle')}</h2>
        <span className="ml-auto text-[11.5px] text-ds-faint">
          {t('canvasWorkflowCount', { count: workflows.length })}
        </span>
        {onClose ? (
          <CardAction label={t('close')} testId="workflow-panel-close" onClick={onClose}>
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </CardAction>
        ) : null}
      </div>

      {/* 三个新建入口：AI 创建（primary）/ 新建多图 / 新建工作流 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" size="sm" data-testid="workflow-create-ai" onClick={onCreateAi}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('canvasWorkflowCreateAi')}
        </Button>
        <Button variant="secondary" size="sm" data-testid="workflow-create-multi" onClick={onCreateMulti}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('canvasWorkflowCreateMulti')}
        </Button>
        <Button variant="secondary" size="sm" data-testid="workflow-create-blank" onClick={onCreateBlank}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('canvasWorkflowCreateBlank')}
        </Button>
      </div>

      {/* 分类筛选 + 搜索 */}
      <div className="flex flex-col gap-2">
        <Select
          value={effectiveCategory}
          options={categoryOptions}
          onChange={setCategory}
          aria-label={t('canvasWorkflowCategoryLabel')}
        />
        <Input
          data-testid="workflow-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('canvasWorkflowSearchPlaceholder')}
          aria-label={t('canvasWorkflowSearchPlaceholder')}
        />
      </div>

      {/* 运行进度态：文案「x/N」+ 取消 */}
      {running ? (
        <div
          data-testid="workflow-run-banner"
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-ds-border bg-ds-accent-soft px-3 py-2"
        >
          <span className="flex-1 text-[12px] font-medium text-ds-accent">
            {t('canvasWorkflowRunning', { done: running.done, total: running.total })}
          </span>
          <Button variant="secondary" size="sm" data-testid="workflow-run-cancel" onClick={onCancelRun}>
            {t('canvasWorkflowCancel')}
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <Card data-testid="workflow-list-empty" className="border-dashed">
          <EmptyState
            icon={WorkflowIcon}
            title={workflows.length === 0 ? t('canvasWorkflowEmpty') : t('canvasWorkflowFilterEmpty')}
            description={workflows.length === 0 ? t('canvasWorkflowEmptyHint') : undefined}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((workflow) => (
            <Card
              key={workflow.id}
              unpadded
              data-testid="workflow-card"
              className="flex flex-col gap-2 p-3"
            >
              <div className="flex items-start gap-2">
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink">
                  {workflow.name}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {workflow.textExpansion.enabled ? <Chip>{t('canvasWorkflowChipMulti')}</Chip> : null}
                {workflow.variables.length > 0 ? (
                  <Chip>{t('canvasWorkflowChipVariables', { count: workflow.variables.length })}</Chip>
                ) : null}
                {workflow.category ? <Chip>{workflow.category}</Chip> : null}
                <Chip>
                  {workflow.visibility === 'public'
                    ? t('canvasWorkflowVisibilityPublic')
                    : t('canvasWorkflowVisibilityPrivate')}
                </Chip>
              </div>
              {workflow.description ? (
                <p className="line-clamp-2 text-[12px] leading-[18px] text-ds-muted">
                  {workflow.description}
                </p>
              ) : null}
              {workflow.promptTemplate.positive ? (
                <p className="line-clamp-2 rounded-[var(--radius-sm)] bg-ds-main px-2 py-1 text-[11.5px] leading-[17px] text-ds-muted">
                  {workflow.promptTemplate.positive}
                </p>
              ) : null}
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ds-faint">
                  {formatWorkflowTime(workflow.createdAt)}
                </span>
                <CardAction
                  label={t('canvasWorkflowActionRun')}
                  testId="workflow-run-button"
                  disabled={running !== null}
                  onClick={() => onRun(workflow)}
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                </CardAction>
                <CardAction
                  label={t('canvasWorkflowActionEdit')}
                  testId="workflow-edit-button"
                  onClick={() => onEdit(workflow)}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                </CardAction>
                <CardAction
                  label={t('canvasWorkflowActionDuplicate')}
                  testId="workflow-duplicate-button"
                  onClick={() => onDuplicate(workflow)}
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                </CardAction>
                <CardAction
                  label={t('canvasWorkflowActionDelete')}
                  testId="workflow-delete-button"
                  danger
                  onClick={() => onDelete(workflow)}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </CardAction>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
