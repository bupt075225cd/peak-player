import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatRateLabel,
  formatSpokenDuration,
  parseCountInput,
  progressPercent,
  resolveCountChange
} from './format'

describe('formatClock', () => {
  it('常规值补零', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(59.9)).toBe('0:59')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(125)).toBe('2:05')
    expect(formatClock(3600)).toBe('60:00')
  })

  // 加载中 Chromium 会给 Infinity/NaN，不能显示成 NaN:NaN
  it('非有限值与负数回落 0:00', () => {
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('formatSpokenDuration', () => {
  it('不足一小时按分钟', () => {
    expect(formatSpokenDuration(0)).toBe('0 分钟')
    expect(formatSpokenDuration(59)).toBe('0 分钟')
    expect(formatSpokenDuration(600)).toBe('10 分钟')
    expect(formatSpokenDuration(3599)).toBe('59 分钟')
  })

  it('超过一小时带上小时', () => {
    expect(formatSpokenDuration(3600)).toBe('1 小时 0 分')
    expect(formatSpokenDuration(5400)).toBe('1 小时 30 分')
    expect(formatSpokenDuration(7325)).toBe('2 小时 2 分')
  })

  it('非法值回落 0 分钟', () => {
    expect(formatSpokenDuration(Number.NaN)).toBe('0 分钟')
    expect(formatSpokenDuration(-1)).toBe('0 分钟')
  })
})

describe('parseCountInput', () => {
  it('数字与数字字符串都能解析', () => {
    expect(parseCountInput(3)).toBe(3)
    expect(parseCountInput('3')).toBe(3)
    expect(parseCountInput(' 42 ')).toBe(42)
  })

  it('空值返回 null（表示取消编辑）', () => {
    expect(parseCountInput('')).toBeNull()
    expect(parseCountInput('   ')).toBeNull()
    expect(parseCountInput(null)).toBeNull()
    expect(parseCountInput(undefined)).toBeNull()
  })

  it('非数字返回 null', () => {
    expect(parseCountInput('abc')).toBeNull()
    expect(parseCountInput(Number.NaN)).toBeNull()
    expect(parseCountInput(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('小数原样返回，由 resolveCountChange 决定是否接受', () => {
    expect(parseCountInput('3.5')).toBe(3.5)
    expect(parseCountInput('-1')).toBe(-1)
  })
})

describe('formatRateLabel', () => {
  it('固定两位小数并带 x', () => {
    expect(formatRateLabel(1)).toBe('1.00x')
    expect(formatRateLabel(0.7)).toBe('0.70x')
    expect(formatRateLabel(1.25)).toBe('1.25x')
  })

  // 下拉项来自静态数组，但状态可能被 IPC 改坏，兜底避免渲染出 NaNx
  it('非有限值回落 1.00x', () => {
    expect(formatRateLabel(Number.NaN)).toBe('1.00x')
    expect(formatRateLabel(Number.POSITIVE_INFINITY)).toBe('1.00x')
  })
})

describe('progressPercent', () => {
  it('比率换算成整数百分比', () => {
    expect(progressPercent(0)).toBe(0)
    expect(progressPercent(0.333)).toBe(33)
    expect(progressPercent(0.5)).toBe(50)
    expect(progressPercent(1)).toBe(100)
  })

  it('越界夹在 0~100', () => {
    expect(progressPercent(-0.2)).toBe(0)
    expect(progressPercent(1.5)).toBe(100)
  })

  it('非有限值回落 0', () => {
    expect(progressPercent(Number.NaN)).toBe(0)
    expect(progressPercent(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('resolveCountChange', () => {
  it('合法的新值原样返回', () => {
    expect(resolveCountChange(2, 5)).toBe(5)
    expect(resolveCountChange(5, 0)).toBe(0)
  })

  it('非整数/负数/未变化都不提交', () => {
    expect(resolveCountChange(2, 3.5)).toBeNull()
    expect(resolveCountChange(2, -1)).toBeNull()
    expect(resolveCountChange(2, 2)).toBeNull()
  })

  it('解析失败（null）不提交', () => {
    expect(resolveCountChange(2, null)).toBeNull()
  })
})
