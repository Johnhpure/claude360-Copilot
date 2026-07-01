import { describe, expect, it, vi } from 'vitest'
import {
  Claude360CanvasService,
  type Claude360CanvasApiClientPort,
  type Claude360CanvasServiceDeps
} from './claude360-canvas-service'
import { Claude360ApiError, type Claude360ImagesRawEnvelope } from './claude360-api-client'
import { type Claude360SecretStore } from './claude360-secret-store'
import type { Claude360SettingsV1 } from '../../shared/app-settings-claude360'
import type { Claude360TokenPurpose } from '../../shared/claude360'
import type {
  Claude360ImageEditPayload,
  Claude360ImageGeneratePayload
} from '../../shared/claude360-canvas'

// —— fake 端口（沿用既有 service test 的 fakeApi/fakeSecretStore/settingsPort 模式）——

function fakeSecretStore(seed: Record<string, string> = {}): Claude360SecretStore {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    saveSecret: async (r, v) => {
      map.set(r, v)
    },
    loadSecret: async (r) => map.get(r) ?? null,
    deleteSecret: async (r) => {
      map.delete(r)
    },
    clearClaude360Secrets: async () => map.clear(),
    isEncryptionActive: () => true
  }
}

function settingsWithImageGroup(group: string): Claude360SettingsV1 {
  return {
    baseUrl: 'https://claude360.xyz',
    loggedIn: true,
    username: 'demo',
    displayName: 'Demo',
    defaultGroup: 'auto',
    selectedTextGroup: 'auto',
    selectedImageGroup: group,
    selectedMusicGroup: '',
    cliTokenRef: '',
    tokenRefs: {},
    modelCache: { groups: [], models: [] },
    lastSyncAt: ''
  }
}

type FakeApiOptions = {
  generate?: () => Claude360ImagesRawEnvelope
  edit?: () => Claude360ImagesRawEnvelope
  onGenerate?: (path: string, body: unknown, token: string | undefined) => void
  onEdit?: (path: string, form: FormData, token: string | undefined) => void
}

function fakeApi(opts: FakeApiOptions = {}): Claude360CanvasApiClientPort {
  return {
    postImagesRaw: async (path, body, token) => {
      opts.onGenerate?.(path, body, token)
      return (opts.generate ?? (() => ({ data: [{ url: 'https://cdn/x.png' }] })))()
    },
    postImagesMultipart: async (path, form, token) => {
      opts.onEdit?.(path, form, token)
      return (opts.edit ?? (() => ({ data: [{ b64_json: 'QUJD' }] })))()
    }
  }
}

function makeDeps(overrides: Partial<Claude360CanvasServiceDeps> = {}): Claude360CanvasServiceDeps {
  return {
    apiClient: fakeApi(),
    secretStore: fakeSecretStore(),
    readClaude360: async () => settingsWithImageGroup('image-vip'),
    ensureGroupKey: vi.fn(async (group: string) => `key-${group}`),
    ...overrides
  }
}

const generatePayload: Claude360ImageGeneratePayload = {
  model: 'gpt-image-1',
  prompt: '一只戴帽子的柯基',
  size: '1024x1024',
  n: 1
}

// 1x1 png 的 base64（不含 data: 前缀）——足够短便于断言。
const validB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const editPayload: Claude360ImageEditPayload = {
  model: 'gpt-image-1',
  prompt: '把帽子改成红色',
  image: `data:image/png;base64,${validB64}`
}

describe('Claude360CanvasService.generateImages', () => {
  it('使用 selectedImageGroup 的 image Key 调 /v1/images/generations 并归一化 url 结果', async () => {
    const calls: Array<{ path: string; body: unknown; token: string | undefined }> = []
    const ensureGroupKey = vi.fn(async (group: string) => `key-${group}`)
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: fakeApi({
          generate: () => ({ data: [{ url: 'https://cdn/a.png' }, { url: 'https://cdn/b.png' }] }),
          onGenerate: (path, body, token) => calls.push({ path, body, token })
        }),
        ensureGroupKey
      })
    )

    const result = await service.generateImages(generatePayload)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.images).toHaveLength(2)
      expect(result.images[0]).toMatchObject({
        source: 'url',
        url: 'https://cdn/a.png',
        prompt: '一只戴帽子的柯基',
        model: 'gpt-image-1'
      })
      expect(result.images[0].id).toBeTruthy()
      expect(result.images[0].createdAt).toBeTruthy()
    }
    // 使用 image 分组、purpose=image
    expect(ensureGroupKey).toHaveBeenCalledWith('image-vip', 'image')
    // 请求带该分组 image Key，且 body 为 JSON 结构
    expect(calls[0]).toMatchObject({
      path: '/v1/images/generations',
      token: 'key-image-vip',
      body: { model: 'gpt-image-1', prompt: '一只戴帽子的柯基', size: '1024x1024', n: 1 }
    })
  })

  it('把 quality / output_format 透传进请求 body（白名单显式加入）', async () => {
    const calls: Array<{ path: string; body: unknown; token: string | undefined }> = []
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: fakeApi({
          generate: () => ({ data: [{ url: 'https://cdn/a.png' }] }),
          onGenerate: (path, body, token) => calls.push({ path, body, token })
        })
      })
    )

    await service.generateImages({ ...generatePayload, quality: 'high', output_format: 'webp' })

    expect(calls[0].body).toMatchObject({ quality: 'high', output_format: 'webp' })
  })

  it('归一化 b64_json 结果为 source=base64', async () => {
    const service = new Claude360CanvasService(
      makeDeps({ apiClient: fakeApi({ generate: () => ({ data: [{ b64_json: validB64 }] }) }) })
    )
    const result = await service.generateImages(generatePayload)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.images[0]).toMatchObject({ source: 'base64', b64Json: validB64 })
      expect(result.images[0].url).toBeUndefined()
    }
  })

  it('不把 API Key 返回 renderer（结果对象里不含明文 Key）', async () => {
    const service = new Claude360CanvasService(
      makeDeps({ ensureGroupKey: async () => 'sk-super-secret-image-key' })
    )
    const result = await service.generateImages(generatePayload)
    expect(JSON.stringify(result)).not.toContain('sk-super-secret-image-key')
  })

  it('账号未登录时返回登录提示，不发起请求', async () => {
    const postImagesRaw = vi.fn()
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: { postImagesRaw, postImagesMultipart: vi.fn() } as never,
        ensureGroupKey: async () => {
          throw new Claude360ApiError('未登录，请先登录 Claude360')
        }
      })
    )
    const result = await service.generateImages(generatePayload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/未登录/)
    expect(postImagesRaw).not.toHaveBeenCalled()
  })

  it('未选择 image 分组时返回可展示的分组错误，不发起请求', async () => {
    const postImagesRaw = vi.fn()
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: { postImagesRaw, postImagesMultipart: vi.fn() } as never,
        readClaude360: async () => settingsWithImageGroup('')
      })
    )
    const result = await service.generateImages(generatePayload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/生图分组|图片分组|分组/)
    expect(postImagesRaw).not.toHaveBeenCalled()
  })

  it('余额不足等上游错误（error.message）返回可展示 message', async () => {
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: fakeApi({ generate: () => ({ error: { message: '余额不足，请充值' } }) })
      })
    )
    const result = await service.generateImages(generatePayload)
    expect(result).toMatchObject({ ok: false, message: '余额不足，请充值' })
  })

  it('后端返回非预期结构（无 data 数组）返回可展示错误', async () => {
    const service = new Claude360CanvasService(
      makeDeps({ apiClient: fakeApi({ generate: () => ({ foo: 'bar' } as never) }) })
    )
    const result = await service.generateImages(generatePayload)
    expect(result.ok).toBe(false)
  })

  it('网络失败返回 { ok:false, retryable:true }', async () => {
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: {
          postImagesRaw: async () => {
            throw new Claude360ApiError('网络请求失败，请检查网络连接')
          },
          postImagesMultipart: vi.fn()
        } as never
      })
    )
    const result = await service.generateImages(generatePayload)
    expect(result).toMatchObject({ ok: false, retryable: true })
  })
})

describe('Claude360CanvasService.editImage', () => {
  it('用 image Key 走 multipart 调 /v1/images/edits，字段含 model/prompt/image', async () => {
    let captured: FormData | undefined
    let capturedToken: string | undefined
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: fakeApi({
          edit: () => ({ data: [{ url: 'https://cdn/edited.png' }] }),
          onEdit: (_path, form, token) => {
            captured = form
            capturedToken = token
          }
        })
      })
    )

    const result = await service.editImage(editPayload)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.images[0]).toMatchObject({ source: 'url', url: 'https://cdn/edited.png' })
    }
    expect(capturedToken).toBe('key-image-vip')
    expect(captured).toBeInstanceOf(FormData)
    expect(captured?.get('model')).toBe('gpt-image-1')
    expect(captured?.get('prompt')).toBe('把帽子改成红色')
    const image = captured?.get('image')
    expect(image).toBeInstanceOf(Blob)
  })

  it('接受纯 base64（无 dataURL 前缀）的 image', async () => {
    let captured: FormData | undefined
    const service = new Claude360CanvasService(
      makeDeps({ apiClient: fakeApi({ onEdit: (_p, form) => { captured = form } }) })
    )
    const result = await service.editImage({ ...editPayload, image: validB64 })
    expect(result.ok).toBe(true)
    expect(captured?.get('image')).toBeInstanceOf(Blob)
  })

  it('携带 mask/size/quality/output_format 时一并放入 multipart，否则不放', async () => {
    let withMask: FormData | undefined
    const svcWith = new Claude360CanvasService(
      makeDeps({ apiClient: fakeApi({ onEdit: (_p, form) => { withMask = form } }) })
    )
    await svcWith.editImage({
      ...editPayload,
      mask: validB64,
      size: '1024x1536',
      quality: 'high',
      output_format: 'webp'
    })
    expect(withMask?.get('mask')).toBeInstanceOf(Blob)
    expect(withMask?.get('size')).toBe('1024x1536')
    expect(withMask?.get('quality')).toBe('high')
    expect(withMask?.get('output_format')).toBe('webp')

    let withoutMask: FormData | undefined
    const svcWithout = new Claude360CanvasService(
      makeDeps({ apiClient: fakeApi({ onEdit: (_p, form) => { withoutMask = form } }) })
    )
    await svcWithout.editImage(editPayload)
    expect(withoutMask?.has('mask')).toBe(false)
    expect(withoutMask?.has('size')).toBe(false)
    expect(withoutMask?.has('quality')).toBe(false)
    expect(withoutMask?.has('output_format')).toBe(false)
  })

  it('image 为空/非法 base64 时返回可展示错误，不发起请求', async () => {
    const postImagesMultipart = vi.fn()
    const service = new Claude360CanvasService(
      makeDeps({ apiClient: { postImagesRaw: vi.fn(), postImagesMultipart } as never })
    )
    const result = await service.editImage({ ...editPayload, image: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/图片|格式|image/i)
    expect(postImagesMultipart).not.toHaveBeenCalled()
  })

  it('image 过大时返回“图片过大”错误，不发起请求', async () => {
    const postImagesMultipart = vi.fn()
    const service = new Claude360CanvasService(
      makeDeps({ apiClient: { postImagesRaw: vi.fn(), postImagesMultipart } as never })
    )
    // 构造超过上限的 base64（约 30MB 解码后 > 25MB 上限）。
    const huge = 'A'.repeat(40 * 1024 * 1024)
    const result = await service.editImage({ ...editPayload, image: huge })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/过大|大小|大于/)
    expect(postImagesMultipart).not.toHaveBeenCalled()
  })

  it('未登录时返回登录提示，不发起请求', async () => {
    const postImagesMultipart = vi.fn()
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: { postImagesRaw: vi.fn(), postImagesMultipart } as never,
        ensureGroupKey: async () => {
          throw new Claude360ApiError('未登录，请先登录 Claude360')
        }
      })
    )
    const result = await service.editImage(editPayload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/未登录/)
    expect(postImagesMultipart).not.toHaveBeenCalled()
  })

  it('网络失败返回 { ok:false, retryable:true }', async () => {
    const service = new Claude360CanvasService(
      makeDeps({
        apiClient: {
          postImagesRaw: vi.fn(),
          postImagesMultipart: async () => {
            throw new Claude360ApiError('网络请求失败，请检查网络连接')
          }
        } as never
      })
    )
    const result = await service.editImage(editPayload)
    expect(result).toMatchObject({ ok: false, retryable: true })
  })
})
