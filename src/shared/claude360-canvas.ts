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

// —— 生图尺寸（OpenAI-compatible images 允许集合）——
export type Claude360ImageSize = '1024x1024' | '1024x1536' | '1536x1024' | 'auto'

/** 运行期尺寸枚举清单（供 schema 与 renderer 复用，顺序即展示顺序）。 */
export const CLAUDE360_IMAGE_SIZES: readonly Claude360ImageSize[] = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  'auto'
]

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
// n：一次生成张数；size：允许集合；prompt/model 必填。
export interface Claude360ImageGeneratePayload {
  model: string
  prompt: string
  size?: Claude360ImageSize
  n?: number
}

// —— 单图编辑请求体（multipart POST /v1/images/edits）——
// image：源图，接受纯 base64 或 dataURL 字符串（main 侧统一解码为 Blob）。
// mask：可选蒙版，同 image 编码。size：可选尺寸。
export interface Claude360ImageEditPayload {
  model: string
  prompt: string
  image: string
  mask?: string
  size?: Claude360ImageSize
}

// —— main → renderer 的生图/编辑结果（不含 API Key）——
export type Claude360ImageResult =
  | { ok: true; images: Claude360CanvasImage[] }
  | { ok: false; message: string; retryable?: boolean }
