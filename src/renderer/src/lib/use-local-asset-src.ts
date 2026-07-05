// 本地资产 → 可展示 src 的加载工具（07-05 media-assets-persistence）。
//
// 图片 / 封面走 dataURL；结果按 workspace+相对路径做模块级缓存，避免同一文件
// 反复 IPC。本地读取失败静默回退 fallback（远程 URL / 空串），UI 不因此报错。
import { useEffect, useState } from 'react'

type ReadBlobApi = (payload: {
  workspaceRoot: string
  relativePath: string
}) => Promise<{ ok: true; base64: string; mimeType: string } | { ok: false; message: string }>

const dataUrlCache = new Map<string, string>()
/** 读取失败的路径集合：避免每次渲染重复请求已知缺失的文件。 */
const failedKeys = new Set<string>()
/** LRU 上限（审查 Important 5）：原图 dataURL 体积大，必须限量防内存常驻膨胀。 */
const MAX_CACHE_ENTRIES = 64
const MAX_CACHE_BYTES = 128 * 1024 * 1024
let cacheBytes = 0

function cacheKey(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot}::${relativePath}`
}

/** Map 迭代序即插入序：读命中时重插以更新新鲜度，超限从最旧端逐出。 */
function touchCacheEntry(key: string, dataUrl: string): void {
  const existing = dataUrlCache.get(key)
  if (existing !== undefined) {
    dataUrlCache.delete(key)
    dataUrlCache.set(key, existing)
    return
  }
  dataUrlCache.set(key, dataUrl)
  cacheBytes += dataUrl.length
  while (dataUrlCache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = dataUrlCache.keys().next().value
    if (oldest === undefined) break
    cacheBytes -= dataUrlCache.get(oldest)?.length ?? 0
    dataUrlCache.delete(oldest)
  }
}

/** 清空缓存（测试用；不同工作空间的键天然隔离，由 LRU 上限约束总量）。 */
export function clearLocalAssetCache(): void {
  dataUrlCache.clear()
  failedKeys.clear()
  cacheBytes = 0
}

/** 读取本地资产为 dataURL（带缓存）；失败返回 null。 */
export async function readLocalAssetDataUrl(
  workspaceRoot: string,
  relativePath: string,
  api?: ReadBlobApi
): Promise<string | null> {
  const root = workspaceRoot.trim()
  const path = relativePath.trim()
  if (!root || !path) return null
  const key = cacheKey(root, path)
  const cached = dataUrlCache.get(key)
  if (cached) {
    touchCacheEntry(key, cached)
    return cached
  }
  if (failedKeys.has(key)) return null
  const readBlob = api ?? (typeof window !== 'undefined' ? window.kunGui?.mediaAssetsReadBlob : undefined)
  if (!readBlob) return null
  try {
    const result = await readBlob({ workspaceRoot: root, relativePath: path })
    if (!result.ok) {
      failedKeys.add(key)
      return null
    }
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`
    touchCacheEntry(key, dataUrl)
    return dataUrl
  } catch {
    failedKeys.add(key)
    return null
  }
}

/**
 * 本地优先的展示 src：localPath 可读时返回本地 dataURL，否则回退 fallback
 * （通常是远程 URL 或现有 imageDataUrl 结果）。
 */
export function useLocalAssetSrc(
  workspaceRoot: string | undefined,
  relativePath: string | undefined,
  fallback: string | null
): string | null {
  const [localSrc, setLocalSrc] = useState<string | null>(() =>
    workspaceRoot && relativePath ? dataUrlCache.get(cacheKey(workspaceRoot.trim(), relativePath.trim())) ?? null : null
  )
  useEffect(() => {
    let alive = true
    if (!workspaceRoot || !relativePath) {
      setLocalSrc(null)
      return
    }
    void readLocalAssetDataUrl(workspaceRoot, relativePath).then((dataUrl) => {
      if (alive) setLocalSrc(dataUrl)
    })
    return () => {
      alive = false
    }
  }, [workspaceRoot, relativePath])
  return localSrc ?? fallback
}
