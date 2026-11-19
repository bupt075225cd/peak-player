import type { Track } from '../shared/types'

// 依赖注入：ipc.ts 传入真实实现，单测传入桩对象，
// 这样这段「改次数前补采时长」的逻辑不依赖 electron。
export interface DurationDeps {
  getTrack: (id: string) => Track | undefined
  probeAudioDuration: (path: string) => Promise<number>
  setTrackDuration: (id: string, seconds: number) => void
}

// duration 未知时用 ffmpeg 补采一次，返回写入的秒数；已有值或探测失败返回 0。
// 老库（升级前入库、从未播放过）的 duration 为 0，不补采的话
// 「改次数」按 0 秒换算，用时统计不会变化。
export async function ensureTrackDuration(id: string, deps: DurationDeps): Promise<number> {
  const track = deps.getTrack(id)
  if (!track) return 0
  if (track.duration > 0) return 0

  let seconds = 0
  try {
    seconds = await deps.probeAudioDuration(track.path)
  } catch {
    // 探测失败不能影响「改次数」本身，否则用户改不动次数
    return 0
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return 0

  deps.setTrackDuration(id, seconds)
  return seconds
}
