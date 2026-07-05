import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
