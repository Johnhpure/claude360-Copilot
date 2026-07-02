// 生图工作台 store（plan-06 Task 4 → 作品宫格重构）。
//
// 与 music-task-store 同款模式：纯 reducer + Zustand + browser-storage 持久化。
// 状态：表单参数；作品列表 artworks（pending/success/failed 三态卡片，生成中立即
// 出现在宫格并在完成后原位替换）；状态筛选；批量选择。
//
// Risk Notes：
// - renderer 全程不持有 / 输入 image API Key，持久化里也绝不含 Key。
// - base64 体积大：持久化时丢弃超阈值 base64（只留 url / 小 base64），
//   条数硬上限 CANVAS_HISTORY_LIMIT，损坏数据安全恢复空列表。
// - 只持久化 success 作品；pending/failed 属会话内瞬态。
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
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '@renderer/lib/browser-storage'

// —— 硬上限参数（避免作品无限增长 / localStorage 爆量）——
export const CANVAS_HISTORY_LIMIT = 100
export const CANVAS_ARTWORKS_STORAGE_KEY = 'c360-copilot-canvas-artworks'
/** 旧版（纯图片历史）存储键：读取迁移用，不再写入。 */
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

export type CanvasArtworkStatus = 'pending' | 'success' | 'failed'
export type CanvasArtworkFilter = 'all' | CanvasArtworkStatus

/**
 * 作品卡片条目：一张成功图片 / 一批生成中的占位 / 一次失败记录。
 * 参数快照（prompt/model/size/...）随条目保存，供元信息展示与「重新生成」。
 */
export type CanvasArtwork = {
  id: string
  status: CanvasArtworkStatus
  /** status='success' 时的图片本体。 */
  image?: Claude360CanvasImage
  prompt: string
  model: string
  size: string
  quality: string
  outputFormat: string
  /** 该批张数（pending 占位展示用）。 */
  n: number
  /** status='failed' 时的错误信息。 */
  error?: string
  createdAt: string
}

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
  /** 当前飞行中批次对应的 pending 作品 id。 */
  pendingArtworkId: string | null
  // 作品区
  artworks: CanvasArtwork[]
  statusFilter: CanvasArtworkFilter
  selectMode: boolean
  selectedIds: Record<string, true>
  // actions —— 表单
  setPrompt: (prompt: string) => void
  setModel: (model: string) => void
  setAspectPreset: (aspectPreset: string) => void
  setResolution: (resolution: Claude360ImageResolution) => void
  setQuality: (quality: Claude360ImageQuality) => void
  setOutputFormat: (outputFormat: Claude360ImageOutputFormat) => void
  setReferenceImage: (referenceImage: string | null) => void
  setN: (n: number) => void
  // actions —— 生成（签名与 canvas-workbench-actions 注入约定保持不变）
  beginGenerate: () => void
  generateSuccess: (images: Claude360CanvasImage[]) => void
  generateFailure: (message: string) => void
  // actions —— 编辑
  beginEdit: () => void
  editSuccess: (images: Claude360CanvasImage[]) => void
  editFailure: (message: string) => void
  // actions —— 作品管理
  removeArtwork: (id: string) => void
  removeSelected: () => void
  clearArtworks: () => void
  setStatusFilter: (filter: CanvasArtworkFilter) => void
  toggleSelectMode: () => void
  toggleSelected: (id: string) => void
  clearError: () => void
}

let artworkSeq = 0
function nextArtworkId(): string {
  artworkSeq += 1
  return `art_${artworkSeq}_${Date.now().toString(36)}`
}

/** 夹逼张数到 [CANVAS_MIN_N, CANVAS_MAX_N]。 */
export function clampN(n: number): number {
  if (!Number.isFinite(n)) return CANVAS_MIN_N
  return Math.max(CANVAS_MIN_N, Math.min(CANVAS_MAX_N, Math.round(n)))
}

/** 从当前表单参数构造一条 pending 占位作品（纯函数，便于测试）。 */
export function pendingArtworkFromForm(
  s: Pick<CanvasState, 'prompt' | 'model' | 'size' | 'quality' | 'outputFormat' | 'n'>
): CanvasArtwork {
  return {
    id: nextArtworkId(),
    status: 'pending',
    prompt: s.prompt.trim(),
    model: s.model,
    size: s.size,
    quality: s.quality,
    outputFormat: s.outputFormat,
    n: s.n,
    createdAt: new Date().toISOString()
  }
}

/** 把 pending 占位原位替换为一批 success 作品（参数快照继承占位条目）。 */
export function reduceResolvePending(
  artworks: CanvasArtwork[],
  pendingId: string | null,
  images: Claude360CanvasImage[]
): CanvasArtwork[] {
  const resolved: CanvasArtwork[] = []
  for (const artwork of artworks) {
    if (artwork.id !== pendingId) {
      resolved.push(artwork)
      continue
    }
    for (const image of images) {
      resolved.push({
        ...artwork,
        id: image.id || nextArtworkId(),
        status: 'success',
        image,
        prompt: image.prompt || artwork.prompt,
        model: image.model || artwork.model,
        n: 1,
        createdAt: image.createdAt || artwork.createdAt
      })
    }
  }
  return resolved.slice(0, CANVAS_HISTORY_LIMIT)
}

/** 把 pending 占位标记为 failed（保留参数快照与错误信息）。 */
export function reduceFailPending(
  artworks: CanvasArtwork[],
  pendingId: string | null,
  message: string
): CanvasArtwork[] {
  return artworks.map((artwork) =>
    artwork.id === pendingId ? { ...artwork, status: 'failed' as const, error: message } : artwork
  )
}

/** 按状态筛选作品（'all' 原样返回）。 */
export function filterArtworks(
  artworks: CanvasArtwork[],
  filter: CanvasArtworkFilter
): CanvasArtwork[] {
  if (filter === 'all') return artworks
  return artworks.filter((artwork) => artwork.status === filter)
}

/** 一张图片是否可用（url 或 b64Json 至少其一）。 */
function isUsableImage(image: unknown): image is Claude360CanvasImage {
  if (!image || typeof image !== 'object') return false
  const img = image as Partial<Claude360CanvasImage>
  if (typeof img.id !== 'string') return false
  return Boolean(img.url) || Boolean(img.b64Json)
}

/** 从持久化恢复时过滤坏条目：仅保留带可用图片的 success 作品。 */
export function sanitizeRehydratedArtworks(artworks: unknown): CanvasArtwork[] {
  if (!Array.isArray(artworks)) return []
  const usable: CanvasArtwork[] = []
  for (const item of artworks) {
    if (!item || typeof item !== 'object') continue
    const artwork = item as Partial<CanvasArtwork>
    if (typeof artwork.id !== 'string' || artwork.status !== 'success') continue
    if (!isUsableImage(artwork.image)) continue
    usable.push({
      id: artwork.id,
      status: 'success',
      image: artwork.image,
      prompt: typeof artwork.prompt === 'string' ? artwork.prompt : '',
      model: typeof artwork.model === 'string' ? artwork.model : '',
      size: typeof artwork.size === 'string' ? artwork.size : '',
      quality: typeof artwork.quality === 'string' ? artwork.quality : '',
      outputFormat: typeof artwork.outputFormat === 'string' ? artwork.outputFormat : '',
      n: 1,
      createdAt: typeof artwork.createdAt === 'string' ? artwork.createdAt : ''
    })
  }
  return usable.slice(0, CANVAS_HISTORY_LIMIT)
}

/**
 * 序列化为持久化用的作品列表：只保留 success 条目、最多 N 条；
 * 超阈值的大 base64 丢弃 b64Json（该条目下次恢复时会被 sanitize 过滤）。
 */
export function serializeArtworksForPersist(artworks: CanvasArtwork[]): CanvasArtwork[] {
  return artworks
    .filter((artwork) => artwork.status === 'success')
    .slice(0, CANVAS_HISTORY_LIMIT)
    .map((artwork) => {
      const image = artwork.image
      if (
        image &&
        image.source === 'base64' &&
        image.b64Json &&
        image.b64Json.length > CANVAS_HISTORY_MAX_BASE64_LENGTH
      ) {
        const { b64Json: _dropped, ...rest } = image
        return { ...artwork, image: rest as Claude360CanvasImage }
      }
      return artwork
    })
}

/** 旧版纯图片历史（Claude360CanvasImage[]）→ success 作品条目（一次性迁移读取）。 */
export function migrateLegacyHistory(history: unknown): CanvasArtwork[] {
  if (!Array.isArray(history)) return []
  return history
    .filter(isUsableImage)
    .slice(0, CANVAS_HISTORY_LIMIT)
    .map((image) => ({
      id: image.id,
      status: 'success' as const,
      image,
      prompt: image.prompt ?? '',
      model: image.model ?? '',
      size: '',
      quality: '',
      outputFormat: '',
      n: 1,
      createdAt: image.createdAt ?? ''
    }))
}

/** 从本地存储读取作品；新键缺失时回退读取旧版历史键做迁移；损坏安全恢复空列表。 */
export function loadPersistedArtworks(): CanvasArtwork[] {
  const raw = readBrowserStorageItem(CANVAS_ARTWORKS_STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { artworks?: unknown }
      return sanitizeRehydratedArtworks(parsed?.artworks)
    } catch {
      return []
    }
  }
  const legacy = readBrowserStorageItem(CANVAS_HISTORY_STORAGE_KEY)
  if (!legacy) return []
  try {
    const parsed = JSON.parse(legacy) as { history?: unknown }
    const migrated = migrateLegacyHistory(parsed?.history)
    // 迁移即落新键并删除旧键：旧键可含 MB 级 base64，残留会挤占 localStorage 配额，
    // 导致后续新作品落盘无声失败（writeBrowserStorageItem 静默吞错）。
    writeBrowserStorageItem(
      CANVAS_ARTWORKS_STORAGE_KEY,
      JSON.stringify({ artworks: serializeArtworksForPersist(migrated) })
    )
    removeBrowserStorageItem(CANVAS_HISTORY_STORAGE_KEY)
    return migrated
  } catch {
    removeBrowserStorageItem(CANVAS_HISTORY_STORAGE_KEY)
    return []
  }
}

/** 落盘：只写限量 success 作品，绝不写入任何 API Key（结构里也没有）。 */
function persistArtworks(artworks: CanvasArtwork[]): void {
  const persisted = serializeArtworksForPersist(artworks)
  writeBrowserStorageItem(CANVAS_ARTWORKS_STORAGE_KEY, JSON.stringify({ artworks: persisted }))
}

/**
 * 创建一个独立的 canvas store 实例。测试用 createCanvasStore() 得到隔离实例；
 * 应用侧用单例 useCanvasStore（自动从本地存储恢复并在作品变更时落盘）。
 */
export function createCanvasStore(
  options: { initialArtworks?: CanvasArtwork[]; persist?: boolean } = {}
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
    pendingArtworkId: null,
    artworks: options.initialArtworks ?? [],
    statusFilter: 'all',
    selectMode: false,
    selectedIds: {},
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
    // 生成中作品立即以 pending 占位出现在宫格头部，完成后原位替换为图片结果。
    beginGenerate: () =>
      set((s) => {
        const pending = pendingArtworkFromForm(s)
        return {
          generating: true,
          error: null,
          pendingArtworkId: pending.id,
          artworks: [pending, ...s.artworks].slice(0, CANVAS_HISTORY_LIMIT)
        }
      }),
    generateSuccess: (images) =>
      set((s) => ({
        generating: false,
        error: null,
        pendingArtworkId: null,
        artworks: reduceResolvePending(s.artworks, s.pendingArtworkId, images)
      })),
    generateFailure: (message) =>
      set((s) => ({
        generating: false,
        pendingArtworkId: null,
        artworks: reduceFailPending(s.artworks, s.pendingArtworkId, message)
      })),
    beginEdit: () =>
      set((s) => {
        // 编辑（图生图）固定回 1 张，占位张数不跟随表单 n。
        const pending = { ...pendingArtworkFromForm(s), n: 1 }
        return {
          editing: true,
          error: null,
          pendingArtworkId: pending.id,
          artworks: [pending, ...s.artworks].slice(0, CANVAS_HISTORY_LIMIT)
        }
      }),
    editSuccess: (images) =>
      set((s) => ({
        editing: false,
        error: null,
        pendingArtworkId: null,
        artworks: reduceResolvePending(s.artworks, s.pendingArtworkId, images)
      })),
    editFailure: (message) =>
      set((s) => ({
        editing: false,
        pendingArtworkId: null,
        artworks: reduceFailPending(s.artworks, s.pendingArtworkId, message)
      })),
    removeArtwork: (id) =>
      set((s) => {
        const { [id]: _removed, ...selectedIds } = s.selectedIds
        return { artworks: s.artworks.filter((artwork) => artwork.id !== id), selectedIds }
      }),
    // 批量删除/清空一律豁免 pending 占位（与单删禁用语义一致）：飞行中批次的
    // 占位被删后，结果回来会因 pendingId 无匹配而被静默丢弃。
    removeSelected: () =>
      set((s) => ({
        artworks: s.artworks.filter(
          (artwork) => artwork.status === 'pending' || !s.selectedIds[artwork.id]
        ),
        selectedIds: {},
        selectMode: false
      })),
    clearArtworks: () =>
      set((s) => ({
        artworks: s.artworks.filter((artwork) => artwork.status === 'pending'),
        selectedIds: {},
        selectMode: false
      })),
    setStatusFilter: (statusFilter) => set({ statusFilter }),
    toggleSelectMode: () =>
      set((s) => ({ selectMode: !s.selectMode, selectedIds: s.selectMode ? {} : s.selectedIds })),
    toggleSelected: (id) =>
      set((s) => {
        if (s.selectedIds[id]) {
          const { [id]: _removed, ...selectedIds } = s.selectedIds
          return { selectedIds }
        }
        return { selectedIds: { ...s.selectedIds, [id]: true } }
      }),
    clearError: () => set({ error: null })
  }))

  if (shouldPersist) {
    store.subscribe((state) => persistArtworks(state.artworks))
  }
  return store
}

/** 应用单例：启动时从本地存储恢复，作品变更自动落盘。 */
export const useCanvasStore = createCanvasStore({
  initialArtworks: loadPersistedArtworks(),
  persist: true
})
