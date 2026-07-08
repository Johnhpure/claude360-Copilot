import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Image as ImageIcon } from 'lucide-react'
import {
  CLAUDE360_ASPECT_PRESETS,
  CLAUDE360_IMAGE_OUTPUT_FORMATS,
  CLAUDE360_IMAGE_QUALITIES,
  CLAUDE360_IMAGE_RESOLUTIONS,
  type Claude360CanvasImage,
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
  hydrateCanvasArtworksFromDisk,
  persistGeneratedImages,
  submitGenerate,
  submitEdit,
  fileToDataUrl,
  copyImage,
  downloadImage,
  type CanvasPersistenceApi,
  type CanvasWorkbenchApi
} from '../../canvas/canvas-workbench-actions'
import { imageDataUrl } from '../../canvas/image-result-utils'
import { useLocalAssetSrc } from '../../lib/use-local-asset-src'
import { confirmDialog } from '../../lib/confirm-dialog'
import { PageHeader } from '../shell'
import { toast } from '../ui'
import { CanvasToolbar } from './CanvasToolbar'
import { ImagePromptPanel } from './ImagePromptPanel'
import { ImageLightbox } from './ImageLightbox'
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
  // 当前 image 分组（执行时用于确保该分组已有 Key）。
  const [imageGroup, setImageGroup] = useState('')
  // 当前工作空间根：资产落盘 / 恢复的定位（07-05）。
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  // 大图查看（lightbox，基于 ui/Modal，Esc/遮罩关闭由基类接管）。
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
  // 07-05：顺带记录 workspaceRoot 并从磁盘恢复本工作空间的生图作品。
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
        const root = (settings.workspaceRoot ?? '').trim()
        setWorkspaceRoot(root)
        if (root) {
          void hydrateCanvasArtworksFromDisk(
            w as unknown as CanvasPersistenceApi,
            useCanvasStore.getState(),
            root
          )
        }
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

  // Escape 关闭大图查看由 ui/Modal 基类接管（ImageLightbox）。

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
    // 服务端成功后先尝试落盘，再把 pending 卡片更新为 success；落盘失败不改变生成成功状态。
    const persistBeforeSuccess = async (images: Claude360CanvasImage[]): Promise<Record<string, string>> => {
      if (!images.length || !workspaceRoot || !window.kunGui?.mediaAssetsSaveImage) return {}
      return await persistGeneratedImages(
        window.kunGui as unknown as CanvasPersistenceApi,
        null,
        workspaceRoot,
        images,
        {
          size: s.size,
          quality: s.quality,
          format: s.outputFormat,
          ...(imageGroup ? { group: imageGroup } : {})
        }
      )
    }
    if (s.referenceImage) {
      await submitEdit(
        kun,
        { beginEdit, editSuccess, editFailure },
        {
          model: s.model,
          prompt: s.prompt,
          image: s.referenceImage,
          size: s.size,
          quality: s.quality,
          output_format: s.outputFormat
        },
        { beforeSuccess: persistBeforeSuccess }
      )
      return
    }
    await submitGenerate(
      kun,
      { beginGenerate, generateSuccess, generateFailure },
      {
        model: s.model,
        prompt: s.prompt,
        size: s.size,
        n: s.n,
        quality: s.quality,
        output_format: s.outputFormat
      },
      { beforeSuccess: persistBeforeSuccess }
    )
  }, [beginEdit, editFailure, editSuccess, beginGenerate, generateFailure, generateSuccess, imageGroup, workspaceRoot])

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
      // 一次性反馈走全局 toast（Toaster 已挂 AppShell，勿重复挂载）。
      if (outcome === 'failed') toast.error(t('canvasCopyFailed'))
      else toast.success(t('canvasCopied'))
    })
  }, [t])

  const handleCopyPrompt = useCallback((artwork: CanvasArtwork): void => {
    void navigator.clipboard
      .writeText(artwork.prompt)
      .then(() => toast.success(t('canvasPromptCopied')))
      .catch(() => toast.error(t('canvasCopyFailed')))
  }, [t])

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

  // 07-05：批量/清空与单删同语义——磁盘 metadata 必须同步删除，否则下次 hydrate
  // 会把已删作品从磁盘补回（审查 Critical 1）。已落盘条目先确认是否连本地文件删。
  const syncDiskDeletion = useCallback(
    (targets: CanvasArtwork[]): void => {
      const w = typeof window !== 'undefined' ? window.kunGui : undefined
      const ids = targets.map((artwork) => artwork.id)
      if (!workspaceRoot || !w?.mediaAssetsDelete || ids.length === 0) return
      const finish = (deleteFiles: boolean): void => {
        void w.mediaAssetsDelete({ workspaceRoot, kind: 'image', ids, deleteFiles }).catch(() => undefined)
      }
      if (targets.some((artwork) => artwork.localPath)) {
        void confirmDialog(t('canvasDeleteLocalFileConfirm')).then((deleteFiles) => finish(deleteFiles))
        return
      }
      finish(false)
    },
    [workspaceRoot, t]
  )

  const handleRemoveSelected = useCallback((): void => {
    const s = useCanvasStore.getState()
    // 与 store.removeSelected 相同口径：pending 占位豁免。
    const targets = s.artworks.filter((artwork) => artwork.status !== 'pending' && s.selectedIds[artwork.id])
    removeSelected()
    syncDiskDeletion(targets)
  }, [removeSelected, syncDiskDeletion])

  const handleClearArtworks = useCallback((): void => {
    if (artworks.length === 0) return
    void confirmDialog(t('canvasClearConfirm')).then((ok) => {
      if (!ok) return
      const targets = useCanvasStore.getState().artworks.filter((artwork) => artwork.status !== 'pending')
      clearArtworks()
      syncDiskDeletion(targets)
    })
  }, [artworks.length, clearArtworks, syncDiskDeletion, t])

  // 07-05：删除作品 = UI 列表移除 + 同步磁盘 metadata（含可选删本地文件确认）。
  const handleRemoveArtwork = useCallback(
    (artwork: CanvasArtwork): void => {
      removeArtwork(artwork.id)
      syncDiskDeletion([artwork])
    },
    [removeArtwork, syncDiskDeletion]
  )

  const headerInset = useMemo(
    () => (leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''),
    [leftSidebarCollapsed]
  )

  const filterLabel = (filter: CanvasArtworkFilter): string =>
    filter === 'all' ? t('canvasFilterAll') : t(`canvasStatus_${filter}`)

  // 大图查看：本地落盘文件优先，缺失回退远程/内存 src（07-05）。
  const viewingFallbackSrc = viewing?.image ? imageDataUrl(viewing.image) : null
  const viewingSrc = useLocalAssetSrc(workspaceRoot, viewing?.localPath, viewingFallbackSrc)

  return (
    <div className="ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-testid="canvas-workbench">
      {/* 统一页头（shell/PageHeader）：大标题 + 侧栏折叠开关；窗口控制留白沿用 inset 类 */}
      <PageHeader
        title={t('canvasWorkbenchTitle')}
        leading={
          <div className={`flex items-center gap-2.5 ${headerInset}`}>
            <SidebarTitlebarToggleButton
              onClick={onToggleLeftSidebar}
              title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            />
            <ImageIcon className="h-4 w-4 text-ds-muted" strokeWidth={1.75} aria-hidden />
          </div>
        }
      />

      {/* 左右分栏：左=创作配置区（固定宽、独立滚动），右=作品宫格区（占满剩余、独立滚动）。
          小屏（<lg）回退为上下排布并整体滚动。页边距 24px / 卡间距 16px（Calm Blue 语义常量）。 */}
      <main className="ds-no-drag flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-1 lg:flex-row lg:overflow-hidden">
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
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 lg:border-l lg:border-ds-border lg:pl-4"
        >
          {/* 作品管理栏：标题/数量 + 状态筛选（胶囊 chip）+ 清空 / 批量选择 */}
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
                  className={`rounded-full px-2.5 py-1 text-[12px] transition-colors duration-[var(--motion-fast)] ${
                    statusFilter === filter
                      ? 'bg-ds-accent-soft font-medium text-ds-accent'
                      : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
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
                className="rounded-full px-2.5 py-1 text-[12px] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('canvasClearAll')}
              </button>
              {selectMode ? (
                <>
                  <button
                    type="button"
                    data-testid="canvas-batch-delete-button"
                    disabled={selectedCount === 0}
                    onClick={handleRemoveSelected}
                    className="rounded-full px-2.5 py-1 text-[12px] text-ds-danger transition-colors duration-[var(--motion-fast)] hover:bg-ds-danger-soft disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t('canvasBatchDelete', { count: selectedCount })}
                  </button>
                  <button
                    type="button"
                    data-testid="canvas-batch-cancel-button"
                    onClick={toggleSelectMode}
                    className="rounded-full px-2.5 py-1 text-[12px] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
                  >
                    {t('canvasBatchCancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid="canvas-batch-select-button"
                  onClick={toggleSelectMode}
                  className="rounded-full px-2.5 py-1 text-[12px] text-ds-muted transition-colors duration-[var(--motion-fast)] hover:bg-ds-hover hover:text-ds-ink"
                >
                  {t('canvasBatchSelect')}
                </button>
              )}
            </div>
          </div>

          {error ? (
            <div
              data-testid="canvas-error"
              className="rounded-[var(--radius-md)] border border-ds-danger bg-ds-danger-soft px-3 py-2 text-[12px] text-ds-danger"
            >
              {error}
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
              onRemove={handleRemoveArtwork}
              emptyKey={artworks.length > 0 ? 'canvasFilterEmpty' : 'canvasArtworksEmpty'}
              workspaceRoot={workspaceRoot}
              t={t}
            />
          </div>
        </section>
      </main>

      {/* 大图查看：基于 ui/Modal 的轻玻璃 Lightbox（遮罩 blur + 降级开关由基类提供）。 */}
      {viewing ? (
        <ImageLightbox
          open
          src={viewingSrc}
          prompt={viewing.prompt}
          onClose={() => setViewing(null)}
          onCopyImage={() => handleCopyImage(viewing)}
          onCopyPrompt={() => handleCopyPrompt(viewing)}
          onDownload={() => handleDownload(viewing)}
          onDelete={() => {
            handleRemoveArtwork(viewing)
            setViewing(null)
          }}
          t={t}
        />
      ) : null}
    </div>
  )
}
