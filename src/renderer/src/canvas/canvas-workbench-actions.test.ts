// 生图工作台纯编排函数的单元测试（plan-06 Task 5+7）。
// node 环境：注入 mock kunGui 子集与 store 动作，断言调用顺序、image 模型过滤、上传转 dataURL、复制/下载。
import { describe, it, expect, vi } from 'vitest'
import type { Claude360CanvasImage, Claude360ImageResult } from '@shared/claude360-canvas'
import {
  filterImageModels,
  defaultImageModel,
  submitGenerate,
  submitEdit,
  fileToDataUrl,
  copyImage,
  downloadImage
} from './canvas-workbench-actions'

function image(id: string, overrides: Partial<Claude360CanvasImage> = {}): Claude360CanvasImage {
  return {
    id,
    source: 'url',
    url: `https://cdn.example/${id}.png`,
    mimeType: 'image/png',
    prompt: 'p',
    model: 'flux-pro',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('filterImageModels / defaultImageModel · 只筛 image 模型（不硬编码）', () => {
  it('从 modelCache.models 过滤出 image 模型', () => {
    const models = ['claude-3-5-sonnet', 'flux-pro', 'gpt-image-1', 'suno-v5', 'dall-e-3']
    expect(filterImageModels(models)).toEqual(['flux-pro', 'gpt-image-1', 'dall-e-3'])
  })
  it('无 image 模型时返回空数组', () => {
    expect(filterImageModels(['claude-3-5-sonnet', 'gpt-4o'])).toEqual([])
  })
  it('默认模型取第一个 image 模型；无则空串', () => {
    expect(defaultImageModel(['gpt-4o', 'flux-pro', 'dall-e-3'])).toBe('flux-pro')
    expect(defaultImageModel(['gpt-4o'])).toBe('')
  })
})

describe('submitGenerate · 生成编排', () => {
  it('校验空 prompt 直接失败，不调用 api', async () => {
    const api = { claude360CanvasGenerate: vi.fn() }
    const store = { beginGenerate: vi.fn(), generateSuccess: vi.fn(), generateFailure: vi.fn() }
    const result = await submitGenerate(api, store, { prompt: '   ', model: 'flux-pro', size: '1024x1024', n: 1 })
    expect(result.ok).toBe(false)
    expect(api.claude360CanvasGenerate).not.toHaveBeenCalled()
  })
  it('校验空 model 直接失败', async () => {
    const api = { claude360CanvasGenerate: vi.fn() }
    const store = { beginGenerate: vi.fn(), generateSuccess: vi.fn(), generateFailure: vi.fn() }
    const result = await submitGenerate(api, store, { prompt: '猫', model: '', size: '1024x1024', n: 1 })
    expect(result.ok).toBe(false)
    expect(api.claude360CanvasGenerate).not.toHaveBeenCalled()
  })
  it('成功：beginGenerate → api → generateSuccess', async () => {
    const ok: Claude360ImageResult = { ok: true, images: [image('a')] }
    const api = { claude360CanvasGenerate: vi.fn(async () => ok) }
    const store = { beginGenerate: vi.fn(), generateSuccess: vi.fn(), generateFailure: vi.fn() }
    const result = await submitGenerate(api, store, { prompt: '猫', model: 'flux-pro', size: '1024x1024', n: 2 })
    expect(result.ok).toBe(true)
    expect(api.claude360CanvasGenerate).toHaveBeenCalledWith({ model: 'flux-pro', prompt: '猫', size: '1024x1024', n: 2 })
    expect(store.beginGenerate).toHaveBeenCalled()
    expect(store.generateSuccess).toHaveBeenCalledWith([image('a')])
    expect(store.generateFailure).not.toHaveBeenCalled()
  })
  it('后端 ok:false → generateFailure(message)', async () => {
    const fail: Claude360ImageResult = { ok: false, message: '余额不足' }
    const api = { claude360CanvasGenerate: vi.fn(async () => fail) }
    const store = { beginGenerate: vi.fn(), generateSuccess: vi.fn(), generateFailure: vi.fn() }
    const result = await submitGenerate(api, store, { prompt: '猫', model: 'flux-pro', size: '1024x1024', n: 1 })
    expect(result.ok).toBe(false)
    expect(store.generateFailure).toHaveBeenCalledWith('余额不足')
  })
  it('抛异常 → generateFailure(错误信息)', async () => {
    const api = { claude360CanvasGenerate: vi.fn(async () => { throw new Error('网络错误') }) }
    const store = { beginGenerate: vi.fn(), generateSuccess: vi.fn(), generateFailure: vi.fn() }
    const result = await submitGenerate(api, store, { prompt: '猫', model: 'flux-pro', size: '1024x1024', n: 1 })
    expect(result.ok).toBe(false)
    expect(store.generateFailure).toHaveBeenCalledWith('网络错误')
  })
})

describe('submitEdit · 编辑编排', () => {
  it('缺 image / prompt / model 直接失败', async () => {
    const api = { claude360CanvasEdit: vi.fn() }
    const store = { beginEdit: vi.fn(), editSuccess: vi.fn(), editFailure: vi.fn() }
    expect((await submitEdit(api, store, { prompt: '加个帽子', model: 'flux-pro', image: '' })).ok).toBe(false)
    expect((await submitEdit(api, store, { prompt: '', model: 'flux-pro', image: 'data:...' })).ok).toBe(false)
    expect(api.claude360CanvasEdit).not.toHaveBeenCalled()
  })
  it('成功：beginEdit → api → editSuccess', async () => {
    const ok: Claude360ImageResult = { ok: true, images: [image('edited')] }
    const api = { claude360CanvasEdit: vi.fn(async () => ok) }
    const store = { beginEdit: vi.fn(), editSuccess: vi.fn(), editFailure: vi.fn() }
    const result = await submitEdit(api, store, { prompt: '加个帽子', model: 'flux-pro', image: 'data:image/png;base64,AAA', size: '1024x1024', quality: 'high', output_format: 'webp' })
    expect(result.ok).toBe(true)
    expect(api.claude360CanvasEdit).toHaveBeenCalledWith({ model: 'flux-pro', prompt: '加个帽子', image: 'data:image/png;base64,AAA', size: '1024x1024', quality: 'high', output_format: 'webp' })
    expect(store.editSuccess).toHaveBeenCalledWith([image('edited')])
  })
  it('后端 ok:false → editFailure', async () => {
    const fail: Claude360ImageResult = { ok: false, message: '图片格式不支持' }
    const api = { claude360CanvasEdit: vi.fn(async () => fail) }
    const store = { beginEdit: vi.fn(), editSuccess: vi.fn(), editFailure: vi.fn() }
    const result = await submitEdit(api, store, { prompt: 'x', model: 'flux-pro', image: 'data:...' })
    expect(result.ok).toBe(false)
    expect(store.editFailure).toHaveBeenCalledWith('图片格式不支持')
  })
})

describe('fileToDataUrl · 本地图片 → dataURL（不用 Node API）', () => {
  it('用注入的 reader 得到 dataURL', async () => {
    const fakeFile = { name: 'x.png' } as unknown as File
    const readAsDataURL = vi.fn(async () => 'data:image/png;base64,ZZZ')
    await expect(fileToDataUrl(fakeFile, readAsDataURL)).resolves.toBe('data:image/png;base64,ZZZ')
    expect(readAsDataURL).toHaveBeenCalledWith(fakeFile)
  })
})

describe('copyImage · url 复制链接 / base64 复制图片', () => {
  it('url 图片写文本剪贴板', async () => {
    const writeText = vi.fn(async () => undefined)
    const writeImage = vi.fn(async () => undefined)
    const kind = await copyImage(image('u'), { writeText, writeImage, fetch: (async () => new Response()) as unknown as typeof fetch })
    expect(kind).toBe('url')
    expect(writeText).toHaveBeenCalledWith('https://cdn.example/u.png')
  })
  it('base64 图片走 writeImage（复制图片 blob）', async () => {
    const writeText = vi.fn(async () => undefined)
    const writeImage = vi.fn(async () => undefined)
    const fetchMock = vi.fn(async () => new Response(new Blob(['x'], { type: 'image/png' })))
    const kind = await copyImage(
      image('b', { source: 'base64', url: undefined, b64Json: 'aGVsbG8=' }),
      { writeText, writeImage, fetch: fetchMock as unknown as typeof fetch }
    )
    expect(kind).toBe('image')
    expect(writeImage).toHaveBeenCalled()
  })
})

describe('downloadImage · 触发下载', () => {
  it('base64 图片用 data URL 触发下载并带安全文件名', () => {
    const triggerDownload = vi.fn()
    const ok = downloadImage(image('d', { source: 'base64', url: undefined, b64Json: 'aGVsbG8=', prompt: 'a/b:c' }), { triggerDownload })
    expect(ok).toBe(true)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    const [href, filename] = triggerDownload.mock.calls[0]
    expect(href).toContain('data:image/png;base64,')
    expect(filename).not.toMatch(/[\\/:*?"<>|]/)
  })
  it('url 图片用 url 触发下载', () => {
    const triggerDownload = vi.fn()
    downloadImage(image('u'), { triggerDownload })
    expect(triggerDownload.mock.calls[0][0]).toBe('https://cdn.example/u.png')
  })
  it('损坏图片（无源）不下载', () => {
    const triggerDownload = vi.fn()
    const ok = downloadImage(image('x', { source: 'base64', url: undefined, b64Json: undefined }), { triggerDownload })
    expect(ok).toBe(false)
    expect(triggerDownload).not.toHaveBeenCalled()
  })
})
