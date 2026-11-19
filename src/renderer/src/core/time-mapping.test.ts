import { describe, expect, it } from 'vitest'
import {
  needsDurationReport,
  resolvePlaybackRate,
  toDisplayDuration,
  toDisplayTime,
  toSourceTime
} from './time-mapping'

describe('toDisplayTime / toSourceTime', () => {
  it('倍速产物：audio 时间乘 srcRate 还原成原速时间', () => {
    expect(toDisplayTime(60, 1.25)).toBeCloseTo(75, 5)
    expect(toDisplayTime(60, 1)).toBe(60)
  })

  it('seek 时反向换算，且夹到非负', () => {
    expect(toSourceTime(75, 1.25)).toBeCloseTo(60, 5)
    expect(toSourceTime(-5, 1.25)).toBe(0)
    expect(toSourceTime(60, 1)).toBe(60)
  })

  it('非法输入返回 0，不产生 NaN', () => {
    expect(toDisplayTime(Number.NaN, 1.25)).toBe(0)
    expect(toDisplayTime(60, Number.NaN)).toBe(0)
    expect(toSourceTime(Number.NaN, 1.25)).toBe(0)
    expect(toSourceTime(60, 0)).toBe(0)
  })
})

describe('toDisplayDuration', () => {
  it('变速产物换算回原速时长', () => {
    // 1.25x 产物时长 160s，对应原曲 200s
    expect(toDisplayDuration(160, 1.25)).toBeCloseTo(200, 5)
    expect(toDisplayDuration(200, 1)).toBe(200)
  })

  // Chromium 在长度未知时给 Infinity，直接写进状态会让进度条立刻异常
  it('Infinity/NaN/非正值返回 0（调用方据此跳过）', () => {
    expect(toDisplayDuration(Number.POSITIVE_INFINITY, 1)).toBe(0)
    expect(toDisplayDuration(Number.NaN, 1)).toBe(0)
    expect(toDisplayDuration(0, 1)).toBe(0)
    expect(toDisplayDuration(-3, 1)).toBe(0)
  })

  it('srcRate 非法时返回 0', () => {
    expect(toDisplayDuration(200, 0)).toBe(0)
    expect(toDisplayDuration(200, Number.NaN)).toBe(0)
  })
})

describe('needsDurationReport', () => {
  it('库里是 0（从未播放过）时上报', () => {
    expect(needsDurationReport(0, 200)).toBe(true)
  })

  it('差值在 1 秒以内不重复上报，避免刷库', () => {
    expect(needsDurationReport(200, 200.4)).toBe(false)
    expect(needsDurationReport(200, 199.2)).toBe(false)
  })

  it('差值超过 1 秒时上报（例如文件被替换）', () => {
    expect(needsDurationReport(200, 198)).toBe(true)
    expect(needsDurationReport(200, 240)).toBe(true)
  })

  it('当前时长非法时不上报', () => {
    expect(needsDurationReport(0, Number.POSITIVE_INFINITY)).toBe(false)
    expect(needsDurationReport(0, Number.NaN)).toBe(false)
    expect(needsDurationReport(0, 0)).toBe(false)
  })

  it('库里存的是 NaN 时视为需要上报', () => {
    expect(needsDurationReport(Number.NaN, 200)).toBe(true)
  })
})

describe('resolvePlaybackRate', () => {
  it('播放原文件时应用目标倍速（退回内置伸缩）', () => {
    expect(resolvePlaybackRate(1, 1.25)).toBeCloseTo(1.25, 5)
    expect(resolvePlaybackRate(1, 0.7)).toBeCloseTo(0.7, 5)
    expect(resolvePlaybackRate(1, 1)).toBe(1)
  })

  it('播放变速产物时保持 1，避免叠加成 rate × rate', () => {
    expect(resolvePlaybackRate(1.25, 1.25)).toBe(1)
    expect(resolvePlaybackRate(0.7, 0.7)).toBe(1)
  })
})
