// 播放引擎里的决策逻辑：倍速钳制、是否走 ffmpeg、进度是否采纳、
// 计时结算、结束后的动作。刻意不依赖 Audio / vue，便于单测。

import type { LoopMode, SourceType } from '../../../shared/types'

export const RATE_MIN = 0.7
export const RATE_MAX = 1.5

// 播放条与全屏歌词页共用的倍速选项，避免两处各写一份后漂移
export const RATE_OPTIONS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5] as const

export const LOOP_MODES: readonly LoopMode[] = ['none', 'single', 'all']

export const LOOP_LABELS: Record<LoopMode, string> = {
  none: '顺序播放',
  single: '单曲循环',
  all: '列表循环'
}

// 循环切换顺序：顺序 → 单曲 → 列表 → 顺序
export function nextLoopMode(mode: LoopMode): LoopMode {
  const index = LOOP_MODES.indexOf(mode)
  return LOOP_MODES[(index + 1) % LOOP_MODES.length]
}

// 越界与非数字都收敛到合法范围；NaN 会让 Math.min/max 一路穿透，
// 直接用会让 playbackRate 变成 NaN 而静默失声
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate))
}

// 是否需要让 ffmpeg 预渲染变速文件：1x、远程源、以及已判定 ffmpeg 不可用时
// 都直接播放原文件（最后一种在播放时用 Chromium 内置伸缩兜底）
export function needsVariant(opts: {
  rate: number
  sourceType: SourceType
  variantDisabled: boolean
}): boolean {
  if (opts.variantDisabled) return false
  if (opts.sourceType === 'remote') return false
  return opts.rate !== 1
}

// 采纳主进程推来的转码进度：必须是「正在为当前倍速生成」，
// 且比率是有限值，否则进度条会跳成 NaN%
export function acceptsProgress(
  progress: { rate: number; ratio: number },
  state: { preparing: boolean; rate: number }
): boolean {
  if (!state.preparing) return false
  if (progress.rate !== state.rate) return false
  return Number.isFinite(progress.ratio)
}

// 媒体元素加载失败时给界面的文案
export function formatMediaError(code: number, message: string): string {
  return `无法读取音频（code ${code}）${message ? '：' + message : ''}`
}

// 距上次结算过了多少整秒；未开始计时或时间回拨都返回 0
export function elapsedSeconds(startTime: number, now: number): number {
  if (!Number.isFinite(startTime) || !Number.isFinite(now) || startTime <= 0) return 0
  const seconds = Math.floor((now - startTime) / 1000)
  return seconds > 0 ? seconds : 0
}

// `ended` 之后做什么：单曲循环重播；顺序与列表循环都交给队列切下一首。
// 两者的差别在队列层：顺序模式播到末尾就停，列表循环回绕到第一首。
export function endedAction(loopMode: LoopMode): 'replay' | 'next' {
  return loopMode === 'single' ? 'replay' : 'next'
}
