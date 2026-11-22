import type { Track } from '../../../shared/types'

// 播放列表内「上一首 / 下一首」的目标曲目。
// 手动点按钮时首尾相接（wrap 默认开启）；
// 自动续播传 wrap: false，顺序模式播到末尾就停下。
// 未在播放（currentId 为空或已不在列表里）时，下一首从头开始、上一首从尾部开始。
export function neighborTrack(
  tracks: Track[],
  currentId: string | undefined,
  dir: 1 | -1,
  opts: { wrap?: boolean } = {}
): Track | null {
  if (tracks.length === 0) return null

  const index = currentId === undefined ? -1 : tracks.findIndex((t) => t.id === currentId)
  if (index < 0) return dir === 1 ? tracks[0] : tracks[tracks.length - 1]

  const target = index + dir
  if (target < 0 || target >= tracks.length) {
    if (opts.wrap === false) return null
    return tracks[(target + tracks.length) % tracks.length]
  }
  return tracks[target]
}
