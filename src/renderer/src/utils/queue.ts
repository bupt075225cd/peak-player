import type { Track } from '../../../shared/types'

// 播放列表内「上一首 / 下一首」的目标曲目。
// 首尾相接：最后一首的下一首是第一首，第一首的上一首是最后一首。
// 未在播放（currentId 为空或已不在列表里）时，下一首从头开始、上一首从尾部开始。
export function neighborTrack(
  tracks: Track[],
  currentId: string | undefined,
  dir: 1 | -1
): Track | null {
  if (tracks.length === 0) return null

  const index = currentId === undefined ? -1 : tracks.findIndex((t) => t.id === currentId)
  if (index < 0) return dir === 1 ? tracks[0] : tracks[tracks.length - 1]

  return tracks[(index + dir + tracks.length) % tracks.length]
}
