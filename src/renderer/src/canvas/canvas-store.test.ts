// canvas-store 纯 reducer / 持久化测试（node 环境，无 DOM）。
// 覆盖：表单参数；pending→success/failed 作品卡片生命周期；筛选/删除/清空/批量选择；
// 持久化序列化（只存 success、大 base64 丢弃）与恢复（含旧版 history 键迁移）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Claude360CanvasImage } from '@shared/claude360-canvas'
import {
  CANVAS_ARTWORKS_STORAGE_KEY,
  CANVAS_HISTORY_LIMIT,
  CANVAS_HISTORY_MAX_BASE64_LENGTH,
  CANVAS_HISTORY_STORAGE_KEY,
  clampN,
  createCanvasStore,
  diskRecordToArtwork,
  filterArtworks,
  loadPersistedArtworks,
  mergeDiskRecords,
  migrateLegacyHistory,
  reduceFailPending,
  reduceResolvePending,
  sanitizeRehydratedArtworks,
  serializeArtworksForPersist,
  type CanvasArtwork,
  type DiskImageRecord
} from './canvas-store'

function image(id: string, overrides: Partial<Claude360CanvasImage> = {}): Claude360CanvasImage {
  return {
    id,
    source: 'url',
    url: `https://cdn.example/${id}.png`,
    mimeType: 'image/png',
    prompt: `p-${id}`,
    model: 'gpt-image-1',
    createdAt: '2026-07-02T00:00:00.000Z',
    ...overrides
  }
}

function successArtwork(id: string, overrides: Partial<CanvasArtwork> = {}): CanvasArtwork {
  return {
    id,
    status: 'success',
    image: image(id),
    prompt: `p-${id}`,
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'auto',
    outputFormat: 'png',
    n: 1,
    createdAt: '2026-07-02T00:00:00.000Z',
    ...overrides
  }
}

function stubLocalStorage(): Map<string, string> {
  const storage = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k)
    }
  })
  return storage
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('canvas-store · 表单参数状态', () => {
  it('setPrompt/setModel/setN 更新对应字段，clampN 夹逼到 [1,4]', () => {
    const store = createCanvasStore()
    store.getState().setPrompt('一只柯基')
    store.getState().setModel('gpt-image-1')
    store.getState().setN(3)
    const s = store.getState()
    expect(s.prompt).toBe('一只柯基')
    expect(s.model).toBe('gpt-image-1')
    expect(s.n).toBe(3)
    expect(clampN(0)).toBe(1)
    expect(clampN(99)).toBe(4)
    expect(clampN(Number.NaN)).toBe(1)
  })

  it('setAspectPreset/setResolution 联动派生 size', () => {
    const store = createCanvasStore()
    store.getState().setAspectPreset('widescreen')
    store.getState().setResolution('1K')
    expect(store.getState().size).toBe('1280x720')
  })
})

describe('作品生命周期：pending 占位 → success/failed', () => {
  it('beginGenerate 用当前表单参数在宫格头部插入 pending 占位（生成中立即可见）', () => {
    const store = createCanvasStore()
    store.getState().setPrompt('一只柯基')
    store.getState().setModel('gpt-image-1')
    store.getState().setN(2)
    store.getState().beginGenerate()

    const s = store.getState()
    expect(s.generating).toBe(true)
    expect(s.artworks).toHaveLength(1)
    expect(s.artworks[0]).toMatchObject({
      status: 'pending',
      prompt: '一只柯基',
      model: 'gpt-image-1',
      n: 2
    })
    expect(s.pendingArtworkId).toBe(s.artworks[0].id)
  })

  it('generateSuccess 把 pending 原位替换为一批 success 作品（继承参数快照）', () => {
    const store = createCanvasStore({ initialArtworks: [successArtwork('old')] })
    store.getState().setPrompt('新作品')
    store.getState().beginGenerate()
    store.getState().generateSuccess([image('a'), image('b')])

    const s = store.getState()
    expect(s.generating).toBe(false)
    expect(s.pendingArtworkId).toBeNull()
    expect(s.artworks.map((a) => a.id)).toEqual(['a', 'b', 'old'])
    expect(s.artworks[0]).toMatchObject({ status: 'success', prompt: 'p-a', n: 1 })
    expect(s.artworks[0].image?.url).toBe('https://cdn.example/a.png')
  })

  it('generateFailure 把 pending 标记为 failed 并保留错误信息（失败状态在卡片可见）', () => {
    const store = createCanvasStore()
    store.getState().setPrompt('会失败的')
    store.getState().beginGenerate()
    store.getState().generateFailure('quota exceeded')

    const s = store.getState()
    expect(s.generating).toBe(false)
    expect(s.artworks[0]).toMatchObject({
      status: 'failed',
      error: 'quota exceeded',
      prompt: '会失败的'
    })
  })

  it('beginEdit/editSuccess 与 generate 同一套占位生命周期（参考图路径）', () => {
    const store = createCanvasStore()
    store.getState().setPrompt('编辑参考图')
    store.getState().beginEdit()
    expect(store.getState().editing).toBe(true)
    expect(store.getState().artworks[0].status).toBe('pending')
    store.getState().editSuccess([image('e1')])
    expect(store.getState().editing).toBe(false)
    expect(store.getState().artworks[0]).toMatchObject({ id: 'e1', status: 'success' })
  })

  it('作品总量截断到 CANVAS_HISTORY_LIMIT', () => {
    const initial = Array.from({ length: CANVAS_HISTORY_LIMIT }, (_, i) => successArtwork(`s${i}`))
    const store = createCanvasStore({ initialArtworks: initial })
    store.getState().beginGenerate()
    expect(store.getState().artworks).toHaveLength(CANVAS_HISTORY_LIMIT)
  })
})

describe('reduceResolvePending / reduceFailPending', () => {
  it('未命中 pendingId 时保持原列表（防御 stale 调用）', () => {
    const artworks = [successArtwork('keep')]
    expect(reduceResolvePending(artworks, 'nope', [image('x')])).toEqual(artworks)
    expect(reduceFailPending(artworks, null, 'boom')).toEqual(artworks)
  })
})

describe('筛选 / 删除 / 清空 / 批量选择', () => {
  it('filterArtworks 按状态筛选，all 原样返回', () => {
    const list: CanvasArtwork[] = [
      successArtwork('ok'),
      { ...successArtwork('run'), status: 'pending', image: undefined },
      { ...successArtwork('bad'), status: 'failed', image: undefined, error: 'x' }
    ]
    expect(filterArtworks(list, 'all')).toHaveLength(3)
    expect(filterArtworks(list, 'success').map((a) => a.id)).toEqual(['ok'])
    expect(filterArtworks(list, 'pending').map((a) => a.id)).toEqual(['run'])
    expect(filterArtworks(list, 'failed').map((a) => a.id)).toEqual(['bad'])
  })

  it('removeArtwork 删除单个并同步清掉选中态', () => {
    const store = createCanvasStore({ initialArtworks: [successArtwork('a'), successArtwork('b')] })
    store.getState().toggleSelectMode()
    store.getState().toggleSelected('a')
    store.getState().removeArtwork('a')
    expect(store.getState().artworks.map((x) => x.id)).toEqual(['b'])
    expect(store.getState().selectedIds).toEqual({})
  })

  it('批量选择：toggleSelected 勾选/反选、removeSelected 删除所选并退出选择模式', () => {
    const store = createCanvasStore({
      initialArtworks: [successArtwork('a'), successArtwork('b'), successArtwork('c')]
    })
    store.getState().toggleSelectMode()
    store.getState().toggleSelected('a')
    store.getState().toggleSelected('b')
    store.getState().toggleSelected('b') // 反选
    store.getState().toggleSelected('c')
    store.getState().removeSelected()
    const s = store.getState()
    expect(s.artworks.map((x) => x.id)).toEqual(['b'])
    expect(s.selectMode).toBe(false)
    expect(s.selectedIds).toEqual({})
  })

  it('退出选择模式清空已选', () => {
    const store = createCanvasStore({ initialArtworks: [successArtwork('a')] })
    store.getState().toggleSelectMode()
    store.getState().toggleSelected('a')
    store.getState().toggleSelectMode()
    expect(store.getState().selectedIds).toEqual({})
  })

  it('clearArtworks 全清但豁免飞行中的 pending 占位', () => {
    const store = createCanvasStore({ initialArtworks: [successArtwork('a')] })
    store.getState().beginGenerate()
    store.getState().clearArtworks()
    expect(store.getState().artworks.map((x) => x.status)).toEqual(['pending'])
  })

  it('removeSelected 豁免 pending 占位（防飞行中批次结果无处安放）', () => {
    const store = createCanvasStore({ initialArtworks: [successArtwork('a')] })
    store.getState().beginGenerate()
    const pendingId = store.getState().pendingArtworkId as string
    store.getState().toggleSelectMode()
    store.getState().toggleSelected('a')
    store.getState().toggleSelected(pendingId)
    store.getState().removeSelected()
    const s = store.getState()
    expect(s.artworks.map((x) => x.id)).toEqual([pendingId])
    // 占位仍能被后续 success 正常替换
    store.getState().generateSuccess([image('done')])
    expect(store.getState().artworks[0]).toMatchObject({ id: 'done', status: 'success' })
  })
})

describe('持久化', () => {
  it('serializeArtworksForPersist 只保留 success，超阈值 base64 丢弃 b64Json', () => {
    const big = 'x'.repeat(CANVAS_HISTORY_MAX_BASE64_LENGTH + 1)
    const list: CanvasArtwork[] = [
      { ...successArtwork('run'), status: 'pending', image: undefined },
      successArtwork('big', {
        image: image('big', { source: 'base64', url: undefined, b64Json: big })
      }),
      successArtwork('small', {
        image: image('small', { source: 'base64', url: undefined, b64Json: 'QUJD' })
      })
    ]
    const persisted = serializeArtworksForPersist(list)
    expect(persisted.map((a) => a.id)).toEqual(['big', 'small'])
    expect(persisted[0].image?.b64Json).toBeUndefined()
    expect(persisted[1].image?.b64Json).toBe('QUJD')
  })

  it('sanitizeRehydratedArtworks 过滤坏条目：非 success、缺图、缺 id', () => {
    const restored = sanitizeRehydratedArtworks([
      successArtwork('ok'),
      { ...successArtwork('no-image'), image: undefined },
      { ...successArtwork('pending'), status: 'pending' },
      { bogus: true },
      null
    ])
    expect(restored.map((a) => a.id)).toEqual(['ok'])
  })

  it('migrateLegacyHistory 把旧版纯图片历史映射为 success 作品', () => {
    const migrated = migrateLegacyHistory([image('legacy'), { broken: true }])
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toMatchObject({
      id: 'legacy',
      status: 'success',
      prompt: 'p-legacy',
      model: 'gpt-image-1'
    })
  })

  it('loadPersistedArtworks 优先新键，回退旧版 history 键迁移，损坏安全回空', () => {
    const storage = stubLocalStorage()
    // 1) 两键都缺 → 空
    expect(loadPersistedArtworks()).toEqual([])
    // 2) 旧键迁移：结果落新键 + 旧键删除（防新旧两份 base64 挤爆配额）
    storage.set(CANVAS_HISTORY_STORAGE_KEY, JSON.stringify({ history: [image('legacy')] }))
    expect(loadPersistedArtworks().map((a) => a.id)).toEqual(['legacy'])
    expect(storage.has(CANVAS_HISTORY_STORAGE_KEY)).toBe(false)
    expect(storage.get(CANVAS_ARTWORKS_STORAGE_KEY)).toContain('legacy')
    storage.delete(CANVAS_ARTWORKS_STORAGE_KEY)
    // 3) 新键优先
    storage.set(CANVAS_ARTWORKS_STORAGE_KEY, JSON.stringify({ artworks: [successArtwork('new')] }))
    expect(loadPersistedArtworks().map((a) => a.id)).toEqual(['new'])
    // 4) 损坏 JSON 回空
    storage.set(CANVAS_ARTWORKS_STORAGE_KEY, '{broken')
    expect(loadPersistedArtworks()).toEqual([])
  })

  it('persist:true 时作品变更自动落盘（只写 success，绝不含 Key）', () => {
    const storage = stubLocalStorage()
    const store = createCanvasStore({ persist: true })
    store.getState().setPrompt('落盘测试')
    store.getState().beginGenerate()
    store.getState().generateSuccess([image('persisted')])
    const raw = storage.get(CANVAS_ARTWORKS_STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw ?? '{}') as { artworks?: CanvasArtwork[] }
    expect(parsed.artworks?.map((a) => a.id)).toEqual(['persisted'])
  })
})

// —— 07-05 磁盘持久化恢复 ——

function diskRecord(id: string, overrides: Partial<DiskImageRecord> = {}): DiskImageRecord {
  return {
    id,
    status: 'completed',
    prompt: `p-${id}`,
    model: 'gpt-image-1',
    createdAt: '2026-07-03T00:00:00.000Z',
    localPath: `assets/images/${id}.png`,
    remoteUrl: `https://cdn.example/${id}.png`,
    ...overrides
  }
}

describe('磁盘持久化恢复（07-05）', () => {
  it('diskRecordToArtwork：completed 记录转 success 作品并带 localPath', () => {
    const artwork = diskRecordToArtwork(diskRecord('d1'))
    expect(artwork?.status).toBe('success')
    expect(artwork?.localPath).toBe('assets/images/d1.png')
    expect(artwork?.image?.url).toBe('https://cdn.example/d1.png')
  })

  it('mergeDiskRecords：同 id 保留内存条目并补 localPath；新增磁盘条目按时间倒序并入', () => {
    const memory = [successArtwork('a', { createdAt: '2026-07-04T00:00:00.000Z' })]
    const merged = mergeDiskRecords(memory, [
      diskRecord('a', { localPath: 'assets/images/a.png' }),
      diskRecord('b', { createdAt: '2026-07-01T00:00:00.000Z' })
    ])
    expect(merged.map((x) => x.id)).toEqual(['a', 'b'])
    expect(merged[0].localPath).toBe('assets/images/a.png')
    expect(merged[0].prompt).toBe('p-a') // 内存条目字段保留
  })

  it('mergeDiskRecords：切换工作空间时移除其他空间的磁盘来源条目（带 localPath 且不在新记录中）', () => {
    const fromOldWorkspace = successArtwork('old', { localPath: 'assets/images/old.png' })
    const pureMemory = successArtwork('mem')
    const merged = mergeDiskRecords([fromOldWorkspace, pureMemory], [diskRecord('new')])
    expect(merged.map((x) => x.id).sort()).toEqual(['mem', 'new'])
  })

  it('mergeDiskRecords：fileMissing 标注透传，pending 磁盘记录不并入', () => {
    const merged = mergeDiskRecords([], [
      diskRecord('gone', { fileMissing: true }),
      diskRecord('wip', { status: 'pending' })
    ])
    expect(merged.map((x) => x.id)).toEqual(['gone'])
    expect(merged[0].fileMissing).toBe(true)
  })

  it('sanitizeRehydratedArtworks：无 image 但有 localPath 的条目保留（本地-only 作品）', () => {
    const restored = sanitizeRehydratedArtworks([
      { id: 'local-only', status: 'success', localPath: 'assets/images/x.png', prompt: '', model: '', size: '', quality: '', outputFormat: '', n: 1, createdAt: '' }
    ])
    expect(restored.map((x) => x.id)).toEqual(['local-only'])
    expect(restored[0].localPath).toBe('assets/images/x.png')
  })

  it('hydrateFromDisk / attachLocalArtifact actions：合并与回写', () => {
    const store = createCanvasStore({ initialArtworks: [successArtwork('run')] })
    store.getState().hydrateFromDisk([diskRecord('disk1')])
    expect(store.getState().artworks.map((x) => x.id).sort()).toEqual(['disk1', 'run'])
    store.getState().attachLocalArtifact('run', 'assets/images/run.png')
    expect(store.getState().artworks.find((x) => x.id === 'run')?.localPath).toBe('assets/images/run.png')
  })
})
