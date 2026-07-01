// 生图结果工具（plan-06 Task 4）。
//
// 归一化 main → renderer 的图片结果，供 UI 展示 / 复制 / 下载：
// - base64 结果拼成 data URL（renderer 直接展示 / 下载）；
// - url 结果保留 http(s) 链接（可复制 URL / 展示）；
// - 从 prompt/model/date 生成安全文件名（清洗非法字符）。
// Risk Notes：本文件不接触任何 API Key；仅处理展示态数据。
import type { Claude360CanvasImage } from '@shared/claude360-canvas'

/** 从 mimeType 推断下载扩展名（默认 png）。 */
function extensionForMime(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'png'
}

/** 仅允许 http(s) 链接，纵深防御（拒绝 javascript: / data: 等）。 */
function isSafeHttpUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 返回可直接用于 <img src> 的地址：
 * - base64 → data:<mime>;base64,<payload>
 * - url    → 原始 http(s) 链接
 * 损坏 / 缺失数据安全返回空串（不抛异常）。
 */
export function imageDataUrl(image: Claude360CanvasImage): string {
  if (image.source === 'base64') {
    if (!image.b64Json) return ''
    const mime = image.mimeType || 'image/png'
    return `data:${mime};base64,${image.b64Json}`
  }
  return isSafeHttpUrl(image.url) ? image.url : ''
}

/** 仅 url 图片可复制链接；base64 / 非法链接返回空串。 */
export function imageCopyUrl(image: Claude360CanvasImage): string {
  if (image.source !== 'url') return ''
  return isSafeHttpUrl(image.url) ? image.url : ''
}

/** 是否可下载：base64 有载荷，或 url 为合法 http(s)。 */
export function isDownloadableImage(image: Claude360CanvasImage): boolean {
  if (image.source === 'base64') return Boolean(image.b64Json)
  return isSafeHttpUrl(image.url)
}

type FilenameInput = Pick<Claude360CanvasImage, 'prompt' | 'model' | 'createdAt' | 'mimeType'>

/** 把 ISO 时间归一为 YYYYMMDDHHmmss；损坏时用当前时间兜底。 */
function compactTimestamp(createdAt: string): string {
  const date = new Date(createdAt)
  const valid = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${valid.getFullYear()}${pad(valid.getMonth() + 1)}${pad(valid.getDate())}` +
    `${pad(valid.getHours())}${pad(valid.getMinutes())}${pad(valid.getSeconds())}`
  )
}

/** 清洗文件名分段：去非法字符、折叠空白、限长。 */
function sanitizeSegment(value: string, maxLen: number): string {
  return (value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen)
}

/**
 * 从 prompt/model/date 生成安全下载文件名，例如：
 *   claude360-<model>-<promptSlug>-<timestamp>.<ext>
 * 空 prompt / 损坏日期均安全兜底，永远带扩展名。
 */
export function safeImageFilename(input: FilenameInput): string {
  const ext = extensionForMime(input.mimeType)
  const promptSlug = sanitizeSegment(input.prompt, 40) || 'image'
  const modelSlug = sanitizeSegment(input.model, 24)
  const ts = compactTimestamp(input.createdAt)
  const parts = ['claude360', modelSlug, promptSlug, ts].filter(Boolean)
  return `${parts.join('-')}.${ext}`
}
