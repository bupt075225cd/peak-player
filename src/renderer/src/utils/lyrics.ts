// 歌词展示的纯计算：当前行定位、行内进度、居中滚动位置。
// 与组件解耦，边界（前奏、重复时间戳、末行、非法时间）全部由单测固定。
import type { LyricLine } from '../../../shared/types'

// 最后一行没有「下一行」可用，用固定 5 秒兜底推算扫光进度
export const LAST_LINE_FALLBACK_SECONDS = 5

// 最后一个 time <= 当前时间的行号；早于第一行（前奏）返回 -1
export function activeLineIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1
  if (!Number.isFinite(time)) return -1
  if (time < lines[0].time) return -1

  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= time) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

// 当前行已唱进度 0~1：从本行时间走到下一行时间
export function lineProgress(lines: LyricLine[], index: number, time: number): number {
  if (index < 0 || index >= lines.length) return 0
  if (!Number.isFinite(time)) return 0

  const start = lines[index].time
  const next = lines[index + 1]?.time ?? start + LAST_LINE_FALLBACK_SECONDS
  const span = next - start
  // 同时间戳的相邻行没有可分配区间，直接视为已唱完
  if (!(span > 0)) return 1

  const ratio = (time - start) / span
  if (ratio <= 0) return 0
  return ratio >= 1 ? 1 : ratio
}

// 让某一行垂直居中所需的 scrollTop；不足一屏时归零，避免负值
export function lyricScrollTop(
  lineTop: number,
  lineHeight: number,
  viewportHeight: number
): number {
  if (!Number.isFinite(lineTop) || !Number.isFinite(lineHeight)) return 0
  if (!Number.isFinite(viewportHeight)) return 0
  const top = lineTop + lineHeight / 2 - viewportHeight / 2
  return top > 0 ? top : 0
}

// 播放条上单行歌词：前奏或空行返回空串，由组件决定是否占位
export function currentLyricText(lines: LyricLine[], time: number): string {
  const index = activeLineIndex(lines, time)
  if (index < 0) return ''
  return lines[index].text
}
