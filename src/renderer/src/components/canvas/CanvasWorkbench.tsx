import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Copy, Download, Image as ImageIcon, X } from 'lucide-react'
import {
  CLAUDE360_ASPECT_PRESETS,
  CLAUDE360_IMAGE_OUTPUT_FORMATS,
  CLAUDE360_IMAGE_QUALITIES,
  CLAUDE360_IMAGE_RESOLUTIONS,
  type Claude360ImageOutputFormat,
  type Claude360ImageQuality,
  type Claude360ImageResolution
} from '@shared/claude360-canvas'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import {
  filterArtworks,
  useCanvasStore,
  type CanvasArtwork,
  type CanvasArtworkFilter
} from '../../canvas/canvas-store'
import {
  defaultImageModel,
  filterImageModels,
  submitGenerate,
  submitEdit,
  fileToDataUrl,
  copyImage,
  downloadImage,
  type CanvasWorkbenchApi
} from '../../canvas/canvas-workbench-actions'
import { imageDataUrl } from '../../canvas/image-result-utils'
import { confirmDialog } from '../../lib/confirm-dialog'
import { CanvasToolbar } from './CanvasToolbar'
import { ImagePromptPanel } from './ImagePromptPanel'
import { ArtworkGrid } from './ArtworkGrid'
import { ensureGroupKeyForSelection } from '../../lib/group-key-ensure'
import { useGroupKeyPromptStore } from '../../store/group-key-prompt-store'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  /** 跳转「我的」页（低余额充值入口）。 */
  onOpenMy: () => void
}

/** 从像素尺寸串反查（宽高比预设, 分辨率），用于「重新生成」回填表单；未命中返回 null。 */
export function aspectFromSize(
  size: string
): { aspectPreset: string; resolution: Claude360ImageResolution } | null {
  if (!size) return null
  for (const preset of CLAUDE360_ASPECT_PRESETS) {
    for (const resolution of CLAUDE360_IMAGE_RESOLUTIONS) {
      if (preset.sizes[resolution] === size) {
        return { aspectPreset: preset.id, resolution }
      }
    }
  }
  return null
}

const ARTWORK_FILTERS: readonly CanvasArtworkFilter[] = ['all', 'success', 'pending', 'failed']

// 生图工作台容器：左侧固定宽创作配置区（独立滚动），右侧作品宫格展示区（独立滚动，
// 顶部管理栏支持状态筛选/清空/批量选择）。副作用委托 canvas-workbench-actions.ts，
// 本容器只做 state/effect 编排，便于 node 单测。renderer 全程不持有 / 输入 image API Key。
export function CanvasWorkbench({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenMy
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const prompt = useStore(useCanvasStore, (s) => s.prompt)
  const model = useStore(useCanvasStore, (s) => s.model)
  const size = useStore(useCanvasStore, (s) => s.size)
  const n = useStore(useCanvasStore, (s) => s.n)
  const aspectPreset = useStore(useCanvasStore, (s) => s.aspectPreset)
  const resolution = useStore(useCanvasStore, (s) => s.resolution)
  const quality = useStore(useCanvasStore, (s) => s.quality)
  const outputFormat = useStore(useCanvasStore, (s) => s.outputFormat)
  const referenceImage = useStore(useCanvasStore, (s) => s.referenceImage)
  const generating = useStore(useCanvasStore, (s) => s.generating)
  const editing = useStore(useCanvasStore, (s) => s.editing)
  const error = useStore(useCanvasStore, (s) => s.error)
  const artworks = useStore(useCanvasStore, (s) => s.artworks)
  const statusFilter = useStore(useCanvasStore, (s) => s.statusFilter)
  const selectMode = useStore(useCanvasStore, (s) => s.selectMode)
  const selectedIds = useStore(useCanvasStore, (s) => s.selectedIds)
  const setPrompt = useStore(useCanvasStore, (s) => s.setPrompt)
  const setModel = useStore(useCanvasStore, (s) => s.setModel)
  const setAspectPreset = useStore(useCanvasStore, (s) => s.setAspectPreset)
  const setResolution = useStore(useCanvasStore, (s) => s.setResolution)
  const setQuality = useStore(useCanvasStore, (s) => s.setQuality)
  const setOutputFormat = useStore(useCanvasStore, (s) => s.setOutputFormat)
  const setReferenceImage = useStore(useCanvasStore, (s) => s.setReferenceImage)
  const setN = useStore(useCanvasStore, (s) => s.setN)
  const beginGenerate = useStore(useCanvasStore, (s) => s.beginGenerate)
  const generateSuccess = useStore(useCanvasStore, (s) => s.generateSuccess)
  const generateFailure = useStore(useCanvasStore, (s) => s.generateFailure)
  const beginEdit = useStore(useCanvasStore, (s) => s.beginEdit)
  const editSuccess = useStore(useCanvasStore, (s) => s.editSuccess)
  const editFailure = useStore(useCanvasStore, (s) => s.editFailure)
  const removeArtwork = useStore(useCanvasStore, (s) => s.removeArtwork)
  const removeSelected = useStore(useCanvasStore, (s) => s.removeSelected)
  const clearArtworks = useStore(useCanvasStore, (s) => s.clearArtworks)
  const setStatusFilter = useStore(useCanvasStore, (s) => s.setStatusFilter)
  const toggleSelectMode = useStore(useCanvasStore, (s) => s.toggleSelectMode)
  const toggleSelected = useStore(useCanvasStore, (s) => s.toggleSelected)

  const [lowBalance, setLowBalance] = useState(false)
  const [imageModels, setImageModels] = useState<string[]>([])
  // 复制结果的一次性反馈（成功「已复制」/ 失败提示），短暂展示后自动消失。
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  // 当前 image 分组（执行时用于确保该分组已有 Key）。
  const [imageGroup, setImageGroup] = useState('')
  // 大图查看（lightbox）。
  const [viewing, setViewing] = useState<CanvasArtwork | null>(null)

  const visibleArtworks = useMemo(
    () => filterArtworks(artworks, statusFilter),
    [artworks, statusFilter]
  )
  const selectedCount = Object.keys(selectedIds).length

  const api = (): CanvasWorkbenchApi | null =>
    typeof window !== 'undefined' && window.kunGui
      ? (window.kunGui as unknown as CanvasWorkbenchApi)
      : null

  // 从设置里读取 image 模型缓存并过滤；默认模型取第一个 image 模型（不硬编码）。
  const applyModelsFromCache = useCallback(
    (models: string[]): void => {
      const filtered = filterImageModels(models)
      setImageModels(filtered)
      const current = useCanvasStore.getState().model
      if (!current || !filtered.includes(current)) {
        setModel(defaultImageModel(models))
      }
    },
    [setModel]
  )

  // 首屏加载：读取 image 模型缓存 + 低余额标记（分组模式不在初始化时做任何 Key 检测）。
  useEffect(() => {
    let alive = true
    const kun = api()
    if (!kun) return
    const w = window.kunGui
    if (w?.getSettings) {
      void w.getSettings().then((settings) => {
        if (!alive) return
        applyModelsFromCache(settings.claude360?.modelCache?.models ?? [])
        setImageGroup((settings.claude360?.selectedImageGroup ?? '').trim())
      }).catch(() => undefined)
    }
    if (w?.claude360BillingMe) {
      void w.claude360BillingMe().then((me) => {
        if (alive) setLowBalance(me.lowBalance === true)
      }).catch(() => undefined)
    }
    return () => {
      alive = false
    }
  }, [applyModelsFromCache])

  // Escape 关闭大图查看。
  useEffect(() => {
    if (!viewing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setViewing(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [viewing])

  const refreshModels = useCallback((): void => {
    const w = window.kunGui
    if (!w?.claude360ModelsRefresh) return
    void w.claude360ModelsRefresh().then((res) => {
      if (res.ok) applyModelsFromCache(res.modelCache.models ?? [])
    }).catch(() => undefined)
  }, [applyModelsFromCache])

  // 选模型仅切换模型，不做 Key 检测；Key 改到「点开始生成」时按所选分组检测/创建。
  const handleChangeModel = useCallback((m: string): void => {
    setModel(m)
  }, [setModel])

  // 统一提交：有参考图 → 走 editImage(不带 mask)；否则文本生图(带 quality/output_format)。
  // 执行时按所选 image 分组确保有 Key：无则弹「需要创建分组 Key」模态，用户确认→
  // 自动创建 Key→续跑本次生成；取消/失败→静默中止。
  const handleGenerate = useCallback(async (): Promise<void> => {
    const kun = api()
    if (!kun) return
    const ready = await ensureGroupKeyForSelection(
      imageGroup.trim() || null,
      {
        listTokens: () => kun.claude360TokensList(),
        promptCreateAndEnsure: (grp) => useGroupKeyPromptStore.getState().open(grp, 'image')
      },
      { feature: '生图', model: useCanvasStore.getState().model }
    )
    if (!ready) return
    const s = useCanvasStore.getState()
    // generate 与 edit 互斥：store 只有一个 pendingArtworkId 占位槽，任一飞行中就不再
    // 提交（否则占位被覆盖，先回批次挂错参数、后回批次被静默丢弃）。ensure 弹窗 await
    // 期间状态可能变化，故在这里（而非进入函数时）读最新状态判定。
    if (s.generating || s.editing) return
    if (s.referenceImage) {
      await submitEdit(kun, { beginEdit, editSuccess, editFailure }, {
        model: s.model,
        prompt: s.prompt,
        image: s.referenceImage,
        size: s.size,
        quality: s.quality,
        output_format: s.outputFormat
      })
      return
    }
    await submitGenerate(kun, { beginGenerate, generateSuccess, generateFailure }, {
      model: s.model,
      prompt: s.prompt,
      size: s.size,
      n: s.n,
      quality: s.quality,
      output_format: s.outputFormat
    })
  }, [beginEdit, editFailure, editSuccess, beginGenerate, generateFailure, generateSuccess, imageGroup])

  // 重新生成：把该作品的参数快照回填表单（所见即所发），随后按文本生图重新提交。
  const handleRegenerate = useCallback(
    (artwork: CanvasArtwork): void => {
      const s = useCanvasStore.getState()
      // 飞行中不允许重新生成：先于表单回填检查，避免污染用户当前参数却不提交。
      if (s.generating || s.editing) return
      s.setPrompt(artwork.prompt)
      if (artwork.model) s.setModel(artwork.model)
      if ((CLAUDE360_IMAGE_QUALITIES as readonly string[]).includes(artwork.quality)) {
        s.setQuality(artwork.quality as Claude360ImageQuality)
      }
      if ((CLAUDE360_IMAGE_OUTPUT_FORMATS as readonly string[]).includes(artwork.outputFormat)) {
        s.setOutputFormat(artwork.outputFormat as Claude360ImageOutputFormat)
      }
      const matched = aspectFromSize(artwork.size)
      if (matched) {
        s.setAspectPreset(matched.aspectPreset)
        s.setResolution(matched.resolution)
      }
      s.setReferenceImage(null)
      void handleGenerate()
    },
    [handleGenerate]
  )

  const handlePickReference = useCallback((file: File): void => {
    void fileToDataUrl(file, (f) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => reject(reader.error ?? new Error('read failed'))
        reader.readAsDataURL(f)
      })
    ).then((dataUrl) => setReferenceImage(dataUrl || null)).catch(() => undefined)
  }, [setReferenceImage])

  const showCopyNotice = useCallback((message: string): void => {
    setCopyNotice(message)
    setTimeout(() => setCopyNotice(null), 2000)
  }, [])

  const handleCopyImage = useCallback((artwork: CanvasArtwork): void => {
    if (!artwork.image) return
    void copyImage(artwork.image, {
      writeText: (text) => navigator.clipboard.writeText(text),
      writeImage: async (blob) => {
        const item = new ClipboardItem({ [blob.type || 'image/png']: blob })
        await navigator.clipboard.write([item])
      },
      fetch: (...a: Parameters<typeof fetch>) => fetch(...a)
    }).then((outcome) => {
      showCopyNotice(outcome === 'failed' ? t('canvasCopyFailed') : t('canvasCopied'))
    })
  }, [showCopyNotice, t])

  const handleCopyPrompt = useCallback((artwork: CanvasArtwork): void => {
    void navigator.clipboard
      .writeText(artwork.prompt)
      .then(() => showCopyNotice(t('canvasPromptCopied')))
      .catch(() => showCopyNotice(t('canvasCopyFailed')))
  }, [showCopyNotice, t])

  const handleDownload = useCallback((artwork: CanvasArtwork): void => {
    if (!artwork.image) return
    downloadImage(artwork.image, {
      triggerDownload: (href, filename) => {
        const a = document.createElement('a')
        a.href = href
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
      }
    })
  }, [])

  const handleClearArtworks = useCallback((): void => {
    if (artworks.length === 0) return
    void confirmDialog(t('canvasClearConfirm')).then((ok) => {
      if (ok) clearArtworks()
    })
  }, [artworks.length, clearArtworks, t])

  const headerInset = useMemo(
    () => (leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''),
    [leftSidebarCollapsed]
  )

  const filterLabel = (filter: CanvasArtworkFilter): string =>
    filter === 'all' ? t('canvasFilterAll') : t(`canvasStatus_${filter}`)

  const viewingSrc = viewing?.image ? imageDataUrl(viewing.image) : null

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-testid="canvas-workbench">
      <div className="ds-stage-inset shrink-0">
        <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
          <div className="grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div className={`flex min-w-0 items-center gap-2.5 ${headerInset}`}>
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <ImageIcon className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
              <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ds-muted">
                {t('canvasWorkbenchTitle')}
              </h1>
            </div>
          </div>
        </header>
      </div>

      {/* 左右分栏：左=创作配置区（固定宽、独立滚动），右=作品宫格区（占满剩余、独立滚动）。
          小屏（<lg）回退为上下排布并整体滚动。 */}
      <main className="ds-no-drag flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-4 lg:flex-row lg:overflow-hidden">
        <aside
          data-testid="canvas-config-pane"
          className="flex w-full shrink-0 flex-col gap-4 lg:w-[350px] lg:overflow-y-auto lg:pr-1"
        >
          <CanvasToolbar lowBalance={lowBalance} onOpenMy={onOpenMy} t={t} />
          <ImagePromptPanel
            prompt={prompt}
            model={model}
            aspectPreset={aspectPreset}
            resolution={resolution}
            quality={quality}
            outputFormat={outputFormat}
            size={size}
            n={n}
            referenceImage={referenceImage}
            imageModels={imageModels}
            generating={generating || editing}
            onChangePrompt={setPrompt}
            onChangeModel={handleChangeModel}
            onChangeAspect={setAspectPreset}
            onChangeResolution={setResolution}
            onChangeQuality={setQuality}
            onChangeOutputFormat={setOutputFormat}
            onChangeCount={setN}
            onPickReference={handlePickReference}
            onClearReference={() => setReferenceImage(null)}
            onSubmit={() => void handleGenerate()}
            onRefreshModels={refreshModels}
            t={t}
          />
        </aside>

        <section
          data-testid="canvas-artworks-pane"
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:border-l lg:border-ds-border lg:pl-4"
        >
          {/* 作品管理栏：标题/数量 + 状态筛选 + 清空 / 批量选择 */}
          <div
            data-testid="canvas-artworks-toolbar"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2"
          >
            <h2 className="text-[13.5px] font-medium text-ds-ink">{t('canvasArtworksTitle')}</h2>
            <span className="text-[12px] text-ds-muted">
              {t('canvasArtworksCount', { count: artworks.length })}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1" role="tablist">
              {ARTWORK_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`rounded-md px-2 py-1 text-[12px] transition ${
                    statusFilter === filter
                      ? 'bg-ds-hover font-medium text-ds-ink'
                      : 'text-ds-muted hover:text-ds-ink'
                  }`}
                >
                  {filterLabel(filter)}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-ds-border" aria-hidden="true" />
              <button
                type="button"
                data-testid="canvas-clear-button"
                onClick={handleClearArtworks}
                className="rounded-md px-2 py-1 text-[12px] text-ds-muted transition hover:text-ds-ink"
              >
                {t('canvasClearAll')}
              </button>
              {selectMode ? (
                <>
                  <button
                    type="button"
                    data-testid="canvas-batch-delete-button"
                    disabled={selectedCount === 0}
                    onClick={removeSelected}
                    className="rounded-md px-2 py-1 text-[12px] text-red-400 transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('canvasBatchDelete', { count: selectedCount })}
                  </button>
                  <button
                    type="button"
                    data-testid="canvas-batch-cancel-button"
                    onClick={toggleSelectMode}
                    className="rounded-md px-2 py-1 text-[12px] text-ds-muted transition hover:text-ds-ink"
                  >
                    {t('canvasBatchCancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="canvas-batch-select-button"
                  onClick={toggleSelectMode}
                  className="rounded-md px-2 py-1 text-[12px] text-ds-muted transition hover:text-ds-ink"
                >
                  {t('canvasBatchSelect')}
                </button>
              )}
            </div>
          </div>

          {error ? (
            <div
              data-testid="canvas-error"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
            >
              {error}
            </div>
          ) : null}
          {copyNotice ? (
            <div
              className="rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] text-ds-muted"
              role="status"
              data-testid="canvas-copy-notice"
            >
              {copyNotice}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
            <ArtworkGrid
              artworks={visibleArtworks}
              busy={generating || editing}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onView={(artwork) => {
                if (artwork.status === 'success') setViewing(artwork)
              }}
              onCopyPrompt={handleCopyPrompt}
              onDownload={handleDownload}
              onRegenerate={handleRegenerate}
              onRemove={(artwork) => removeArtwork(artwork.id)}
              emptyKey={artworks.length > 0 ? 'canvasFilterEmpty' : 'canvasArtworksEmpty'}
              t={t}
            />
          </div>
        </section>
      </main>

      {/* 大图查看（lightbox）：点击遮罩或 Escape 关闭；提供 复制图片 / 下载。 */}
      {viewing && viewingSrc ? (
        <div
          data-testid="canvas-lightbox"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setViewing(null)}
        >
          <img
            src={viewingSrc}
            alt={t('canvasImageAlt', { prompt: viewing.prompt })}
            className="max-h-[78vh] max-w-full rounded-xl object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
          <p
            className="max-w-[720px] text-center text-[12.5px] leading-5 text-white/80"
            onClick={(event) => event.stopPropagation()}
          >
            {viewing.prompt}
          </p>
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => handleCopyImage(viewing)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-[12.5px] font-medium text-ds-ink transition hover:bg-white"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('canvasCopyImage')}
            </button>
            <button
              type="button"
              onClick={() => handleDownload(viewing)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-[12.5px] font-medium text-ds-ink transition hover:bg-white"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('canvasDownload')}
            </button>
            <button
              type="button"
              onClick={() => setViewing(null)}
              aria-label={t('close')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-white/30"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('close')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
