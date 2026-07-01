// music-player-store 状态机单测（node 环境，纯 reducer 语义）。
import { describe, it, expect } from 'vitest'
import type { Claude360Song } from '@shared/claude360-music'
import {
  createMusicPlayerStore,
  currentSong,
  hasNext,
  hasPrev,
  MUSIC_DEFAULT_VOLUME
} from './music-player-store'

function song(id: string): Claude360Song {
  return { id, audioUrl: `https://cdn/${id}.mp3`, title: `t-${id}` }
}

describe('music-player-store · 队列与播放', () => {
  it('setQueue 定位起始索引并开始播放', () => {
    const store = createMusicPlayerStore()
    const q = [song('a'), song('b'), song('c')]
    store.getState().setQueue(q, 1)
    const s = store.getState()
    expect(s.queue).toHaveLength(3)
    expect(s.index).toBe(1)
    expect(s.playing).toBe(true)
    expect(currentSong(s)?.id).toBe('b')
  })

  it('setQueue 越界起始索引夹逼到合法范围', () => {
    const store = createMusicPlayerStore()
    store.getState().setQueue([song('a'), song('b')], 9)
    expect(store.getState().index).toBe(1)
    store.getState().setQueue([song('a'), song('b')], -3)
    expect(store.getState().index).toBe(0)
  })

  it('空队列不进入播放态', () => {
    const store = createMusicPlayerStore()
    store.getState().setQueue([], 0)
    expect(store.getState().playing).toBe(false)
    expect(currentSong(store.getState())).toBeNull()
  })

  it('togglePlay / play / pause 切换播放态', () => {
    const store = createMusicPlayerStore()
    store.getState().setQueue([song('a')], 0)
    store.getState().pause()
    expect(store.getState().playing).toBe(false)
    store.getState().togglePlay()
    expect(store.getState().playing).toBe(true)
    store.getState().play()
    expect(store.getState().playing).toBe(true)
  })

  it('next / prev 在边界处不越界', () => {
    const store = createMusicPlayerStore()
    store.getState().setQueue([song('a'), song('b')], 0)
    expect(hasPrev(store.getState())).toBe(false)
    expect(hasNext(store.getState())).toBe(true)
    store.getState().next()
    expect(store.getState().index).toBe(1)
    store.getState().next() // 已是最后一首，不变
    expect(store.getState().index).toBe(1)
    store.getState().prev()
    expect(store.getState().index).toBe(0)
    store.getState().prev() // 已是第一首，不变
    expect(store.getState().index).toBe(0)
  })

  it('ended 自动跳下一首；最后一首播放完停止', () => {
    const store = createMusicPlayerStore()
    store.getState().setQueue([song('a'), song('b')], 0)
    store.getState().ended()
    expect(store.getState().index).toBe(1)
    expect(store.getState().playing).toBe(true)
    store.getState().ended()
    expect(store.getState().playing).toBe(false)
    expect(store.getState().index).toBe(1)
  })
})

describe('music-player-store · 进度与音量', () => {
  it('setProgress 更新 currentTime/duration，NaN 归零', () => {
    const store = createMusicPlayerStore()
    store.getState().setProgress(12.5, 200)
    expect(store.getState().currentTime).toBe(12.5)
    expect(store.getState().duration).toBe(200)
    store.getState().setProgress(NaN, NaN)
    expect(store.getState().currentTime).toBe(0)
    expect(store.getState().duration).toBe(0)
  })

  it('默认音量与 setVolume 夹逼到 0..1', () => {
    const store = createMusicPlayerStore()
    expect(store.getState().volume).toBe(MUSIC_DEFAULT_VOLUME)
    store.getState().setVolume(2)
    expect(store.getState().volume).toBe(1)
    store.getState().setVolume(-1)
    expect(store.getState().volume).toBe(0)
    store.getState().setVolume(0.35)
    expect(store.getState().volume).toBe(0.35)
  })
})
