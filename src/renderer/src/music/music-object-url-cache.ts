import type { Claude360Song } from '@shared/claude360-music'
import type { MusicGenTask, SongAssetInfo } from './music-task-store'

export type PlaybackSource = {
  songId: string
  url: string
  objectUrl?: string
}

type RevokeMusicSongObjectUrlsOptions = {
  tasks: Pick<MusicGenTask, 'songs'>[]
  songAssets: Record<string, SongAssetInfo>
  localAudioObjectUrls: Map<string, string>
  coverObjectUrls: Map<string, string>
  playbackSource: PlaybackSource | null
  revokeObjectUrl: (url: string) => void
}

function findSong(tasks: Pick<MusicGenTask, 'songs'>[], songId: string): Claude360Song | undefined {
  for (const task of tasks) {
    const song = task.songs.find((item) => item.id === songId)
    if (song) return song
  }
  return undefined
}

export function revokeMusicSongObjectUrls(
  songIds: string[],
  options: RevokeMusicSongObjectUrlsOptions
): PlaybackSource | null {
  const ids = new Set(songIds)
  if (ids.size === 0) return options.playbackSource

  const revoked = new Set<string>()
  const revokeOnce = (url: string | undefined): void => {
    if (!url || revoked.has(url)) return
    options.revokeObjectUrl(url)
    revoked.add(url)
  }

  for (const songId of ids) {
    const localAudioPath = options.songAssets[songId]?.localAudioPath
    if (localAudioPath) {
      const objectUrl = options.localAudioObjectUrls.get(localAudioPath)
      revokeOnce(objectUrl)
      options.localAudioObjectUrls.delete(localAudioPath)
    }

    const coverUrl = findSong(options.tasks, songId)?.imageUrl?.trim()
    if (coverUrl) {
      const objectUrl = options.coverObjectUrls.get(coverUrl)
      revokeOnce(objectUrl)
      options.coverObjectUrls.delete(coverUrl)
    }
  }

  const playback = options.playbackSource
  if (!playback || !ids.has(playback.songId)) return playback
  revokeOnce(playback.objectUrl)
  if (playback.url.startsWith('blob:')) revokeOnce(playback.url)
  return null
}
