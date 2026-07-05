import { describe, expect, it, vi } from 'vitest'
import type { Claude360Song } from '@shared/claude360-music'
import { revokeMusicSongObjectUrls, type PlaybackSource } from './music-object-url-cache'

function song(id: string, overrides: Partial<Claude360Song> = {}): Claude360Song {
  return {
    id,
    title: id,
    audioUrl: `https://cdn/${id}.mp3`,
    imageUrl: `https://cdn/${id}.jpg`,
    ...overrides
  }
}

describe('revokeMusicSongObjectUrls', () => {
  it('按 songId 清理本地音频、封面和当前播放 objectURL', () => {
    const localAudioObjectUrls = new Map([['assets/music/a.mp3', 'blob:audio-a']])
    const coverObjectUrls = new Map([['https://cdn/a.jpg', 'blob:cover-a']])
    const revokeObjectUrl = vi.fn()
    const playbackSource: PlaybackSource = {
      songId: 'a',
      url: 'blob:audio-a'
    }

    const nextPlayback = revokeMusicSongObjectUrls(['a'], {
      tasks: [{ songs: [song('a')] }],
      songAssets: { a: { localAudioPath: 'assets/music/a.mp3', localCoverPath: 'assets/covers/a.jpg' } },
      localAudioObjectUrls,
      coverObjectUrls,
      playbackSource,
      revokeObjectUrl
    })

    expect(nextPlayback).toBeNull()
    expect(localAudioObjectUrls.has('assets/music/a.mp3')).toBe(false)
    expect(coverObjectUrls.has('https://cdn/a.jpg')).toBe(false)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:audio-a')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-a')
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2)
  })

  it('保留未删除歌曲的当前播放引用', () => {
    const playbackSource: PlaybackSource = {
      songId: 'keep',
      url: 'https://cdn/keep.mp3'
    }
    const nextPlayback = revokeMusicSongObjectUrls(['other'], {
      tasks: [{ songs: [song('keep'), song('other')] }],
      songAssets: {},
      localAudioObjectUrls: new Map(),
      coverObjectUrls: new Map(),
      playbackSource,
      revokeObjectUrl: vi.fn()
    })

    expect(nextPlayback).toBe(playbackSource)
  })
})
