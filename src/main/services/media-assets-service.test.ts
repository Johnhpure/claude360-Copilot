import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaAssetsService } from './media-assets-service'

// tmp workspace 集成测：写→列→读→删全链路 + 损坏容错 + 路径穿越拒绝。
let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'media-assets-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function pngResponse(bytes: number[] = [0x89, 0x50, 0x4e, 0x47]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  })
}

function mp3Response(): Response {
  return new Response(new Uint8Array([0x49, 0x44, 0x33]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' }
  })
}

const silentLog = (): void => undefined

describe('MediaAssetsService images', () => {
  it('saves a base64 image to assets/images and appends metadata', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const result = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-1', prompt: 'a cat', model: 'gpt-image', createdAt: '2026-07-05T00:00:00Z' },
      source: { b64: Buffer.from('fake-png').toString('base64'), mimeType: 'image/png' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.status).toBe('completed')
    expect(result.record.localPath).toMatch(/^assets\/images\/.+\.png$/)
    expect(existsSync(join(workspace, result.record.localPath as string))).toBe(true)
    const metadata = JSON.parse(await readFile(join(workspace, 'assets/metadata/images.json'), 'utf8'))
    expect(metadata.items).toHaveLength(1)
    expect(metadata.items[0].id).toBe('img-1')
  })

  it('downloads a url image via injected fetch', async () => {
    const fetchImpl = vi.fn(async () => pngResponse())
    const service = new MediaAssetsService({ fetchImpl: fetchImpl as unknown as typeof fetch, log: silentLog })
    const result = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-2', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { url: 'https://cdn.example.com/a.png' }
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.localPath).toBeDefined()
    expect(result.record.remoteUrl).toBe('https://cdn.example.com/a.png')
  })

  it('records failed status (keeping remoteUrl fallback) when the download fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }))
    const service = new MediaAssetsService({ fetchImpl: fetchImpl as unknown as typeof fetch, log: silentLog })
    const result = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-3', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { url: 'https://cdn.example.com/gone.png' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.status).toBe('failed')
    expect(result.record.localPath).toBeUndefined()
    expect(result.record.remoteUrl).toBe('https://cdn.example.com/gone.png')
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images[0]?.status).toBe('failed')
  })

  it('upserts by id instead of duplicating records', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const source = { b64: Buffer.from('x').toString('base64'), mimeType: 'image/png' }
    await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'same', prompt: 'v1', model: 'm', createdAt: 'now' },
      source
    })
    await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'same', prompt: 'v2', model: 'm', createdAt: 'now' },
      source
    })
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images).toHaveLength(1)
    expect(list.ok && list.images[0]?.prompt).toBe('v2')
  })
})

describe('MediaAssetsService music', () => {
  it('saves audio + cover and appends metadata', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('cover') ? pngResponse() : mp3Response()
    )
    const service = new MediaAssetsService({ fetchImpl: fetchImpl as unknown as typeof fetch, log: silentLog })
    const result = await service.saveMusicAsset({
      workspaceRoot: workspace,
      record: { id: 'song-1', title: '夏夜', createdAt: 'now', lyrics: '词' },
      audioUrl: 'https://cdn.example.com/a.mp3',
      coverUrl: 'https://cdn.example.com/cover.jpg'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.status).toBe('completed')
    expect(result.record.localAudioPath).toMatch(/^assets\/music\/.+\.mp3$/)
    expect(result.record.localCoverPath).toMatch(/^assets\/covers\//)
    expect(existsSync(join(workspace, result.record.localAudioPath as string))).toBe(true)
  })

  it('keeps completed status when only the cover download fails', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('cover') ? new Response('x', { status: 500 }) : mp3Response()
    )
    const service = new MediaAssetsService({ fetchImpl: fetchImpl as unknown as typeof fetch, log: silentLog })
    const result = await service.saveMusicAsset({
      workspaceRoot: workspace,
      record: { id: 'song-2', title: 't', createdAt: 'now' },
      audioUrl: 'https://cdn.example.com/a.mp3',
      coverUrl: 'https://cdn.example.com/cover.jpg'
    })
    expect(result.ok && result.record.status).toBe('completed')
    expect(result.ok && result.record.localCoverPath).toBeUndefined()
  })
})

describe('MediaAssetsService list / read / delete', () => {
  it('flags fileMissing when the local file was removed manually', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const saved = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-m', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { b64: Buffer.from('x').toString('base64'), mimeType: 'image/png' }
    })
    if (!saved.ok || !saved.record.localPath) throw new Error('save failed')
    await rm(join(workspace, saved.record.localPath))
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images[0]?.fileMissing).toBe(true)
  })

  it('reads a saved asset back as base64 with the right mime', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const saved = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-r', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { b64: Buffer.from('content').toString('base64'), mimeType: 'image/png' }
    })
    if (!saved.ok || !saved.record.localPath) throw new Error('save failed')
    const blob = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: saved.record.localPath })
    expect(blob.ok).toBe(true)
    if (!blob.ok) return
    expect(Buffer.from(blob.base64, 'base64').toString()).toBe('content')
    expect(blob.mimeType).toBe('image/png')
  })

  it('rejects path traversal outside assets/', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const escape = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: 'assets/../../etc/passwd' })
    expect(escape.ok).toBe(false)
    const absolute = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: '/etc/passwd' })
    expect(absolute.ok).toBe(false)
  })

  it('deletes metadata records and optionally local files', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const saved = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-d', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { b64: Buffer.from('x').toString('base64'), mimeType: 'image/png' }
    })
    if (!saved.ok || !saved.record.localPath) throw new Error('save failed')
    const localPath = saved.record.localPath
    const result = await service.deleteAssets({
      workspaceRoot: workspace,
      kind: 'image',
      ids: ['img-d'],
      deleteFiles: true
    })
    expect(result.ok && result.removed).toBe(1)
    expect(existsSync(join(workspace, localPath))).toBe(false)
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images).toHaveLength(0)
  })

  it('recovers from a corrupted metadata file by backing it up', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-c', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { b64: Buffer.from('x').toString('base64'), mimeType: 'image/png' }
    })
    await writeFile(join(workspace, 'assets/metadata/images.json'), '{not-json', 'utf8')
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images).toHaveLength(0)
    const files = await readdir(join(workspace, 'assets/metadata'))
    expect(files.some((name) => name.endsWith('.bak'))).toBe(true)
  })

  it('returns empty lists for a fresh workspace without creating directories', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images).toHaveLength(0)
    expect(list.ok && list.music).toHaveLength(0)
    expect(existsSync(join(workspace, 'assets'))).toBe(false)
  })
})

describe('MediaAssetsService symlink boundary (review C2)', () => {
  let outside: string

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), 'media-assets-outside-'))
  })

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true })
  })

  it('refuses to read through a symlink that points outside the workspace', async () => {
    const secret = join(outside, 'secret.txt')
    await writeFile(secret, 'top-secret', 'utf8')
    await mkdir(join(workspace, 'assets/images'), { recursive: true })
    await symlink(secret, join(workspace, 'assets/images/link.png'))
    const service = new MediaAssetsService({ log: silentLog })
    const blob = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: 'assets/images/link.png' })
    expect(blob.ok).toBe(false)
  })

  it('refuses to read when a parent directory is a symlink escaping the workspace', async () => {
    await writeFile(join(outside, 'file.png'), 'outside-bytes', 'utf8')
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await symlink(outside, join(workspace, 'assets/images'))
    const service = new MediaAssetsService({ log: silentLog })
    const blob = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: 'assets/images/file.png' })
    expect(blob.ok).toBe(false)
  })

  it('refuses to read when the assets root itself is a symlink escaping the workspace', async () => {
    await mkdir(join(outside, 'images'), { recursive: true })
    await writeFile(join(outside, 'images/file.png'), 'outside-bytes', 'utf8')
    await symlink(outside, join(workspace, 'assets'))
    const service = new MediaAssetsService({ log: silentLog })
    const blob = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: 'assets/images/file.png' })
    expect(blob.ok).toBe(false)
  })

  it('does not delete the external target behind an escaping symlink', async () => {
    const external = join(outside, 'keep-me.png')
    await writeFile(external, 'precious', 'utf8')
    const service = new MediaAssetsService({ log: silentLog })
    const saved = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-link', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { b64: Buffer.from('x').toString('base64'), mimeType: 'image/png' }
    })
    if (!saved.ok || !saved.record.localPath) throw new Error('save failed')
    // 把落盘文件替换为指向外部文件的链接，再带 deleteFiles 删除。
    await rm(join(workspace, saved.record.localPath))
    await symlink(external, join(workspace, saved.record.localPath))
    const result = await service.deleteAssets({
      workspaceRoot: workspace,
      kind: 'image',
      ids: ['img-link'],
      deleteFiles: true
    })
    expect(result.ok && result.removed).toBe(1)
    // 外部目标必须原样保留；metadata 记录仍被删除。
    expect(existsSync(external)).toBe(true)
    const list = await service.listAssets({ workspaceRoot: workspace })
    expect(list.ok && list.images).toHaveLength(0)
  })

  it('still reads regular files inside assets/ after the boundary hardening', async () => {
    const service = new MediaAssetsService({ log: silentLog })
    const saved = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-ok', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { b64: Buffer.from('legit').toString('base64'), mimeType: 'image/png' }
    })
    if (!saved.ok || !saved.record.localPath) throw new Error('save failed')
    const blob = await service.readAssetBlob({ workspaceRoot: workspace, relativePath: saved.record.localPath })
    expect(blob.ok).toBe(true)
    if (!blob.ok) return
    expect(Buffer.from(blob.base64, 'base64').toString()).toBe('legit')
  })
})

describe('MediaAssetsService download size limit (review I5)', () => {
  const LIMIT = 64 * 1024 * 1024

  it('rejects by Content-Length before reading the body', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4))
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(LIMIT + 1), 'content-type': 'image/png' }),
      body: null,
      arrayBuffer
    }))
    const service = new MediaAssetsService({ fetchImpl: fetchImpl as unknown as typeof fetch, log: silentLog })
    const result = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-big', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { url: 'https://cdn.example.com/huge.png' }
    })
    expect(result.ok && result.record.status).toBe('failed')
    expect(result.ok && result.record.remoteUrl).toBe('https://cdn.example.com/huge.png')
    // 声明超限时不应再读取响应体。
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('aborts a streaming body once the accumulated size exceeds the limit', async () => {
    const smallChunk = new Uint8Array(8)
    // 假 chunk 只带 byteLength：超限判断发生在拷贝之前，不需要真分配 64MB。
    const hugeChunk = { byteLength: LIMIT } as unknown as Uint8Array
    const reads = [
      { done: false as const, value: smallChunk },
      { done: false as const, value: hugeChunk },
      { done: true as const, value: undefined }
    ]
    let readIndex = 0
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: { getReader: () => ({ read: async () => reads[readIndex++] }) },
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4))
    }))
    const service = new MediaAssetsService({ fetchImpl: fetchImpl as unknown as typeof fetch, log: silentLog })
    const result = await service.saveImageAsset({
      workspaceRoot: workspace,
      record: { id: 'img-stream', prompt: 'p', model: 'm', createdAt: 'now' },
      source: { url: 'https://cdn.example.com/stream.png' }
    })
    expect(result.ok && result.record.status).toBe('failed')
    // 第二个 chunk 触发超限中止，不会读到 done。
    expect(readIndex).toBe(2)
  })
})
