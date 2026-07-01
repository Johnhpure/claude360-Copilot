// 生图工作台 store 的单元测试（plan-06 Task 4）。
// node 环境：用 createCanvasStore() 得到隔离实例，断言纯 reducer 语义与持久化限量。
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import {
  createCanvasStore,
  reduceAddHistory,
  serializeHistoryForPersist,
  loadPersistedHistory,
  sanitizeRehydratedHistory,
  CANVAS_HISTORY_LIMIT,
  CANVAS_HISTORY_STORAGE_KEY,
  CANVAS_HISTORY_MAX_BASE64_LENGTH
} from './canvas-store'

function image(id: string, overrides: Partial<Claude360CanvasImage> = {}): Claude360CanvasImage {
  return {
    id,
    source: 'url',
    url: `https://cdn.example/${id}.png`,
    mimeType: 'image/png',
    prompt: `p-${id}`,
    model: 'flux-pro',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

describe('canvas-store · prompt/model/size/n 状态', () => {
  it('setPrompt/setModel/setSize/setN 更新对应字段', () => {
    const store = createCanvasStore()
    store.getState().setPrompt('一只柯基')
    store.getState().setModel('flux-pro')
    store.getState().setSize('1024x1536')
    store.getState().setN(3)
    const s = store.getState()
    expect(s.prompt).toBe('一只柯基')
    expect(s.model).toBe('flux-pro')
    expect(s.size).toBe('1024x1536')
    expect(s.n).toBe(3)
  })
  it('setN 夹逼到 1..4', () => {
    const store = createCanvasStore()
    store.getState().setN(0)
    expect(store.getState().n).toBe(1)
    store.getState().setN(99)
    expect(store.getState().n).toBe(4)
  })
})

describe('canvas-store · generate/edit pending/success/failure', () => {
  it('generate pending → success 写入 lastResult 与 history、清 error', () => {
    const store = createCanvasStore()
    store.getState().beginGenerate()
    expect(store.getState().generating).toBe(true)
    const imgs = [image('a'), image('b')]
    store.getState().generateSuccess(imgs)
    const s = store.getState()
    expect(s.generating).toBe(false)
    expect(s.lastResult).toEqual(imgs)
    expect(s.error).toBeNull()
    // 成功结果进入历史
    expect(s.history.map((i) => i.id)).toEqual(['a', 'b'])
    // active 落到第一张
    expect(s.activeImageId).toBe('a')
  })
  it('generate failure 记录 error 并停止 pending', () => {
    const store = createCanvasStore()
    store.getState().beginGenerate()
    store.getState().generateFailure('余额不足')
    const s = store.getState()
    expect(s.generating).toBe(false)
    expect(s.error).toBe('余额不足')
  })
  it('edit pending → success 追加到历史', () => {
    const store = createCanvasStore()
    store.getState().generateSuccess([image('a')])
    store.getState().beginEdit()
    expect(store.getState().editing).toBe(true)
    store.getState().editSuccess([image('edited')])
    const s = store.getState()
    expect(s.editing).toBe(false)
    // 编辑结果排在历史最前
    expect(s.history[0].id).toBe('edited')
    expect(s.history.map((i) => i.id)).toContain('a')
  })
  it('edit failure 记录 error', () => {
    const store = createCanvasStore()
    store.getState().beginEdit()
    store.getState().editFailure('图片过大')
    expect(store.getState().editing).toBe(false)
    expect(store.getState().error).toBe('图片过大')
  })
})

describe('canvas-store · active image 选择', () => {
  it('setActiveImage 更新 activeImageId', () => {
    const store = createCanvasStore()
    store.getState().generateSuccess([image('a'), image('b')])
    store.getState().setActiveImage('b')
    expect(store.getState().activeImageId).toBe('b')
  })
})

describe('reduceAddHistory · 添加与截断（最多 100 条）', () => {
  it('新结果排在最前', () => {
    const next = reduceAddHistory([image('old')], [image('new1'), image('new2')])
    expect(next.map((i) => i.id)).toEqual(['new1', 'new2', 'old'])
  })
  it('超过上限时截断到 CANVAS_HISTORY_LIMIT', () => {
    const existing = Array.from({ length: CANVAS_HISTORY_LIMIT }, (_, i) => image(`e${i}`))
    const next = reduceAddHistory(existing, [image('brand-new')])
    expect(next.length).toBe(CANVAS_HISTORY_LIMIT)
    expect(next[0].id).toBe('brand-new')
    // 最老的一条被挤出
    expect(next.map((i) => i.id)).not.toContain(`e${CANVAS_HISTORY_LIMIT - 1}`)
  })
})

describe('serializeHistoryForPersist · base64 限量（不写超大 base64）', () => {
  it('丢弃超阈值的 base64 大图，只留元信息占位（source 仍 base64 但 b64Json 清空）', () => {
    const bigB64 = 'A'.repeat(CANVAS_HISTORY_MAX_BASE64_LENGTH + 10)
    const persisted = serializeHistoryForPersist([
      image('big', { source: 'base64', url: undefined, b64Json: bigB64 }),
      image('url-ok')
    ])
    const big = persisted.find((i) => i.id === 'big')
    expect(big?.b64Json).toBeUndefined()
    // url 图片完整保留
    expect(persisted.find((i) => i.id === 'url-ok')?.url).toBe('https://cdn.example/url-ok.png')
  })
  it('小 base64 图片保留 b64Json', () => {
    const persisted = serializeHistoryForPersist([
      image('small', { source: 'base64', url: undefined, b64Json: 'aGVsbG8=' })
    ])
    expect(persisted[0].b64Json).toBe('aGVsbG8=')
  })
  it('只保留最近 CANVAS_HISTORY_LIMIT 条', () => {
    const many = Array.from({ length: CANVAS_HISTORY_LIMIT + 20 }, (_, i) => image(`m${i}`))
    expect(serializeHistoryForPersist(many).length).toBe(CANVAS_HISTORY_LIMIT)
  })
})

describe('loadPersistedHistory · 损坏安全恢复空列表', () => {
  const store: Record<string, string> = {}
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k]
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      }
    }
  })
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage
  })
  it('无数据返回空列表', () => {
    expect(loadPersistedHistory()).toEqual([])
  })
  it('损坏 JSON 返回空列表', () => {
    store[CANVAS_HISTORY_STORAGE_KEY] = '{not json'
    expect(loadPersistedHistory()).toEqual([])
  })
  it('非数组 history 字段返回空列表', () => {
    store[CANVAS_HISTORY_STORAGE_KEY] = JSON.stringify({ history: 'x' })
    expect(loadPersistedHistory()).toEqual([])
  })
  it('合法数据恢复并 sanitize', () => {
    store[CANVAS_HISTORY_STORAGE_KEY] = JSON.stringify({ history: [image('a'), image('b')] })
    const loaded = loadPersistedHistory()
    expect(loaded.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('sanitizeRehydratedHistory · 丢弃损坏条目', () => {
  it('过滤掉既无 url 又无 b64Json 的坏条目', () => {
    const bad = { ...image('bad'), source: 'url' as const, url: undefined, b64Json: undefined }
    const clean = sanitizeRehydratedHistory([image('ok'), bad])
    expect(clean.map((i) => i.id)).toEqual(['ok'])
  })
  it('非对象条目被过滤', () => {
    const clean = sanitizeRehydratedHistory([image('ok'), null as unknown as Claude360CanvasImage])
    expect(clean.map((i) => i.id)).toEqual(['ok'])
  })
})
