import { useMemo, useState, type ReactElement } from 'react'
import { Copy, Pencil, Play, Plus, Sparkles, Trash2, Workflow as WorkflowIcon } from 'lucide-react'
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

// 「创作工作流」管理视图（07-12 生图 IA 重构）：由右侧竖排面板改为生图主内容区
// 页面级版式——页头（标题/数量 + 三个新建入口）+ 分类/搜索筛选行 + 卡片网格 +
// 空态 + 运行进度态。经左侧二级入口「创作工作流」整体切换展示（替换生成工作台），
// 不再作为右侧常驻/侧挂 aside。纯展示组件：CRUD 与运行编排全部经 props 回调
// 委托容器（CanvasWorkbench）。
export function WorkflowManagerView({
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
    <section
      data-testid="workflow-manager-view"
      className="flex min-h-0 w-full flex-1 flex-col gap-4"
    >
      {/* 页头：标题/数量；右侧三个新建入口（AI 创建 primary / 新建多图 / 新建工作流）。
          新建能力保留在管理视图内部，左侧栏只留「创作工作流」单一导航入口。 */}
      <div className="flex flex-wrap items-center gap-2">
        <WorkflowIcon className="h-[18px] w-[18px] text-ds-muted" strokeWidth={1.75} aria-hidden />
        <h2 className="text-[15px] font-semibold text-ds-ink">{t('canvasWorkflowPanelTitle')}</h2>
        <span className="text-[12px] text-ds-faint">
          {t('canvasWorkflowCount', { count: workflows.length })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button variant="primary" size="sm" data-testid="workflow-create-ai" onClick={onCreateAi}>
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('canvasWorkflowCreateAi')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="workflow-create-multi"
            onClick={onCreateMulti}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('canvasWorkflowCreateMulti')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="workflow-create-blank"
            onClick={onCreateBlank}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            {t('canvasWorkflowCreateBlank')}
          </Button>
        </div>
      </div>

      {/* 分类筛选 + 搜索（横排；窄屏自动换行） */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[190px] max-w-full">
          <Select
            value={effectiveCategory}
            options={categoryOptions}
            onChange={setCategory}
            aria-label={t('canvasWorkflowCategoryLabel')}
          />
        </div>
        <div className="w-full max-w-[320px]">
          <Input
            data-testid="workflow-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('canvasWorkflowSearchPlaceholder')}
            aria-label={t('canvasWorkflowSearchPlaceholder')}
          />
        </div>
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

      {/* 列表区：独立滚动；卡片按 auto-fill 自适应宫格排布（min 360px，卡片自身封顶 420px，
          单卡时也不横向撑满整行、也不小于 360px 宽度下限） */}
      <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
        {visible.length === 0 ? (
          <Card data-testid="workflow-list-empty" className="border-dashed">
            <EmptyState
              icon={WorkflowIcon}
              title={workflows.length === 0 ? t('canvasWorkflowEmpty') : t('canvasWorkflowFilterEmpty')}
              description={workflows.length === 0 ? t('canvasWorkflowEmptyHint') : undefined}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
            {visible.map((workflow) => (
              <Card
                key={workflow.id}
                unpadded
                data-testid="workflow-card"
                className="flex min-h-[220px] w-full min-w-0 max-w-[420px] flex-col gap-3 p-5"
              >
                <div className="flex items-start gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ds-ink">
                    {workflow.name}
                  </h3>
                </div>
                {workflow.description ? (
                  <p className="line-clamp-2 text-[12.5px] leading-[19px] text-ds-muted">
                    {workflow.description}
                  </p>
                ) : null}
                {workflow.promptTemplate.positive ? (
                  <p className="line-clamp-3 rounded-[var(--radius-sm)] bg-ds-main px-2.5 py-1.5 text-[11.5px] leading-[17px] text-ds-muted">
                    {workflow.promptTemplate.positive}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
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
                <div className="mt-auto flex items-center gap-1 pt-2">
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
      </div>
    </section>
  )
}
