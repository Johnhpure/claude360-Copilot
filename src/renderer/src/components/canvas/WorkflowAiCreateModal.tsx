import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react'
import { ImagePlus, Images, Sparkles, X } from 'lucide-react'
import type { ImageWorkflowV1 } from '@shared/app-settings-types'
import type { ImageAssetRecord } from '@shared/media-assets'
import { Button, Input, Modal, Select, Textarea } from '../ui'
import { useLocalAssetSrc } from '../../lib/use-local-asset-src'
import { fileToDataUrl, type CanvasPersistenceApi } from '../../canvas/canvas-workbench-actions'
import { generateWorkflowDraft, type WorkflowChatApi } from '../../canvas/workflow-ai'
import { buildReferenceNotes, workflowOutputSize } from '../../canvas/image-workflow-ui'
import { AssetPickerModal, type AssetPickerUpload } from './AssetPickerModal'

type TFn = (key: string, opts?: Record<string, unknown>) => string

/** 参考图条目（素材元信息 / 本地上传；仅文本 + 缩略图，不上传像素）。 */
type ReferenceItem = {
  id: string
  name: string
  prompt?: string
  /** 素材项：相对 workspace 的本地路径（缩略图经 useLocalAssetSrc）。 */
  localPath?: string
  remoteUrl?: string
  /** 本地上传项：dataURL 缩略图。 */
  dataUrl?: string
}

type Props = {
  open: boolean
  textModels: string[]
  /** 文本分组列表（settings.claude360.modelCache.groups）。 */
  groups: string[]
  /** 默认文本分组（selectedTextGroup）。 */
  defaultGroup: string
  workspaceRoot: string
  chatApi: WorkflowChatApi | null
  assetsApi: Pick<CanvasPersistenceApi, 'mediaAssetsList'> | null
  onClose: () => void
  /** 带草稿进编辑弹窗（容器负责换新 id / 时间戳）。 */
  onContinueEdit: (draft: ImageWorkflowV1) => void
  /**
   * 直接保存草稿（容器负责换新 id / 时间戳、validateImageWorkflow 校验并持久化）。
   * 返回中文错误文案 = 校验失败（弹窗保持打开并 inline 展示）；null = 保存成功。
   */
  onSaveDirect: (draft: ImageWorkflowV1) => string | null
  t: TFn
}

let referenceSeq = 0
function nextReferenceId(): string {
  referenceSeq += 1
  return `wfref_${referenceSeq}_${Date.now().toString(36)}`
}

function ReferenceThumb({
  item,
  workspaceRoot,
  onRemove,
  t
}: {
  item: ReferenceItem
  workspaceRoot: string
  onRemove: () => void
  t: TFn
}): ReactElement {
  const src = useLocalAssetSrc(workspaceRoot, item.localPath, item.dataUrl ?? item.remoteUrl ?? null)
  return (
    <div
      data-testid="workflow-ai-reference-item"
      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-ds-border"
      title={item.prompt || item.name}
    >
      {src ? (
        <img src={src} alt={item.name} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center bg-ds-main text-ds-faint">
          <Images className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        </span>
      )}
      <button
        type="button"
        aria-label={t('canvasWorkflowAiRemoveReference')}
        title={t('canvasWorkflowAiRemoveReference')}
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 grid h-4.5 w-4.5 place-items-center rounded-full bg-ds-card text-ds-muted transition-colors duration-[var(--motion-fast)] hover:text-ds-danger"
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  )
}

// AI 创建工作流弹窗（prd R2，design §7.3）：左=模型/分组/描述/参考图/生成按钮，
// 右=草稿预览（空态 → 摘要卡 + 继续编辑/直接保存）。参考图仅取素材 prompt/文件名等
// 文本元信息拼入描述（chat 链路无 vision 透传，UI 不承诺图像理解）。
// 全部错误场景（未选模型/描述为空/生成失败/JSON 解析失败）中文 inline 提示，不崩页面。
export function WorkflowAiCreateModal({
  open,
  textModels,
  groups,
  defaultGroup,
  workspaceRoot,
  chatApi,
  assetsApi,
  onClose,
  onContinueEdit,
  onSaveDirect,
  t
}: Props): ReactElement | null {
  const [model, setModel] = useState('')
  const [group, setGroup] = useState('')
  const [description, setDescription] = useState('')
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ImageWorkflowV1 | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 打开时重置一次性状态并回填默认模型/分组（描述保留，避免误关丢草稿输入）。
  useEffect(() => {
    if (!open) return
    setError(null)
    setDraft(null)
    setGenerating(false)
    setPickerOpen(false)
    setModel((current) => (current && textModels.includes(current) ? current : textModels[0] ?? ''))
    setGroup((current) => current || defaultGroup)
  }, [open, textModels, defaultGroup])

  if (!open) return null

  const addAssets = (assets: ImageAssetRecord[]): void => {
    setPickerOpen(false)
    if (assets.length === 0) return
    setReferences((prev) => [
      ...prev,
      ...assets
        .filter((asset) => !prev.some((item) => item.id === `asset_${asset.id}`))
        .map((asset) => ({
          id: `asset_${asset.id}`,
          name: asset.localPath?.split('/').pop() ?? asset.id,
          ...(asset.prompt ? { prompt: asset.prompt } : {}),
          ...(asset.localPath ? { localPath: asset.localPath } : {}),
          ...(asset.remoteUrl ? { remoteUrl: asset.remoteUrl } : {})
        }))
    ])
  }

  const addUploads = (uploads: AssetPickerUpload[]): void => {
    if (uploads.length === 0) return
    setReferences((prev) => [
      ...prev,
      ...uploads.map((upload) => ({
        id: nextReferenceId(),
        name: upload.name,
        dataUrl: upload.dataUrl
      }))
    ])
  }

  const handleUploadInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    void Promise.all(
      files.map(async (file) => ({
        name: file.name,
        dataUrl: await fileToDataUrl(
          file,
          (f) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
              reader.onerror = () => reject(reader.error ?? new Error('read failed'))
              reader.readAsDataURL(f)
            })
        )
      }))
    )
      .then((uploads) => addUploads(uploads.filter((upload) => upload.dataUrl)))
      .catch(() => undefined)
  }

  const handleGenerate = (): void => {
    if (generating) return
    if (!chatApi) {
      setError(t('canvasWorkflowAiUnavailable'))
      return
    }
    if (!model.trim()) {
      setError(t('canvasWorkflowAiErrorModel'))
      return
    }
    if (!description.trim()) {
      setError(t('canvasWorkflowAiErrorDesc'))
      return
    }
    setError(null)
    setGenerating(true)
    const referenceNotes = buildReferenceNotes(references)
    generateWorkflowDraft(chatApi, {
      model: model.trim(),
      ...(group.trim() ? { group: group.trim() } : {}),
      description,
      ...(referenceNotes ? { referenceNotes } : {})
    })
      .then((result) => setDraft(result))
      .catch((e: unknown) => {
        // workflow-ai 抛的均为中文 message（含 JSON 解析失败）；这里 inline 展示不崩页。
        setError(e instanceof Error && e.message ? e.message : t('canvasWorkflowAiFailed'))
      })
      .finally(() => setGenerating(false))
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        ariaLabel={t('canvasWorkflowAiTitle')}
        size="xl"
        dismissable={!generating}
        className="flex h-[min(680px,82vh)] flex-col"
      >
        <h2 className="pb-1 text-[15px] font-semibold text-ds-ink">{t('canvasWorkflowAiTitle')}</h2>
        <p className="pb-3 text-[12px] text-ds-muted">{t('canvasWorkflowAiIntro')}</p>

        {/* md+ 双栏各自独立滚动；<md 降级为整体纵向滚动的上下布局 */}
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1 md:grid-cols-2 md:overflow-hidden md:pr-0">
          {/* —— 左栏：模型 / 分组 / 描述 / 参考图 / 生成 —— */}
          <div className="flex min-w-0 flex-col gap-3 md:min-h-0 md:overflow-y-auto md:pr-1">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-ds-muted">{t('canvasWorkflowAiModelLabel')}</span>
              {textModels.length > 0 ? (
                <Select
                  value={model || null}
                  options={textModels.map((item) => ({ value: item, label: item }))}
                  onChange={setModel}
                  aria-label={t('canvasWorkflowAiModelLabel')}
                />
              ) : (
                <p className="text-[11.5px] text-ds-faint">{t('canvasWorkflowNoTextModels')}</p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-ds-muted">{t('canvasWorkflowAiGroupLabel')}</span>
              <Select
                value={group || null}
                options={(groups.length > 0 ? groups : [defaultGroup].filter(Boolean)).map((item) => ({
                  value: item,
                  label: item
                }))}
                onChange={setGroup}
                placeholder={t('canvasWorkflowAiGroupLabel')}
                aria-label={t('canvasWorkflowAiGroupLabel')}
              />
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ds-muted">
                {t('canvasWorkflowAiDescLabel')}
                <span className="text-ds-danger" aria-hidden="true">
                  {' '}
                  *
                </span>
              </span>
              <Textarea
                data-testid="workflow-ai-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={9}
                placeholder={t('canvasWorkflowAiDescPlaceholder')}
                className="min-h-[140px] resize-none text-[12.5px]"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-ds-muted">{t('canvasWorkflowAiReferenceLabel')}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                  <Images className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('canvasWorkflowAiPickAssets')}
                </Button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-ds-border bg-ds-elevated px-3 py-1.5 text-[12px] font-medium text-ds-ink transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover">
                  <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  {t('canvasWorkflowAiUpload')}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    data-testid="workflow-ai-upload-input"
                    onChange={handleUploadInput}
                    className="hidden"
                  />
                </label>
              </div>
              {references.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {references.map((item) => (
                    <ReferenceThumb
                      key={item.id}
                      item={item}
                      workspaceRoot={workspaceRoot}
                      onRemove={() =>
                        setReferences((prev) => prev.filter((ref) => ref.id !== item.id))
                      }
                      t={t}
                    />
                  ))}
                </div>
              ) : null}
              <span className="text-[11px] text-ds-faint">{t('canvasWorkflowAiReferenceHint')}</span>
            </div>

            {error ? (
              <p role="alert" data-testid="workflow-ai-error" className="text-[12px] text-ds-danger">
                {error}
              </p>
            ) : null}

            <Button
              variant="primary"
              size="md"
              data-testid="workflow-ai-generate"
              loading={generating}
              disabled={textModels.length === 0}
              onClick={handleGenerate}
            >
              {generating ? null : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
              {generating ? t('canvasWorkflowAiGenerating') : t('canvasWorkflowAiGenerate')}
            </Button>
          </div>

          {/* —— 右栏：草稿预览（高度跟随弹窗主体，内部滚动） —— */}
          <div className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-ds-border bg-ds-main p-3 md:min-h-0 md:overflow-y-auto">
            {draft ? (
              <>
                <h3 className="text-[13.5px] font-semibold text-ds-ink">{draft.name}</h3>
                {draft.category ? (
                  <span className="self-start rounded-full bg-ds-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-ds-accent">
                    {draft.category}
                  </span>
                ) : null}
                {draft.description ? (
                  <p className="text-[12px] leading-[18px] text-ds-muted">{draft.description}</p>
                ) : null}

                {draft.variables.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-ds-muted">
                      {t('canvasWorkflowAiDraftVariables')}
                    </span>
                    {draft.variables.map((variable) => (
                      <span key={variable.key} className="text-[11.5px] text-ds-muted">
                        {variable.label || variable.key}
                        <span className="text-ds-faint">
                          {' '}
                          · {variable.key}
                          {variable.required ? ' · *' : ''}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-ds-muted">
                    {t('canvasWorkflowAiDraftTemplate')}
                  </span>
                  <p className="line-clamp-4 rounded-[var(--radius-sm)] bg-ds-card px-2 py-1 text-[11.5px] leading-[17px] text-ds-muted">
                    {draft.promptTemplate.positive}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-ds-muted">
                    {t('canvasWorkflowAiDraftParams')}
                  </span>
                  <span className="text-[11.5px] text-ds-faint">
                    {[
                      workflowOutputSize(draft.imageConfig).replace('x', '×'),
                      draft.imageConfig.resolution,
                      draft.imageConfig.quality,
                      draft.imageConfig.format.toUpperCase(),
                      draft.textExpansion.enabled
                        ? t('canvasWorkflowChipMulti')
                        : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-end gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="workflow-ai-continue-edit"
                    onClick={() => onContinueEdit(draft)}
                  >
                    {t('canvasWorkflowAiContinueEdit')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="workflow-ai-save-direct"
                    onClick={() => {
                      // 校验失败：容器返回中文错误文案 → inline 展示，弹窗保持打开不保存。
                      const message = onSaveDirect(draft)
                      setError(message)
                    }}
                  >
                    {t('canvasWorkflowAiSaveDirect')}
                  </Button>
                </div>
              </>
            ) : (
              <div
                data-testid="workflow-ai-draft-empty"
                className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center"
              >
                <Sparkles className="h-8 w-8 text-ds-faint" strokeWidth={1.5} aria-hidden />
                <p className="text-[13px] font-medium text-ds-ink">{t('canvasWorkflowAiEmptyTitle')}</p>
                <p className="text-[12px] text-ds-muted">{t('canvasWorkflowAiEmptyDesc')}</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <AssetPickerModal
        open={pickerOpen}
        workspaceRoot={workspaceRoot}
        api={assetsApi}
        onConfirm={addAssets}
        onUpload={addUploads}
        onClose={() => setPickerOpen(false)}
        t={t}
      />
    </>
  )
}
