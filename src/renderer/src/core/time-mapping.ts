// 播放器时间轴换算。srcRate 是「当前音频文件自身的倍速」：
// 播放原文件时为 1，播放 ffmpeg 变速产物时等于目标倍速。
// UI 始终展示「原速时间」，所以与 audio 元素交换数据时要乘/除 srcRate。
// 这里刻意做成零依赖纯函数，便于单测。

export function toDisplayTime(audioTime: number, srcRate: number): number {
  if (!Number.isFinite(audioTime) || !Number.isFinite(srcRate)) return 0
  return audioTime * srcRate
}

export function toSourceTime(displayTime: number, srcRate: number): number {
  if (!Number.isFinite(displayTime) || !(srcRate > 0)) return 0
  return Math.max(0, displayTime) / srcRate
}

// 换算成展示时长；Infinity/NaN/非正数一律返回 0，调用方据此跳过上报
// （加载中或长度未知时 Chromium 会给 Infinity，不能直接写进状态）
export function toDisplayDuration(audioDuration: number, srcRate: number): number {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) return 0
  if (!Number.isFinite(srcRate) || srcRate <= 0) return 0
  return audioDuration * srcRate
}

// 与库里已存时长差不到 1 秒就不重复上报，避免每次 durationchange 都写库
export function needsDurationReport(
  storedSeconds: number,
  currentSeconds: number,
  tolerance = 1
): boolean {
  if (!Number.isFinite(currentSeconds) || currentSeconds <= 0) return false
  if (!Number.isFinite(storedSeconds)) return true
  return Math.abs(storedSeconds - currentSeconds) > tolerance
}

// load() 会把 playbackRate 重置为 1；播放变速产物时不能再叠加，
// 否则会变成 rate × rate
export function resolvePlaybackRate(srcRate: number, rate: number): number {
  return srcRate === 1 ? rate : 1
}
