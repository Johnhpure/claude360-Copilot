// 生图工作台的纯编排函数（plan-06 Task 5+7）。
//
// 把 image 模型过滤、access 探测、生成/编辑提交、上传本地图片、复制/下载等副作用
// 从 React 组件里剥离出来，只依赖通过参数注入的最小 kunGui 子集与 store 动作，
// 便于在 node 环境下用 renderToStaticMarkup + mock 直接单测（与 music-workbench-actions 同款）。
//
// Risk Notes：renderer 绝不持有 / 输入 image API Key（后端 service 按 selectedImageGroup +
// purpose='image' 处理）；本模块只处理展示态数据与请求编排。
import { isClaude360ImageModelId } from '@shared/app-settings'
import type {
  Claude360CanvasImage,
  Claude360ImageEditPayload,
  Claude360ImageGeneratePayload,
  Claude360ImageResult
} from '@shared/claude360-canvas'
import type { Claude360TokenListItem } from '@shared/claude360'
import type { CanvasState } from './canvas-store'
import { imageDataUrl, imageCopyUrl, isDownloadableImage, safeImageFilename } from './image-result-utils'

/** 生图工作台需要用到的 kunGui 子集（与真实签名一致）。 */
export type CanvasWorkbenchApi = {
  claude360CanvasGenerate: (payload: Claude360ImageGeneratePayload) => Promise<Claude360ImageResult>
  claude360CanvasEdit: (payload: Claude360ImageEditPayload) => Promise<Claude360ImageResult>
  claude360TokensList: () => Promise<Claude360TokenListItem[]>
}

// —— image 模型过滤（Task7：不硬编码 gpt-image-2，用 isClaude360ImageModelId）——
/** 从模型 id 列表中只保留 image 模型。 */
export function filterImageModels(models: string[]): string[] {
  return models.filter((id) => isClaude360ImageModelId(id))
}

/** 默认模型：第一个 image 模型；无则空串（UI 显示「暂无可用生图模型」）。 */
export function defaultImageModel(models: string[]): string {
  return filterImageModels(models)[0] ?? ''
}

// —— access 探测 ——
export type CanvasAccess = {
  loggedIn: boolean
  hasImageGroup: boolean
}

/** 从 token 列表判断是否有 image 分组 Key（大小写不敏感，含子串匹配 image）。 */
export function hasImageGroupToken(tokens: Claude360TokenListItem[]): boolean {
  return tokens.some((t) => (t.group || '').toLowerCase().includes('image'))
}

/**
 * 探测生图可用性：拉取 token 列表，判断登录态与 image 分组。
 * 失败（未登录/网络）时返回 loggedIn:false，让 UI 显示「去我的页修复」入口。
 */
export async function detectCanvasAccess(
  api: Pick<CanvasWorkbenchApi, 'claude360TokensList'>
): Promise<CanvasAccess> {
  try {
    const tokens = await api.claude360TokensList()
    return { loggedIn: true, hasImageGroup: hasImageGroupToken(tokens) }
  } catch {
    return { loggedIn: false, hasImageGroup: false }
  }
}

export type SubmitResult = { ok: boolean; message?: string }

/**
 * 提交一次文本生图：校验 → beginGenerate → 调 main 生成 →
 * 成功 generateSuccess / 失败 generateFailure。
 */
export async function submitGenerate(
  api: Pick<CanvasWorkbenchApi, 'claude360CanvasGenerate'>,
  store: Pick<CanvasState, 'beginGenerate' | 'generateSuccess' | 'generateFailure'>,
  payload: Claude360ImageGeneratePayload
): Promise<SubmitResult> {
  if (!payload.prompt.trim()) return { ok: false, message: 'emptyPrompt' }
  if (!payload.model.trim()) return { ok: false, message: 'emptyModel' }
  store.beginGenerate()
  try {
    const result = await api.claude360CanvasGenerate({
      model: payload.model,
      prompt: payload.prompt,
      ...(payload.size ? { size: payload.size } : {}),
      ...(payload.n ? { n: payload.n } : {}),
      ...(payload.quality ? { quality: payload.quality } : {}),
      ...(payload.output_format ? { output_format: payload.output_format } : {})
    })
    if (result.ok) {
      store.generateSuccess(result.images)
      return { ok: true }
    }
    store.generateFailure(result.message)
    return { ok: false, message: result.message }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    store.generateFailure(message)
    return { ok: false, message }
  }
}

/**
 * 提交一次单图编辑：校验（image/prompt/model 必填）→ beginEdit → 调 main 编辑 →
 * 成功 editSuccess / 失败 editFailure。
 */
export async function submitEdit(
  api: Pick<CanvasWorkbenchApi, 'claude360CanvasEdit'>,
  store: Pick<CanvasState, 'beginEdit' | 'editSuccess' | 'editFailure'>,
  payload: Claude360ImageEditPayload
): Promise<SubmitResult> {
  if (!payload.image) return { ok: false, message: 'emptyImage' }
  if (!payload.prompt.trim()) return { ok: false, message: 'emptyPrompt' }
  if (!payload.model.trim()) return { ok: false, message: 'emptyModel' }
  store.beginEdit()
  try {
    const result = await api.claude360CanvasEdit({
      model: payload.model,
      prompt: payload.prompt,
      image: payload.image,
      ...(payload.mask ? { mask: payload.mask } : {}),
      ...(payload.size ? { size: payload.size } : {})
    })
    if (result.ok) {
      store.editSuccess(result.images)
      return { ok: true }
    }
    store.editFailure(result.message)
    return { ok: false, message: result.message }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    store.editFailure(message)
    return { ok: false, message }
  }
}

/**
 * 本地图片 → dataURL。上传方式不使用 Node API：renderer 端用 FileReader 读 File→base64 dataURL。
 * reader 通过参数注入，便于测试；生产侧由容器传入基于 FileReader 的实现。
 */
export async function fileToDataUrl(
  file: File,
  readAsDataURL: (file: File) => Promise<string>
): Promise<string> {
  return readAsDataURL(file)
}

// —— 复制 ——
export type CopyDeps = {
  writeText: (text: string) => Promise<void>
  writeImage: (blob: Blob) => Promise<void>
  fetch: typeof fetch
}

/**
 * 复制图片：
 * - url 图片 → 复制 URL 文本（'url'）；
 * - base64 图片 → 拉取 data URL 转 Blob 复制图片（'image'）；
 * 失败返回 'failed'。
 */
export async function copyImage(
  image: Claude360CanvasImage,
  deps: CopyDeps
): Promise<'url' | 'image' | 'failed'> {
  const url = imageCopyUrl(image)
  if (url) {
    try {
      await deps.writeText(url)
      return 'url'
    } catch {
      return 'failed'
    }
  }
  const dataUrl = imageDataUrl(image)
  if (!dataUrl) return 'failed'
  try {
    const res = await deps.fetch(dataUrl)
    const blob = await res.blob()
    await deps.writeImage(blob)
    return 'image'
  } catch {
    return 'failed'
  }
}

// —— 下载 ——
export type DownloadDeps = {
  triggerDownload: (href: string, filename: string) => void
}

/** 下载图片：base64 用 data URL，url 用原始链接；损坏（无源）不下载。 */
export function downloadImage(image: Claude360CanvasImage, deps: DownloadDeps): boolean {
  if (!isDownloadableImage(image)) return false
  const href = imageDataUrl(image)
  if (!href) return false
  const filename = safeImageFilename(image)
  deps.triggerDownload(href, filename)
  return true
}
