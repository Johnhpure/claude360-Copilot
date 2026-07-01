// 音乐播放器 store（阶段2：队列 / 进度 / 音量）。
//
// 迁移自 claude360-music-web src/store/player.ts 的状态机，扩展音量 + seek 语义。
// 纯状态：queue/index/playing/currentTime/duration/volume + reducers；current 由
// queue[index] 派生。音频副作用（play/pause/seek/volume）由容器把 store 状态桥接到
// <audio> 元素，store 本身不触碰 DOM，便于 node 纯函数单测。
import { create, type StoreApi } from 'zustand'
import type { Claude360Song } from '@shared/claude360-music'

export const MUSIC_DEFAULT_VOLUME = 0.8

export interface MusicPlayerState {
  queue: Claude360Song[]
  index: number
  playing: boolean
  currentTime: number
  duration: number
  volume: number // 0–1
  // actions
  setQueue: (queue: Claude360Song[], startIndex: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void
  next: () => void
  prev: () => void
  ended: () => void
  setProgress: (currentTime: number, duration: number) => void
  setVolume: (volume: number) => void
}

/** 当前歌曲（queue[index]，越界返回 null）。 */
export function currentSong(state: Pick<MusicPlayerState, 'queue' | 'index'>): Claude360Song | null {
  return state.queue[state.index] ?? null
}

/** 是否有上一首 / 下一首（供播放器按钮禁用态）。 */
export function hasPrev(state: Pick<MusicPlayerState, 'index'>): boolean {
  return state.index > 0
}
export function hasNext(state: Pick<MusicPlayerState, 'queue' | 'index'>): boolean {
  return state.index < state.queue.length - 1
}

const clampVolume = (v: number): number => {
  if (!Number.isFinite(v)) return MUSIC_DEFAULT_VOLUME
  return Math.max(0, Math.min(1, v))
}
const clampIndex = (i: number, len: number): number => {
  if (len <= 0) return 0
  return Math.max(0, Math.min(i, len - 1))
}

/** 创建独立播放器 store 实例（测试用隔离实例；应用侧用单例 useMusicPlayerStore）。 */
export function createMusicPlayerStore(): StoreApi<MusicPlayerState> {
  return create<MusicPlayerState>((set) => ({
    queue: [],
    index: 0,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: MUSIC_DEFAULT_VOLUME,
    setQueue: (queue, startIndex) =>
      set({
        queue,
        index: clampIndex(startIndex, queue.length),
        playing: queue.length > 0,
        currentTime: 0,
        duration: 0
      }),
    play: () => set({ playing: true }),
    pause: () => set({ playing: false }),
    togglePlay: () => set((s) => ({ playing: !s.playing })),
    next: () => set((s) => (hasNext(s) ? { index: s.index + 1, playing: true, currentTime: 0 } : s)),
    prev: () => set((s) => (hasPrev(s) ? { index: s.index - 1, playing: true, currentTime: 0 } : s)),
    // 播放完自动跳下一首；已是最后一首则停止。
    ended: () =>
      set((s) => (hasNext(s) ? { index: s.index + 1, playing: true, currentTime: 0 } : { playing: false })),
    setProgress: (currentTime, duration) =>
      set({
        currentTime: Number.isFinite(currentTime) ? currentTime : 0,
        duration: Number.isFinite(duration) ? duration : 0
      }),
    setVolume: (volume) => set({ volume: clampVolume(volume) })
  }))
}

/** 应用单例。 */
export const useMusicPlayerStore = createMusicPlayerStore()
