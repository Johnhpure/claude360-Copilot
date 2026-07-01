// Claude360 原生生图工作台共享类型（plan-06 Task 1）。
//
// 跨 main/preload/renderer 复用最小类型集：生图请求、编辑请求、图片结果。
//
// Risk Notes 约束：
// - 图片 API Key 只在 main 进程读取使用，shared 类型里**绝不**出现 API Key。
// - renderer 只拿到展示态结果（url 或 b64Json），不接触任何明文凭据。
// - base64 体积大，历史持久化由 renderer 侧限量（本文件仅定义结构）。

// —— 工作台模式（文本生图 / 单图编辑）——
export type Claude360CanvasMode = 'generate' | 'edit'

// —— 生图尺寸（OpenAI-compatible images；放开为任意 "宽x高" 或 'auto'）——
// 由「宽高比预设 + 分辨率档」派生出具体像素串（见 CLAUDE360_ASPECT_PRESETS）。
export type Claude360ImageSize = `${number}x${number}` | 'auto'

/** 历史遗留的固定尺寸集合（保留向后兼容，不再用于 UI 选择）。 */
export const CLAUDE360_IMAGE_SIZES: readonly Claude360ImageSize[] = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  'auto'
]

// —— 分辨率档（1K/2K/4K）——
export type Claude360ImageResolution = '1K' | '2K' | '4K'
export const CLAUDE360_IMAGE_RESOLUTIONS: readonly Claude360ImageResolution[] = ['1K', '2K', '4K']

// —— 质量档（自动/高/中/低，取值对齐 gpt-image quality）——
export type Claude360ImageQuality = 'auto' | 'high' | 'medium' | 'low'
export const CLAUDE360_IMAGE_QUALITIES: readonly Claude360ImageQuality[] = ['auto', 'high', 'medium', 'low']

// —— 输出格式（png/jpeg/webp）——
export type Claude360ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export const CLAUDE360_IMAGE_OUTPUT_FORMATS: readonly Claude360ImageOutputFormat[] = ['png', 'jpeg', 'webp']

// —— 宽高比预设（严格迁移自 infinite-canvas image-size-presets.ts）——
// 每档含 ratio 标签 + name + 三个分辨率档对应的具体像素串。
export interface Claude360AspectPreset {
  id: string
  ratio: string
  name: string
  sizes: Record<Claude360ImageResolution, string>
}

export const CLAUDE360_ASPECT_PRESETS: readonly Claude360AspectPreset[] = [
  { id: 'square', ratio: '1:1', name: 'Square', sizes: { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' } },
  { id: 'widescreen', ratio: '16:9', name: 'Widescreen', sizes: { '1K': '1280x720', '2K': '2048x1152', '4K': '3840x2160' } },
  { id: 'story', ratio: '9:16', name: 'Story', sizes: { '1K': '720x1280', '2K': '1152x2048', '4K': '2160x3840' } },
  { id: 'print', ratio: '5:4', name: 'Print', sizes: { '1K': '1040x832', '2K': '2080x1664', '4K': '3200x2560' } },
  { id: 'feed', ratio: '4:5', name: 'Feed', sizes: { '1K': '832x1040', '2K': '1664x2080', '4K': '2560x3200' } },
  { id: 'classic', ratio: '4:3', name: 'Classic', sizes: { '1K': '1024x768', '2K': '2048x1536', '4K': '3264x2448' } },
  { id: 'vertical', ratio: '3:4', name: 'Vertical', sizes: { '1K': '768x1024', '2K': '1536x2048', '4K': '2448x3264' } },
  { id: 'photo', ratio: '3:2', name: 'Photo', sizes: { '1K': '1008x672', '2K': '2064x1376', '4K': '3504x2336' } },
  { id: 'portrait', ratio: '2:3', name: 'Portrait', sizes: { '1K': '672x1008', '2K': '1376x2064', '4K': '2336x3504' } },
  { id: 'exclusive', ratio: '21:9', name: 'Exclusive', sizes: { '1K': '1344x576', '2K': '2016x864', '4K': '3808x1632' } }
]

// —— 参数默认值 ——
export const CLAUDE360_DEFAULT_ASPECT = 'square'
export const CLAUDE360_DEFAULT_RESOLUTION: Claude360ImageResolution = '2K'
export const CLAUDE360_DEFAULT_QUALITY: Claude360ImageQuality = 'auto'
export const CLAUDE360_DEFAULT_OUTPUT_FORMAT: Claude360ImageOutputFormat = 'png'

/** 由宽高比预设 id + 分辨率档解析出具体像素串；未知 preset 回退首档。 */
export function resolveImageSizeValue(presetId: string, resolution: Claude360ImageResolution): Claude360ImageSize {
  const preset = CLAUDE360_ASPECT_PRESETS.find((p) => p.id === presetId) ?? CLAUDE360_ASPECT_PRESETS[0]
  return preset.sizes[resolution] as Claude360ImageSize
}

// —— 归一化后的单张图片结果（url 与 base64 两类归一）——
// source='url'：保留 url，供复制 URL / 展示；
// source='base64'：保留 b64Json（不含 data: 前缀），供下载 / 复制图片。
export interface Claude360CanvasImage {
  id: string
  source: 'url' | 'base64'
  url?: string
  b64Json?: string
  mimeType: string
  prompt: string
  model: string
  createdAt: string
}

// —— 文本生图请求体（JSON POST /v1/images/generations）——
// n：一次生成张数；size：派生像素串；quality/output_format：可选高级参数。
export interface Claude360ImageGeneratePayload {
  model: string
  prompt: string
  size?: Claude360ImageSize
  n?: number
  quality?: Claude360ImageQuality
  output_format?: Claude360ImageOutputFormat
}

// —— 单图编辑请求体（multipart POST /v1/images/edits）——
// image：源图 / 参考图，接受纯 base64 或 dataURL 字符串（main 侧统一解码为 Blob）。
// mask：可选蒙版（参考图场景不传）。size/quality/output_format：可选，随参考图(图生图)一并透传。
export interface Claude360ImageEditPayload {
  model: string
  prompt: string
  image: string
  mask?: string
  size?: Claude360ImageSize
  quality?: Claude360ImageQuality
  output_format?: Claude360ImageOutputFormat
}

// —— main → renderer 的生图/编辑结果（不含 API Key）——
export type Claude360ImageResult =
  | { ok: true; images: Claude360CanvasImage[] }
  | { ok: false; message: string; retryable?: boolean }
