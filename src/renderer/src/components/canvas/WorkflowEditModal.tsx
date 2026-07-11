import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type {
  ImageWorkflowImageConfigV1,
  ImageWorkflowTextExpansionV1,
  ImageWorkflowV1,
  ImageWorkflowVariableType,
  ImageWorkflowVariableV1
} from '@shared/app-settings-types'
import { IMAGE_WORKFLOW_VARIABLE_TYPES } from '@shared/app-settings-types'
import {
  CLAUDE360_ASPECT_PRESETS,
  CLAUDE360_IMAGE_MODERATIONS,
  CLAUDE360_IMAGE_OUTPUT_FORMATS,
  CLAUDE360_IMAGE_QUALITIES,
  CLAUDE360_IMAGE_RESOLUTIONS
} from '@shared/claude360-canvas'
import { Button, Input, Modal, Select, Textarea } from '../ui'
import { Toggle } from '../settings-controls'
import {
  IMAGE_WORKFLOW_PRESET_CATEGORIES,
  imageWorkflowIssueMessage,
  validateImageWorkflow,
  workflowOutputSize
} from '../../canvas/image-workflow-ui'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  open: boolean
  /** 初始值：编辑既有 / AI 草稿 / defaultImageWorkflow 新建（id 与 createdAt 由容器给定）。 */
  initial: ImageWorkflowV1 | null
  /** true = 新建（标题区分）；保存语义由容器按 id 是否已存在决定。 */
  isNew: boolean
  imageModels: string[]
  textModels: string[]
  onRefreshModels: () => void
  onSave: (workflow: ImageWorkflowV1) => void
  onClose: () => void
  t: TFn
}

/** 自定义分类的 Select 哨兵值（不会与真实分类冲突：真实分类经 trim 不为该值）。 */
const CUSTOM_CATEGORY = '__custom__'

/** 输出格式的展示名（专有名词，非翻译文案）。 */
const FORMAT_LABELS: Record<ImageWorkflowImageConfigV1['format'], string> = {
  png: 'PNG',
  jpeg: 'JPG',
  webp: 'WebP'
}

/** 宽松解析整数并夹逼到 [min,max]；非法输入回退 fallback。 */
function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

/** 胶囊 chip 组（同 ImagePromptPanel ChipGroup 模式；选中 = accent-soft 底 + accent 字）。 */
function ChipRow<V extends string>({
  options,
  value,
  label,
  disabled = false,
  labelOf,
  onChange
}: {
  options: readonly V[]
  value: V
  label: string
  disabled?: boolean
  labelOf?: (v: V) => string
  onChange: (v: V) => void
}): ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors duration-[var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-ds-accent bg-ds-accent-soft font-semibold text-ds-accent'
                : 'border-ds-border bg-ds-card font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
          >
            {labelOf ? labelOf(option) : option}
          </button>
        )
      })}
    </div>
  )
}

/** 右栏折叠分组（局部 state 折叠头，design §7.4 不新建全局 Accordion）。 */
function Section({
  title,
  open,
  onToggle,
  children
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}): ReactElement {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-ds-border bg-ds-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover"
      >
        <span className="text-[12.5px] font-semibold text-ds-ink">{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ds-faint transition-transform duration-[var(--motion-fast)] ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
      {open ? <div className="flex flex-col gap-3 border-t border-ds-border px-3 py-3">{children}</div> : null}
    </div>
  )
}

function FieldLabel({ text, required = false }: { text: string; required?: boolean }): ReactElement {
  return (
    <span className="text-[12px] text-ds-muted">
      {text}
      {required ? (
        <span className="text-ds-danger" aria-hidden="true">
          {' '}
          *
        </span>
      ) : null}
    </span>
  )
}

// 编辑工作流弹窗（prd R3，design §7.4）：左=基础信息/变量/模板，右=折叠分组生成配置；
// 内容区内部滚动、footer 固定。校验：key 格式/重复、正向非空、未定义变量阻断，
// 未使用变量弱提示（text-ds-faint，不阻断）。保存结果经 onSave 交容器持久化。
export function WorkflowEditModal({
  open,
  initial,
  isNew,
  imageModels,
  textModels,
  onRefreshModels,
  onSave,
  onClose,
  t
}: Props): ReactElement | null {
  const [draft, setDraft] = useState<ImageWorkflowV1 | null>(null)
  const [categoryChoice, setCategoryChoice] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [sections, setSections] = useState({ model: true, expansion: false, size: true, advanced: false })

  // 打开时以 initial 深拷贝初始化本地草稿（关闭丢弃，不污染列表）。
  useEffect(() => {
    if (!open || !initial) return
    setDraft(structuredClone(initial))
    const category = initial.category.trim()
    if (category && !IMAGE_WORKFLOW_PRESET_CATEGORIES.includes(category)) {
      setCategoryChoice(CUSTOM_CATEGORY)
      setCustomCategory(category)
    } else {
      setCategoryChoice(category)
      setCustomCategory('')
    }
    setAttempted(false)
    setSections({ model: true, expansion: initial.textExpansion.enabled, size: true, advanced: false })
  }, [open, initial])

  // 保存产物的分类落定值（预置 / 自定义输入）。
  const resolvedCategory = (categoryChoice === CUSTOM_CATEGORY ? customCategory : categoryChoice).trim()

  // 保存产物：分类落定 + 名称 trim + updatedAt 刷新（id/createdAt 沿用 initial）。
  const buildResult = (source: ImageWorkflowV1): ImageWorkflowV1 => ({
    ...source,
    name: source.name.trim(),
    category: resolvedCategory,
    updatedAt: Date.now()
  })

  const validation = useMemo(
    () =>
      draft
        ? validateImageWorkflow({ ...draft, name: draft.name.trim(), category: resolvedCategory })
        : null,
    [draft, resolvedCategory]
  )

  if (!open || !draft || !validation) return null

  const patch = (partial: Partial<ImageWorkflowV1>): void =>
    setDraft((d) => (d ? { ...d, ...partial } : d))
  const patchImage = (partial: Partial<ImageWorkflowImageConfigV1>): void =>
    setDraft((d) => (d ? { ...d, imageConfig: { ...d.imageConfig, ...partial } } : d))
  const patchExpansion = (partial: Partial<ImageWorkflowTextExpansionV1>): void =>
    setDraft((d) => (d ? { ...d, textExpansion: { ...d.textExpansion, ...partial } } : d))
  const patchTemplate = (partial: Partial<ImageWorkflowV1['promptTemplate']>): void =>
    setDraft((d) => (d ? { ...d, promptTemplate: { ...d.promptTemplate, ...partial } } : d))
  const patchVariable = (index: number, partial: Partial<ImageWorkflowVariableV1>): void =>
    setDraft((d) =>
      d
        ? {
            ...d,
            variables: d.variables.map((variable, i) =>
              i === index ? { ...variable, ...partial } : variable
            )
          }
        : d
    )
  const removeVariable = (index: number): void =>
    setDraft((d) => (d ? { ...d, variables: d.variables.filter((_, i) => i !== index) } : d))
  const addVariable = (): void =>
    setDraft((d) =>
      d
        ? {
            ...d,
            variables: [
              ...d.variables,
              { key: '', label: '', type: 'text', required: false, defaultValue: '', options: [] }
            ]
          }
        : d
    )
  const toggleSection = (key: keyof typeof sections): void =>
    setSections((s) => ({ ...s, [key]: !s[key] }))

  const handleSave = (): void => {
    if (validation.errors.length > 0) {
      setAttempted(true)
      return
    }
    onSave(buildResult(draft))
  }

  const variableTypeLabels: Record<ImageWorkflowVariableType, string> = {
    text: t('canvasWorkflowVariableTypeText'),
    textarea: t('canvasWorkflowVariableTypeTextarea'),
    number: t('canvasWorkflowVariableTypeNumber'),
    select: t('canvasWorkflowVariableTypeSelect')
  }
  const qualityLabels: Record<ImageWorkflowImageConfigV1['quality'], string> = {
    auto: t('canvasQualityAuto'),
    high: t('canvasQualityHigh'),
    medium: t('canvasQualityMedium'),
    low: t('canvasQualityLow')
  }
  const moderationLabels: Record<ImageWorkflowImageConfigV1['moderation'], string> = {
    auto: t('canvasWorkflowModerationAuto'),
    low: t('canvasWorkflowModerationLow')
  }

  const categoryOptions = [
    { value: '', label: t('canvasWorkflowCategoryNone') },
    ...IMAGE_WORKFLOW_PRESET_CATEGORIES.map((item) => ({ value: item, label: item })),
    { value: CUSTOM_CATEGORY, label: t('canvasWorkflowCategoryCustom') }
  ]

  const config = draft.imageConfig
  const isCustomAspect = config.aspectPresetId === 'custom'
  const outputSize = workflowOutputSize(config).replace('x', '×')
  const compressionDisabled = config.format === 'png'

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={isNew ? t('canvasWorkflowEditTitleNew') : t('canvasWorkflowEditTitle')}
      size="lg"
      className="flex max-h-[86vh] flex-col"
    >
      <h2 className="pb-3 text-[15px] font-semibold text-ds-ink">
        {isNew ? t('canvasWorkflowEditTitleNew') : t('canvasWorkflowEditTitle')}
      </h2>

      {/* 内容区：内部滚动；<md 上下、md+ 左右两栏 */}
      <div
        data-testid="workflow-edit-body"
        className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2"
      >
        {/* —— 左栏：基础信息 / 变量 / 模板 —— */}
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex flex-col gap-1">
            <FieldLabel text={t('canvasWorkflowNameLabel')} required />
            <Input
              data-testid="workflow-name-input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('canvasWorkflowNamePlaceholder')}
              invalid={attempted && !draft.name.trim()}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel text={t('canvasWorkflowDescLabel')} />
            <Textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              placeholder={t('canvasWorkflowDescPlaceholder')}
              className="min-h-[52px] resize-none text-[12.5px]"
            />
          </label>

          <div className="flex flex-col gap-1">
            <FieldLabel text={t('canvasWorkflowCategoryLabel')} />
            <Select
              value={categoryChoice}
              options={categoryOptions}
              onChange={setCategoryChoice}
              aria-label={t('canvasWorkflowCategoryLabel')}
            />
            {categoryChoice === CUSTOM_CATEGORY ? (
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder={t('canvasWorkflowCategoryCustomPlaceholder')}
              />
            ) : null}
          </div>

          {/* 输入变量编辑器 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel text={t('canvasWorkflowVariablesTitle')} />
              <Button variant="ghost" size="sm" data-testid="workflow-variable-add" onClick={addVariable}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                {t('canvasWorkflowVariableAdd')}
              </Button>
            </div>
            {draft.variables.length === 0 ? (
              <p className="text-[11.5px] text-ds-faint">{t('canvasWorkflowVariablesEmpty')}</p>
            ) : (
              draft.variables.map((variable, index) => (
                <div
                  key={index}
                  data-testid="workflow-variable-row"
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-ds-border bg-ds-main p-2"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={variable.key}
                      onChange={(e) => patchVariable(index, { key: e.target.value })}
                      placeholder={t('canvasWorkflowVariableKey')}
                      aria-label={t('canvasWorkflowVariableKey')}
                      className="h-8 text-[12px]"
                    />
                    <Input
                      value={variable.label}
                      onChange={(e) => patchVariable(index, { label: e.target.value })}
                      placeholder={t('canvasWorkflowVariableLabel')}
                      aria-label={t('canvasWorkflowVariableLabel')}
                      className="h-8 text-[12px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={variable.type}
                      options={IMAGE_WORKFLOW_VARIABLE_TYPES.map((type) => ({
                        value: type,
                        label: variableTypeLabels[type]
                      }))}
                      onChange={(type) => patchVariable(index, { type })}
                      aria-label={t('canvasWorkflowVariableType')}
                      className="h-8 text-[12px]"
                    />
                    <Input
                      value={variable.defaultValue}
                      onChange={(e) => patchVariable(index, { defaultValue: e.target.value })}
                      placeholder={t('canvasWorkflowVariableDefault')}
                      aria-label={t('canvasWorkflowVariableDefault')}
                      className="h-8 text-[12px]"
                    />
                  </div>
                  {variable.type === 'select' ? (
                    <Input
                      value={variable.options.join(',')}
                      onChange={(e) =>
                        patchVariable(index, {
                          options: e.target.value
                            .split(/[,，]/)
                            .map((option) => option.trim())
                            .filter((option) => option.length > 0)
                        })
                      }
                      placeholder={t('canvasWorkflowVariableOptions')}
                      aria-label={t('canvasWorkflowVariableOptions')}
                      className="h-8 text-[12px]"
                    />
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[11.5px] text-ds-muted">
                      <Toggle
                        checked={variable.required}
                        onChange={(required) => patchVariable(index, { required })}
                      />
                      {t('canvasWorkflowVariableRequired')}
                    </label>
                    <button
                      type="button"
                      title={t('canvasWorkflowVariableRemove')}
                      aria-label={t('canvasWorkflowVariableRemove')}
                      onClick={() => removeVariable(index)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-danger-soft hover:text-ds-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 提示词模板 */}
          <div className="flex flex-col gap-2">
            <FieldLabel text={t('canvasWorkflowTemplateTitle')} />
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-ds-faint">{t('canvasWorkflowTemplateSystem')}</span>
              <Textarea
                value={draft.promptTemplate.system}
                onChange={(e) => patchTemplate({ system: e.target.value })}
                rows={2}
                className="min-h-[48px] resize-none text-[12.5px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel text={t('canvasWorkflowTemplatePositive')} required />
              <Textarea
                data-testid="workflow-positive-input"
                value={draft.promptTemplate.positive}
                onChange={(e) => patchTemplate({ positive: e.target.value })}
                rows={4}
                invalid={attempted && !draft.promptTemplate.positive.trim()}
                className="resize-none text-[12.5px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] text-ds-faint">{t('canvasWorkflowTemplateNegative')}</span>
              <Textarea
                value={draft.promptTemplate.negative}
                onChange={(e) => patchTemplate({ negative: e.target.value })}
                rows={2}
                className="min-h-[48px] resize-none text-[12.5px]"
              />
            </label>
            <p className="text-[11px] text-ds-faint">
              {t('canvasWorkflowTemplateHint', { example: '{{topic}}' })}
            </p>
            {validation.unusedVariables.length > 0 ? (
              <p data-testid="workflow-unused-vars" className="text-[11px] text-ds-faint">
                {t('canvasWorkflowUnusedVariables', { keys: validation.unusedVariables.join(', ') })}
              </p>
            ) : null}
          </div>
        </div>

        {/* —— 右栏：生成配置（折叠分组） —— */}
        <div className="flex min-w-0 flex-col gap-3">
          <Section
            title={t('canvasWorkflowSectionModel')}
            open={sections.model}
            onToggle={() => toggleSection('model')}
          >
            {imageModels.length > 0 ? (
              <Select
                value={config.model || null}
                options={imageModels.map((model) => ({ value: model, label: model }))}
                onChange={(model) => patchImage({ model })}
                placeholder={t('canvasModelLabel')}
                invalid={attempted && !config.model.trim()}
                aria-label={t('canvasModelLabel')}
              />
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-dashed border-ds-border bg-ds-main px-3 py-2 text-[12px] text-ds-muted">
                <span>{t('canvasNoImageModels')}</span>
                <Button variant="secondary" size="sm" className="shrink-0" onClick={onRefreshModels}>
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('canvasRefreshModels')}
                </Button>
              </div>
            )}
          </Section>

          <Section
            title={t('canvasWorkflowSectionExpansion')}
            open={sections.expansion}
            onToggle={() => toggleSection('expansion')}
          >
            <label className="flex items-center justify-between gap-2 text-[12px] text-ds-muted">
              {t('canvasWorkflowExpansionEnable')}
              <Toggle
                checked={draft.textExpansion.enabled}
                onChange={(enabled) => patchExpansion({ enabled })}
              />
            </label>
            {draft.textExpansion.enabled ? (
              <>
                <div className="flex flex-col gap-1">
                  <FieldLabel text={t('canvasWorkflowExpansionModel')} required />
                  {textModels.length > 0 ? (
                    <Select
                      value={draft.textExpansion.model || null}
                      options={textModels.map((model) => ({ value: model, label: model }))}
                      onChange={(model) => patchExpansion({ model })}
                      placeholder={t('canvasWorkflowExpansionModel')}
                      invalid={attempted && !draft.textExpansion.model.trim()}
                      aria-label={t('canvasWorkflowExpansionModel')}
                    />
                  ) : (
                    <p className="text-[11.5px] text-ds-faint">{t('canvasWorkflowNoTextModels')}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <FieldLabel text={t('canvasWorkflowExpansionCount')} />
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={draft.textExpansion.count}
                      onChange={(e) =>
                        patchExpansion({ count: clampInt(e.target.value, 4, 1, 20) })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <FieldLabel text={t('canvasWorkflowExpansionConcurrency')} />
                    <Input
                      type="number"
                      min={1}
                      max={6}
                      value={draft.textExpansion.concurrency}
                      onChange={(e) =>
                        patchExpansion({ concurrency: clampInt(e.target.value, 2, 1, 6) })
                      }
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <FieldLabel text={t('canvasWorkflowExpansionRule')} />
                  <Textarea
                    value={draft.textExpansion.rule}
                    onChange={(e) => patchExpansion({ rule: e.target.value })}
                    rows={3}
                    placeholder={t('canvasWorkflowExpansionRulePlaceholder')}
                    className="resize-none text-[12.5px]"
                  />
                </label>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex flex-col text-[12px] text-ds-muted">
                    {t('canvasWorkflowExpansionPrepend')}
                    <span className="text-[11px] text-ds-faint">
                      {t('canvasWorkflowExpansionPrependHint')}
                    </span>
                  </span>
                  <Toggle
                    checked={draft.textExpansion.prependBasePrompt}
                    onChange={(prependBasePrompt) => patchExpansion({ prependBasePrompt })}
                  />
                </div>
              </>
            ) : null}
          </Section>

          <Section
            title={t('canvasWorkflowSectionSize')}
            open={sections.size}
            onToggle={() => toggleSection('size')}
          >
            <div className="flex flex-col gap-1.5">
              <FieldLabel text={t('canvasAspectLabel')} />
              <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t('canvasAspectLabel')}>
                {[...CLAUDE360_ASPECT_PRESETS.map((preset) => ({ id: preset.id, label: preset.ratio })), { id: 'custom', label: t('canvasWorkflowAspectCustom') }].map(
                  (preset) => {
                    const active = preset.id === config.aspectPresetId
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => patchImage({ aspectPresetId: preset.id })}
                        className={`rounded-[var(--radius-sm)] border px-1 py-1.5 text-[11px] font-semibold tabular-nums transition-colors duration-[var(--motion-fast)] ${
                          active
                            ? 'border-ds-accent bg-ds-accent-soft text-ds-accent'
                            : 'border-ds-border bg-ds-main text-ds-muted hover:border-ds-accent hover:text-ds-ink'
                        }`}
                      >
                        {preset.label}
                      </button>
                    )
                  }
                )}
              </div>
              {isCustomAspect ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <FieldLabel text={t('canvasWorkflowWidth')} />
                    <Input
                      type="number"
                      min={16}
                      max={99999}
                      value={config.width}
                      onChange={(e) => patchImage({ width: clampInt(e.target.value, 1024, 16, 99_999) })}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <FieldLabel text={t('canvasWorkflowHeight')} />
                    <Input
                      type="number"
                      min={16}
                      max={99999}
                      value={config.height}
                      onChange={(e) => patchImage({ height: clampInt(e.target.value, 1024, 16, 99_999) })}
                    />
                  </label>
                </div>
              ) : null}
              <span className="text-[11px] text-ds-faint">
                {t('canvasWorkflowOutputSize', { size: outputSize })}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel text={t('canvasResolutionLabel')} />
              <ChipRow
                options={CLAUDE360_IMAGE_RESOLUTIONS}
                value={config.resolution}
                label={t('canvasResolutionLabel')}
                disabled={isCustomAspect}
                onChange={(resolution) => patchImage({ resolution })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel text={t('canvasQualityLabel')} />
              <ChipRow
                options={CLAUDE360_IMAGE_QUALITIES}
                value={config.quality}
                label={t('canvasQualityLabel')}
                labelOf={(quality) => qualityLabels[quality]}
                onChange={(quality) => patchImage({ quality })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <FieldLabel text={t('canvasCountLabel')} />
                <Select
                  value={String(config.count)}
                  options={['1', '2', '3', '4'].map((count) => ({ value: count, label: count }))}
                  onChange={(count) => patchImage({ count: clampInt(count, 1, 1, 4) })}
                  aria-label={t('canvasCountLabel')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel text={t('canvasOutputFormatLabel')} />
                <Select
                  value={config.format}
                  options={CLAUDE360_IMAGE_OUTPUT_FORMATS.map((format) => ({
                    value: format,
                    label: FORMAT_LABELS[format]
                  }))}
                  onChange={(format) => patchImage({ format })}
                  aria-label={t('canvasOutputFormatLabel')}
                />
              </label>
            </div>
          </Section>

          <Section
            title={t('canvasWorkflowSectionAdvanced')}
            open={sections.advanced}
            onToggle={() => toggleSection('advanced')}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <FieldLabel text={t('canvasWorkflowRetryLabel')} />
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={config.retry}
                  onChange={(e) => patchImage({ retry: clampInt(e.target.value, 0, 0, 5) })}
                />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel text={t('canvasWorkflowTimeout')} />
                <Input
                  type="number"
                  min={30}
                  max={3600}
                  value={config.timeoutSeconds}
                  onChange={(e) =>
                    patchImage({ timeoutSeconds: clampInt(e.target.value, 600, 30, 3_600) })
                  }
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <FieldLabel text={t('canvasWorkflowCompression')} />
              <Input
                type="number"
                min={0}
                max={100}
                disabled={compressionDisabled}
                value={config.compression}
                onChange={(e) => patchImage({ compression: clampInt(e.target.value, 100, 0, 100) })}
              />
              {compressionDisabled ? (
                <span className="text-[11px] text-ds-faint">{t('canvasWorkflowCompressionPngHint')}</span>
              ) : null}
            </label>
            <div className="flex flex-col gap-1">
              <FieldLabel text={t('canvasWorkflowModeration')} />
              <ChipRow
                options={CLAUDE360_IMAGE_MODERATIONS}
                value={config.moderation}
                label={t('canvasWorkflowModeration')}
                labelOf={(moderation) => moderationLabels[moderation]}
                onChange={(moderation) => patchImage({ moderation })}
              />
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col text-[12px] text-ds-muted">
                {t('canvasWorkflowStream')}
                <span className="text-[11px] text-ds-faint">{t('canvasWorkflowUpstreamHint')}</span>
              </span>
              <Toggle checked={config.stream} onChange={(stream) => patchImage({ stream })} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-ds-muted">{t('canvasWorkflowReturnBase64')}</span>
              <Toggle
                checked={config.returnBase64}
                onChange={(returnBase64) => patchImage({ returnBase64 })}
              />
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col text-[12px] text-ds-muted">
                {t('canvasWorkflowCodex')}
                <span className="text-[11px] text-ds-faint">{t('canvasWorkflowUpstreamHint')}</span>
              </span>
              <Toggle
                checked={config.codexCliCompatible}
                onChange={(codexCliCompatible) => patchImage({ codexCliCompatible })}
              />
            </div>
          </Section>
        </div>
      </div>

      {/* 校验错误（提交后显示，inline 红字） */}
      {attempted && validation.errors.length > 0 ? (
        <div
          data-testid="workflow-edit-errors"
          role="alert"
          className="mt-3 flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-ds-danger bg-ds-danger-soft px-3 py-2"
        >
          {validation.errors.map((issue, index) => (
            <span key={index} className="text-[12px] text-ds-danger">
              {imageWorkflowIssueMessage(issue, t)}
            </span>
          ))}
        </div>
      ) : null}

      {/* footer 固定：保存 / 取消 */}
      <footer className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-ds-border pt-3">
        <Button variant="secondary" size="md" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="primary" size="md" data-testid="workflow-save-button" onClick={handleSave}>
          {t('canvasWorkflowSave')}
        </Button>
      </footer>
    </Modal>
  )
}
