import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Image as ImageIcon } from 'lucide-react'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { useCanvasStore } from '../../canvas/canvas-store'
import {
  detectCanvasAccess,
  defaultImageModel,
  filterImageModels,
  submitGenerate,
  submitEdit,
  fileToDataUrl,
  copyImage,
  downloadImage,
  type CanvasAccess,
  type CanvasWorkbenchApi
} from '../../canvas/canvas-workbench-actions'
import { CanvasToolbar } from './CanvasToolbar'
import { ImagePromptPanel } from './ImagePromptPanel'
import { ImageResultGrid } from './ImageResultGrid'
import { ImageHistoryPanel } from './ImageHistoryPanel'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  /** 跳转「我的」页（未登录 / 无 image 分组 / 低余额充值的修复入口）。 */
  onOpenMy: () => void
}

// 生图工作台容器：拥有表单/编辑 state 与副作用编排（生成 / 编辑 / 上传 / 复制 / 下载 /
// 权限探测 / 模型过滤）。副作用委托给 canvas-workbench-actions.ts（可注入依赖），
// 本容器只做 state/effect 编排，便于 node 单测。renderer 全程不持有 / 输入 image API Key。
// 首屏即工具型工作台（非营销 hero）。
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
  const lastResult = useStore(useCanvasStore, (s) => s.lastResult)
  const history = useStore(useCanvasStore, (s) => s.history)
  const activeImageId = useStore(useCanvasStore, (s) => s.activeImageId)
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
  const setActiveImage = useStore(useCanvasStore, (s) => s.setActiveImage)

  const [access, setAccess] = useState<CanvasAccess | null>(null)
  const [lowBalance, setLowBalance] = useState(false)
  const [imageModels, setImageModels] = useState<string[]>([])
  // 复制结果的一次性反馈（成功「已复制」/ 失败提示），短暂展示后自动消失。
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

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

  // 首屏加载：探测登录/分组 + 拉低余额标记 + 读取 image 模型缓存。
  useEffect(() => {
    let alive = true
    const kun = api()
    if (!kun) {
      setAccess({ loggedIn: false, hasImageGroup: false })
      return
    }
    void detectCanvasAccess(kun).then((a) => {
      if (alive) setAccess(a)
    })
    const w = window.kunGui
    if (w?.getSettings) {
      void w.getSettings().then((settings) => {
        if (alive) applyModelsFromCache(settings.claude360?.modelCache?.models ?? [])
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

  const refreshModels = useCallback((): void => {
    const w = window.kunGui
    if (!w?.claude360ModelsRefresh) return
    void w.claude360ModelsRefresh().then((res) => {
      if (res.ok) applyModelsFromCache(res.modelCache.models ?? [])
    }).catch(() => undefined)
  }, [applyModelsFromCache])

  // 统一提交：有参考图 → 走 editImage(不带 mask)；否则文本生图(带 quality/output_format)。
  const handleGenerate = useCallback(async (): Promise<void> => {
    const kun = api()
    if (!kun) return
    const s = useCanvasStore.getState()
    if (s.referenceImage) {
      if (s.editing) return
      await submitEdit(kun, { beginEdit, editSuccess, editFailure }, {
        model: s.model,
        prompt: s.prompt,
        image: s.referenceImage,
        size: s.size
      })
      return
    }
    if (s.generating) return
    await submitGenerate(kun, { beginGenerate, generateSuccess, generateFailure }, {
      model: s.model,
      prompt: s.prompt,
      size: s.size,
      n: s.n,
      quality: s.quality,
      output_format: s.outputFormat
    })
  }, [beginEdit, editFailure, editSuccess, beginGenerate, generateFailure, generateSuccess])

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

  const handleCopy = useCallback((image: Claude360CanvasImage): void => {
    void copyImage(image, {
      writeText: (text) => navigator.clipboard.writeText(text),
      writeImage: async (blob) => {
        const item = new ClipboardItem({ [blob.type || 'image/png']: blob })
        await navigator.clipboard.write([item])
      },
      fetch: (...a: Parameters<typeof fetch>) => fetch(...a)
    }).then((outcome) => {
      // 给出一次性复制反馈：url→复制链接、image→复制图片、failed→失败提示。
      setCopyNotice(outcome === 'failed' ? t('canvasCopyFailed') : t('canvasCopied'))
      setTimeout(() => setCopyNotice(null), 2000)
    })
  }, [t])

  const handleDownload = useCallback((image: Claude360CanvasImage): void => {
    downloadImage(image, {
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

  const headerInset = useMemo(
    () => (leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''),
    [leftSidebarCollapsed]
  )

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

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
          <CanvasToolbar access={access} lowBalance={lowBalance} onOpenMy={onOpenMy} t={t} />
          {copyNotice ? (
            <div
              className="rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] text-ds-muted"
              role="status"
              data-testid="canvas-copy-notice"
            >
              {copyNotice}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-col gap-4 lg:flex-row">
            <div className="flex w-full flex-col gap-4 lg:max-w-[360px]">
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
                onChangeModel={setModel}
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
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {error ? (
                <div
                  data-testid="canvas-error"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                >
                  {error}
                </div>
              ) : null}
              <ImageResultGrid
                images={lastResult}
                activeImageId={activeImageId}
                onSelect={setActiveImage}
                onCopy={handleCopy}
                onDownload={handleDownload}
                emptyKey="canvasResultEmpty"
                testId="image-result-grid"
                t={t}
              />
              <ImageHistoryPanel
                history={history}
                activeImageId={activeImageId}
                onSelect={setActiveImage}
                onCopy={handleCopy}
                onDownload={handleDownload}
                t={t}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
