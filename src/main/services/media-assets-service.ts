import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'
import type {
  ImageAssetRecord,
  MediaAssetsDeletePayload,
  MediaAssetsDeleteResult,
  MediaAssetsListPayload,
  MediaAssetsListResult,
  MediaAssetsReadBlobPayload,
  MediaAssetsReadBlobResult,
  MediaAssetsSaveImagePayload,
  MediaAssetsSaveImageResult,
  MediaAssetsSaveMusicPayload,
  MediaAssetsSaveMusicResult,
  MusicAssetRecord
} from '../../shared/media-assets'
import { canonicalPath, expandHomePath } from './workspace-paths'

/**
 * 生图 / 音乐资产本地持久化服务（07-05 media-assets-persistence）。
 *
 * - 目录约定：<workspace>/assets/{images,music,covers,metadata}/，懒创建。
 * - metadata：assets/metadata/images.json / music.json，格式 { version, items }；
 *   读损坏 → 备份 .bak 后重建空表；写原子（tmp + rename）；同 workspace 写操作
 *   经 promise 链串行化，避免并发覆盖。
 * - 下载失败不吞错也不阻断：记录落为 status='failed' 并保留 remoteUrl，
 *   renderer 仍可走远程回退展示。
 * - 路径安全：readAssetBlob / 删除只接受 assets/ 开头的相对路径，规范化后必须
 *   仍落在 workspace assets 目录内（防目录穿越）；对存在的目标还会做 realpath
 *   边界校验，assets/ 内指向工作区外的 symlink（含父目录为链接）一律拒绝跟随。
 */

const METADATA_VERSION = 1
const DOWNLOAD_TIMEOUT_MS = 60_000
/** 单文件下载上限（音频/图片同限，约 64MB，防异常超大响应打爆磁盘/内存）。 */
const MAX_ASSET_BYTES = 64 * 1024 * 1024

export const MEDIA_ASSET_DIRS = {
  images: 'assets/images',
  music: 'assets/music',
  covers: 'assets/covers',
  metadata: 'assets/metadata'
} as const

type MetadataFile<T> = { version: number; items: T[] }

export type MediaAssetsServiceDeps = {
  /** 下载器注入（单测替换）；默认全局 fetch。 */
  fetchImpl?: typeof fetch
  log?: (message: string) => void
}

function extFromMime(mimeType: string | undefined, fallback: string): string {
  const mime = (mimeType ?? '').toLowerCase()
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  return fallback
}

function mimeFromRelativePath(relativePath: string): string {
  const lower = relativePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4'
  return 'application/octet-stream'
}

/** 文件名安全化：仅保留常见安全字符，防止 id 里混入路径分隔符。 */
function safeFileToken(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'asset'
}

export class MediaAssetsService {
  private readonly fetchImpl: typeof fetch
  private readonly log: (message: string) => void
  /** 按 workspace 串行化 metadata 写操作的 promise 链。 */
  private writeChains = new Map<string, Promise<unknown>>()

  constructor(deps: MediaAssetsServiceDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.log = deps.log ?? ((message) => console.info(message))
  }

  // —— 路径解析 ——

  private async workspacePath(workspaceRoot: string): Promise<string> {
    const raw = workspaceRoot.trim()
    if (!raw) throw new Error('Workspace root is required.')
    return canonicalPath(resolve(expandHomePath(raw)))
  }

  /** 校验 assets 相对路径并解析为绝对路径（防目录穿越）。 */
  private async resolveAssetAbsolutePath(
    workspaceRoot: string,
    relativePath: string
  ): Promise<{ workspace: string; absolute: string }> {
    const normalized = posix.normalize(relativePath.replaceAll('\\', '/'))
    if (!normalized.startsWith('assets/') || normalized.includes('..')) {
      throw new Error('Asset path must stay within the workspace assets directory.')
    }
    const workspace = await this.workspacePath(workspaceRoot)
    return { workspace, absolute: join(workspace, normalized) }
  }

  /**
   * 对「存在的」目标做 realpath 边界校验（审查 C2）：目标（或其任一父段）可能是
   * 指向工作区外的 symlink，字符串前缀校验挡不住；真实路径必须仍在
   * <workspace>/assets/ 内。用 path.relative 判定，排除 `assets2` 这类前缀误判。
   */
  private async verifyRealPathInsideAssets(workspace: string, absolute: string): Promise<string> {
    const assetsRoot = await realpath(join(workspace, 'assets'))
    const assetsRootRel = relative(workspace, assetsRoot)
    if (assetsRootRel === '' || assetsRootRel.startsWith('..') || isAbsolute(assetsRootRel)) {
      throw new Error('Asset root escapes the selected workspace.')
    }
    const real = await realpath(absolute)
    const rel = relative(assetsRoot, real)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Asset path escapes the workspace assets directory.')
    }
    return real
  }

  private async ensureDir(workspace: string, relativeDir: string): Promise<string> {
    const dir = join(workspace, relativeDir)
    await mkdir(dir, { recursive: true })
    return dir
  }

  // —— metadata 读写 ——

  private metadataPath(workspace: string, kind: 'images' | 'music'): string {
    return join(workspace, MEDIA_ASSET_DIRS.metadata, `${kind}.json`)
  }

  private async readMetadata<T>(workspace: string, kind: 'images' | 'music'): Promise<T[]> {
    const file = this.metadataPath(workspace, kind)
    if (!existsSync(file)) return []
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as MetadataFile<T>
      return Array.isArray(parsed?.items) ? parsed.items : []
    } catch (error) {
      // 损坏容错：备份后重建空表，不让单个坏文件拖垮整个资产列表。
      const backup = `${file}.bak`
      try {
        await rename(file, backup)
      } catch {
        /* 备份失败也继续（下次写入会覆盖坏文件） */
      }
      this.log(
        `[media-assets] ${kind}.json 损坏(${error instanceof Error ? error.message : String(error)})，已备份为 .bak 并重建`
      )
      return []
    }
  }

  private async writeMetadataAtomic<T>(workspace: string, kind: 'images' | 'music', items: T[]): Promise<void> {
    await this.ensureDir(workspace, MEDIA_ASSET_DIRS.metadata)
    const file = this.metadataPath(workspace, kind)
    const tmp = `${file}.tmp`
    const body: MetadataFile<T> = { version: METADATA_VERSION, items }
    await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
    await rename(tmp, file)
  }

  /** 同 workspace 的 metadata 变更串行执行（读-改-写不被并发交错）。 */
  private enqueueWrite<R>(workspace: string, task: () => Promise<R>): Promise<R> {
    const prev = this.writeChains.get(workspace) ?? Promise.resolve()
    const next = prev.then(task, task)
    // 链尾 settled 且没有新任务接续时移除（审查 M1）：多 workspace 长期运行下
    // Map 不随空闲链累积。tail 吞掉错误（错误由本次调用方的 next 处理）。
    const tail = next.then(
      () => undefined,
      () => undefined
    ).finally(() => {
      if (this.writeChains.get(workspace) === tail) this.writeChains.delete(workspace)
    })
    this.writeChains.set(workspace, tail)
    return next
  }

  private async upsertRecord<T extends { id: string }>(
    workspace: string,
    kind: 'images' | 'music',
    record: T
  ): Promise<void> {
    await this.enqueueWrite(workspace, async () => {
      const items = await this.readMetadata<T>(workspace, kind)
      const index = items.findIndex((item) => item.id === record.id)
      if (index >= 0) items[index] = record
      else items.unshift(record)
      await this.writeMetadataAtomic(workspace, kind, items)
    })
  }

  // —— 下载 ——

  private async downloadToBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`)
      // 上限前置（审查 I5）：Content-Length 声明超限直接拒绝，不进内存。
      const declared = Number(res.headers.get('content-length') ?? '')
      if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
        controller.abort()
        throw new Error(`asset too large (${declared} bytes)`)
      }
      const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
      // 流式累计：读取过程中超限立即中止，避免异常大响应先占满主进程内存。
      if (res.body) {
        const reader = res.body.getReader()
        const chunks: Buffer[] = []
        let total = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > MAX_ASSET_BYTES) {
            controller.abort()
            throw new Error(`asset too large (${total} bytes)`)
          }
          chunks.push(Buffer.from(value))
        }
        return { buffer: Buffer.concat(chunks), mimeType }
      }
      // 无 body 流实现（测试注入的简化 fetch）：退回一次性读取 + 上限校验。
      const array = await res.arrayBuffer()
      if (array.byteLength > MAX_ASSET_BYTES) {
        throw new Error(`asset too large (${array.byteLength} bytes)`)
      }
      return { buffer: Buffer.from(array), mimeType }
    } finally {
      clearTimeout(timer)
    }
  }

  // —— 图片保存 ——

  async saveImageAsset(payload: MediaAssetsSaveImagePayload): Promise<MediaAssetsSaveImageResult> {
    try {
      const workspace = await this.workspacePath(payload.workspaceRoot)
      const record: ImageAssetRecord = { ...payload.record, status: 'pending' }
      let buffer: Buffer
      let mimeType: string
      if ('url' in payload.source) {
        record.remoteUrl = payload.source.url
        try {
          const downloaded = await this.downloadToBuffer(payload.source.url)
          buffer = downloaded.buffer
          mimeType = downloaded.mimeType || `image/${payload.record.format ?? 'png'}`
        } catch (error) {
          // 下载失败：记录 failed + 保留 remoteUrl，renderer 走远程回退展示。
          const failed: ImageAssetRecord = { ...record, status: 'failed' }
          await this.upsertRecord(workspace, 'images', failed)
          this.log(
            `[media-assets] 图片下载失败 id=${record.id}: ${error instanceof Error ? error.message : String(error)}`
          )
          return { ok: true, record: failed }
        }
      } else {
        buffer = Buffer.from(payload.source.b64, 'base64')
        mimeType = payload.source.mimeType
      }
      await this.ensureDir(workspace, MEDIA_ASSET_DIRS.images)
      const ext = extFromMime(mimeType, payload.record.format ?? 'png')
      const fileName = `${Date.now().toString(36)}-${safeFileToken(record.id)}.${ext}`
      const localPath = posix.join(MEDIA_ASSET_DIRS.images, fileName)
      await writeFile(join(workspace, localPath), buffer)
      const completed: ImageAssetRecord = { ...record, status: 'completed', localPath, mimeType }
      await this.upsertRecord(workspace, 'images', completed)
      return { ok: true, record: completed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`[media-assets] saveImageAsset failed: ${message}`)
      return { ok: false, message }
    }
  }

  // —— 音乐保存（音频 + 可选封面）——

  async saveMusicAsset(payload: MediaAssetsSaveMusicPayload): Promise<MediaAssetsSaveMusicResult> {
    try {
      const workspace = await this.workspacePath(payload.workspaceRoot)
      const record: MusicAssetRecord = {
        ...payload.record,
        status: 'pending',
        remoteAudioUrl: payload.audioUrl,
        ...(payload.coverUrl ? { remoteCoverUrl: payload.coverUrl } : {})
      }
      // 音频是主体：下载失败 → failed（保留远程回退）；封面失败仅告警不影响状态。
      let audioLocalPath: string | undefined
      try {
        const audio = await this.downloadToBuffer(payload.audioUrl)
        await this.ensureDir(workspace, MEDIA_ASSET_DIRS.music)
        const ext = extFromMime(audio.mimeType, 'mp3')
        const fileName = `${Date.now().toString(36)}-${safeFileToken(record.id)}.${ext}`
        audioLocalPath = posix.join(MEDIA_ASSET_DIRS.music, fileName)
        await writeFile(join(workspace, audioLocalPath), audio.buffer)
      } catch (error) {
        const failed: MusicAssetRecord = { ...record, status: 'failed' }
        await this.upsertRecord(workspace, 'music', failed)
        this.log(
          `[media-assets] 音频下载失败 id=${record.id}: ${error instanceof Error ? error.message : String(error)}`
        )
        return { ok: true, record: failed }
      }
      let coverLocalPath: string | undefined
      if (payload.coverUrl) {
        try {
          const cover = await this.downloadToBuffer(payload.coverUrl)
          await this.ensureDir(workspace, MEDIA_ASSET_DIRS.covers)
          const ext = extFromMime(cover.mimeType, 'jpg')
          const fileName = `${Date.now().toString(36)}-${safeFileToken(record.id)}.${ext}`
          coverLocalPath = posix.join(MEDIA_ASSET_DIRS.covers, fileName)
          await writeFile(join(workspace, coverLocalPath), cover.buffer)
        } catch (error) {
          this.log(
            `[media-assets] 封面下载失败 id=${record.id}（不影响音频）: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      const completed: MusicAssetRecord = {
        ...record,
        status: 'completed',
        localAudioPath: audioLocalPath,
        ...(coverLocalPath ? { localCoverPath: coverLocalPath } : {})
      }
      await this.upsertRecord(workspace, 'music', completed)
      return { ok: true, record: completed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`[media-assets] saveMusicAsset failed: ${message}`)
      return { ok: false, message }
    }
  }

  // —— 列出（启动 / 切工作空间恢复；逐条标注本地文件缺失）——

  async listAssets(payload: MediaAssetsListPayload): Promise<MediaAssetsListResult> {
    try {
      const workspace = await this.workspacePath(payload.workspaceRoot)
      const images = await this.readMetadata<ImageAssetRecord>(workspace, 'images')
      const music = await this.readMetadata<MusicAssetRecord>(workspace, 'music')
      return {
        ok: true,
        images: images.map((record) => ({
          ...record,
          ...(record.localPath && !existsSync(join(workspace, record.localPath))
            ? { fileMissing: true }
            : {})
        })),
        music: music.map((record) => ({
          ...record,
          ...(record.localAudioPath && !existsSync(join(workspace, record.localAudioPath))
            ? { audioMissing: true }
            : {}),
          ...(record.localCoverPath && !existsSync(join(workspace, record.localCoverPath))
            ? { coverMissing: true }
            : {})
        }))
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // —— 读取本地资产（img src / audio 播放；base64 IPC 与现有 media-blob 模式一致）——

  async readAssetBlob(payload: MediaAssetsReadBlobPayload): Promise<MediaAssetsReadBlobResult> {
    try {
      const { workspace, absolute } = await this.resolveAssetAbsolutePath(
        payload.workspaceRoot,
        payload.relativePath
      )
      // 存在性与 symlink 边界一并由 realpath 校验：不存在 → ENOENT → ok:false；
      // 指向工作区外 → 拒绝，不读取任何外部内容。
      const real = await this.verifyRealPathInsideAssets(workspace, absolute)
      const buffer = await readFile(real)
      return {
        ok: true,
        base64: buffer.toString('base64'),
        mimeType: mimeFromRelativePath(payload.relativePath)
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // —— 删除（metadata 必删；可选删除本地文件，ENOENT 容忍）——

  async deleteAssets(payload: MediaAssetsDeletePayload): Promise<MediaAssetsDeleteResult> {
    try {
      const workspace = await this.workspacePath(payload.workspaceRoot)
      const kind = payload.kind === 'image' ? 'images' : 'music'
      const ids = new Set(payload.ids)
      let removedPaths: string[] = []
      const removed = await this.enqueueWrite(workspace, async () => {
        if (kind === 'images') {
          const items = await this.readMetadata<ImageAssetRecord>(workspace, 'images')
          const keep = items.filter((item) => !ids.has(item.id))
          removedPaths = items
            .filter((item) => ids.has(item.id) && item.localPath)
            .map((item) => item.localPath as string)
          await this.writeMetadataAtomic(workspace, 'images', keep)
          return items.length - keep.length
        }
        const items = await this.readMetadata<MusicAssetRecord>(workspace, 'music')
        const keep = items.filter((item) => !ids.has(item.id))
        removedPaths = items
          .filter((item) => ids.has(item.id))
          .flatMap((item) => [item.localAudioPath, item.localCoverPath])
          .filter((p): p is string => Boolean(p))
        await this.writeMetadataAtomic(workspace, 'music', keep)
        return items.length - keep.length
      })
      if (payload.deleteFiles) {
        for (const relativePath of removedPaths) {
          try {
            const { absolute } = await this.resolveAssetAbsolutePath(payload.workspaceRoot, relativePath)
            if (existsSync(absolute)) {
              // 目标存在（含跟随 symlink 后存在）：先做 realpath 边界校验再删，
              // 防父目录/自身为指向工作区外的链接时误删外部文件。
              await this.verifyRealPathInsideAssets(workspace, absolute)
            }
            // 不存在（含悬空链接）：保持 force 容错语义；rm 不跟随 symlink，
            // 删除的是 assets 内的条目本身。
            await rm(absolute, { force: true })
          } catch (error) {
            this.log(
              `[media-assets] 删除文件失败 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }
      }
      return { ok: true, removed }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
