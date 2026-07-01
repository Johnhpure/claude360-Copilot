// 生图工作台 store（plan-06 Task 4）。
//
// 与 music-task-store 同款模式：纯 reducer + Zustand + browser-storage 持久化。
// 状态：prompt/model/size/n；generate/edit 的 pending/success/failure；active 选择；
// 历史添加与截断（最多 100 条）。
//
// Risk Notes：
// - renderer 全程不持有 / 输入 image API Key，持久化里也绝不含 Key。
// - base64 体积大：持久化时丢弃超阈值 base64（只留 url / 小 base64），
//   历史条数硬上限 CANVAS_HISTORY_LIMIT，损坏数据安全恢复空列表。
import { create, type StoreApi } from 'zustand'
import type {
  Claude360CanvasImage,
  Claude360ImageOutputFormat,
  Claude360ImageQuality,
  Claude360ImageResolution,
  Claude360ImageSize
} from '@shared/claude360-canvas'
import {
  CLAUDE360_DEFAULT_ASPECT,
  CLAUDE360_DEFAULT_OUTPUT_FORMAT,
  CLAUDE360_DEFAULT_QUALITY,
  CLAUDE360_DEFAULT_RESOLUTION,
  resolveImageSizeValue
} from '@shared/claude360-canvas'
import {
  readBrowserStorageItem,
  writeBrowserStorageItem
} from '@renderer/lib/browser-storage'

// —— 硬上限参数（避免历史无限增长 / localStorage 爆量）——
export const CANVAS_HISTORY_LIMIT = 100
export const CANVAS_HISTORY_STORAGE_KEY = 'c360-copilot-canvas-history'
// 单张 base64 持久化上限：以 base64 字符长度近似字节（base64 为 ASCII，长度≈字节数），
// 约 200KB；超过只留元信息占位不落盘 b64Json。
export const CANVAS_HISTORY_MAX_BASE64_LENGTH = 200 * 1024

// —— 生图参数默认值（size 由默认宽高比 + 分辨率派生）——
export const CANVAS_DEFAULT_SIZE: Claude360ImageSize = resolveImageSizeValue(
  CLAUDE360_DEFAULT_ASPECT,
  CLAUDE360_DEFAULT_RESOLUTION
)
export const CANVAS_MIN_N = 1
export const CANVAS_MAX_N = 4

export interface CanvasState {
  // 表单参数
  prompt: string
  model: string
  size: Claude360ImageSize // 由 aspectPreset + resolution 派生
  n: number
  aspectPreset: string
  resolution: Claude360ImageResolution
  quality: Claude360ImageQuality
  outputFormat: Claude360ImageOutputFormat
  referenceImage: string | null // 参考图 dataURL（有值时走 editImage，不带 mask）
  // 运行态
  generating: boolean
  editing: boolean
  error: string | null
  // 结果
  lastResult: Claude360CanvasImage[]
  history: Claude360CanvasImage[]
  activeImageId: string | null
  // actions —— 表单
  setPrompt: (prompt: string) => void
  setModel: (model: string) => void
  setAspectPreset: (aspectPreset: string) => void
  setResolution: (resolution: Claude360ImageResolution) => void
  setQuality: (quality: Claude360ImageQuality) => void
  setOutputFormat: (outputFormat: Claude360ImageOutputFormat) => void
  setReferenceImage: (referenceImage: string | null) => void
  setN: (n: number) => void
  // actions —— 生成
  beginGenerate: () => void
  generateSuccess: (images: Claude360CanvasImage[]) => void
  generateFailure: (message: string) => void
  // actions —— 编辑
  beginEdit: () => void
  editSuccess: (images: Claude360CanvasImage[]) => void
  editFailure: (message: string) => void
  // actions —— 选择 / 清理
  setActiveImage: (id: string) => void
  clearError: () => void
}

/** 把新结果排在最前并截断到上限（纯函数，便于测试）。 */
export function reduceAddHistory(
  history: Claude360CanvasImage[],
  images: Claude360CanvasImage[]
): Claude360CanvasImage[] {
  return [...images, ...history].slice(0, CANVAS_HISTORY_LIMIT)
}

/** 夹逼张数到 [CANVAS_MIN_N, CANVAS_MAX_N]。 */
export function clampN(n: number): number {
  if (!Number.isFinite(n)) return CANVAS_MIN_N
  return Math.max(CANVAS_MIN_N, Math.min(CANVAS_MAX_N, Math.round(n)))
}

/** 一条历史是否可用（url 或 b64Json 至少其一）。 */
function isUsableImage(image: unknown): image is Claude360CanvasImage {
  if (!image || typeof image !== 'object') return false
  const img = image as Partial<Claude360CanvasImage>
  if (typeof img.id !== 'string') return false
  return Boolean(img.url) || Boolean(img.b64Json)
}

/** 从持久化恢复时过滤坏条目（缺失 url 与 b64Json、或非对象）。 */
export function sanitizeRehydratedHistory(history: unknown[]): Claude360CanvasImage[] {
  if (!Array.isArray(history)) return []
  return history.filter(isUsableImage)
}

/**
 * 序列化为持久化用的历史：只保留最近 N 条；
 * 超阈值的大 base64 丢弃 b64Json（只留元信息占位，避免 localStorage 爆量）。
 */
export function serializeHistoryForPersist(
  history: Claude360CanvasImage[]
): Claude360CanvasImage[] {
  return history.slice(0, CANVAS_HISTORY_LIMIT).map((image) => {
    if (image.source === 'base64' && image.b64Json && image.b64Json.length > CANVAS_HISTORY_MAX_BASE64_LENGTH) {
      const { b64Json: _dropped, ...rest } = image
      return rest
    }
    return image
  })
}

/** 从本地存储读取历史；损坏 / 缺失安全恢复空列表并 sanitize。 */
export function loadPersistedHistory(): Claude360CanvasImage[] {
  const raw = readBrowserStorageItem(CANVAS_HISTORY_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { history?: unknown }
    if (!parsed || !Array.isArray(parsed.history)) return []
    return sanitizeRehydratedHistory(parsed.history)
  } catch {
    return []
  }
}

/** 落盘：只写限量历史，绝不写入任何 API Key（结果结构里也没有）。 */
function persistHistory(history: Claude360CanvasImage[]): void {
  const persisted = serializeHistoryForPersist(history)
  writeBrowserStorageItem(CANVAS_HISTORY_STORAGE_KEY, JSON.stringify({ history: persisted }))
}

/**
 * 创建一个独立的 canvas store 实例。测试用 createCanvasStore() 得到隔离实例；
 * 应用侧用单例 useCanvasStore（自动从本地存储恢复并在历史变更时落盘）。
 */
export function createCanvasStore(
  options: { initialHistory?: Claude360CanvasImage[]; persist?: boolean } = {}
): StoreApi<CanvasState> {
  const shouldPersist = options.persist === true
  const store = create<CanvasState>((set) => ({
    prompt: '',
    model: '',
    aspectPreset: CLAUDE360_DEFAULT_ASPECT,
    resolution: CLAUDE360_DEFAULT_RESOLUTION,
    size: resolveImageSizeValue(CLAUDE360_DEFAULT_ASPECT, CLAUDE360_DEFAULT_RESOLUTION),
    quality: CLAUDE360_DEFAULT_QUALITY,
    outputFormat: CLAUDE360_DEFAULT_OUTPUT_FORMAT,
    referenceImage: null,
    n: CANVAS_MIN_N,
    generating: false,
    editing: false,
    error: null,
    lastResult: [],
    history: options.initialHistory ?? [],
    activeImageId: null,
    setPrompt: (prompt) => set({ prompt }),
    setModel: (model) => set({ model }),
    setAspectPreset: (aspectPreset) =>
      set((s) => ({ aspectPreset, size: resolveImageSizeValue(aspectPreset, s.resolution) })),
    setResolution: (resolution) =>
      set((s) => ({ resolution, size: resolveImageSizeValue(s.aspectPreset, resolution) })),
    setQuality: (quality) => set({ quality }),
    setOutputFormat: (outputFormat) => set({ outputFormat }),
    setReferenceImage: (referenceImage) => set({ referenceImage }),
    setN: (n) => set({ n: clampN(n) }),
    beginGenerate: () => set({ generating: true, error: null }),
    generateSuccess: (images) =>
      set((s) => ({
        generating: false,
        error: null,
        lastResult: images,
        history: reduceAddHistory(s.history, images),
        activeImageId: images[0]?.id ?? s.activeImageId
      })),
    generateFailure: (message) => set({ generating: false, error: message }),
    beginEdit: () => set({ editing: true, error: null }),
    editSuccess: (images) =>
      set((s) => ({
        editing: false,
        error: null,
        lastResult: images,
        history: reduceAddHistory(s.history, images),
        activeImageId: images[0]?.id ?? s.activeImageId
      })),
    editFailure: (message) => set({ editing: false, error: message }),
    setActiveImage: (id) => set({ activeImageId: id }),
    clearError: () => set({ error: null })
  }))

  if (shouldPersist) {
    store.subscribe((state) => persistHistory(state.history))
  }
  return store
}

/** 应用单例：启动时从本地存储恢复，历史变更自动落盘。 */
export const useCanvasStore = createCanvasStore({
  initialHistory: loadPersistedHistory(),
  persist: true
})
