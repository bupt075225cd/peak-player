import { describe, expect, it } from 'vitest'
import {
  LOOP_LABELS,
  LOOP_MODES,
  RATE_MAX,
  RATE_MIN,
  acceptsProgress,
  clampRate,
  elapsedSeconds,
  endedAction,
  formatMediaError,
  needsVariant,
  nextLoopMode
} from './playback'

describe('clampRate', () => {
  it('范围内原样返回', () => {
    expect(clampRate(1)).toBe(1)
    expect(clampRate(0.8)).toBe(0.8)
    expect(clampRate(1.25)).toBe(1.25)
  })

  it('越界收敛到上下限', () => {
    expect(clampRate(0)).toBe(RATE_MIN)
    expect(clampRate(0.5)).toBe(RATE_MIN)
    expect(clampRate(3)).toBe(RATE_MAX)
    expect(clampRate(-1)).toBe(RATE_MIN)
  })

  // NaN 会让 Math.min/max 一路穿透，playbackRate 变 NaN 后静默失声
  it('非有限值回落到 1x', () => {
    expect(clampRate(Number.NaN)).toBe(1)
    expect(clampRate(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampRate(Number.NEGATIVE_INFINITY)).toBe(1)
  })
})

describe('needsVariant', () => {
  it('本地文件非 1x 才走 ffmpeg', () => {
    expect(needsVariant({ rate: 1.25, sourceType: 'local', variantDisabled: false })).toBe(true)
    expect(needsVariant({ rate: 1, sourceType: 'local', variantDisabled: false })).toBe(false)
  })

  it('远程源不预渲染（避免整首下载）', () => {
    expect(needsVariant({ rate: 1.25, sourceType: 'remote', variantDisabled: false })).toBe(false)
  })

  it('ffmpeg 判定不可用后不再重试', () => {
    expect(needsVariant({ rate: 1.25, sourceType: 'local', variantDisabled: true })).toBe(false)
  })
})

describe('acceptsProgress', () => {
  it('准备中且倍速匹配才采纳', () => {
    expect(acceptsProgress({ rate: 1.25, ratio: 0.4 }, { preparing: true, rate: 1.25 })).toBe(true)
  })

  it('未在准备时丢弃', () => {
    expect(acceptsProgress({ rate: 1.25, ratio: 0.4 }, { preparing: false, rate: 1.25 })).toBe(false)
  })

  // 快速连续切倍速时，上一次生成任务的进度会晚到
  it('倍速不匹配（过期任务）丢弃', () => {
    expect(acceptsProgress({ rate: 0.8, ratio: 0.9 }, { preparing: true, rate: 1.25 })).toBe(false)
  })

  it('比率非有限值丢弃', () => {
    expect(acceptsProgress({ rate: 1.25, ratio: Number.NaN }, { preparing: true, rate: 1.25 })).toBe(
      false
    )
  })
})

describe('formatMediaError', () => {
  it('带 message 时附在末尾', () => {
    expect(formatMediaError(4, 'Unsupported format')).toBe(
      '无法读取音频（code 4）：Unsupported format'
    )
  })

  it('无 message 时不出现空冒号', () => {
    expect(formatMediaError(2, '')).toBe('无法读取音频（code 2）')
  })
})

describe('elapsedSeconds', () => {
  it('向下取整到秒', () => {
    expect(elapsedSeconds(1000, 2500)).toBe(1)
    expect(elapsedSeconds(1000, 9999)).toBe(8)
    expect(elapsedSeconds(1000, 1999)).toBe(0)
  })

  it('未开始计时、时间回拨、非有限值都返回 0（不写库）', () => {
    expect(elapsedSeconds(0, 5000)).toBe(0)
    expect(elapsedSeconds(5000, 4000)).toBe(0)
    expect(elapsedSeconds(Number.NaN, 5000)).toBe(0)
    expect(elapsedSeconds(1000, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('endedAction', () => {
  it('单曲循环重播', () => {
    expect(endedAction('single')).toBe('replay')
  })

  // 顺序与列表循环都请求下一首；区别在队列层（顺序模式到末尾返回 null 即停）
  it('顺序/列表循环都交给队列切下一首', () => {
    expect(endedAction('none')).toBe('next')
    expect(endedAction('all')).toBe('next')
  })
})

describe('循环模式切换', () => {
  it('按顺序循环一圈', () => {
    expect(nextLoopMode('none')).toBe('single')
    expect(nextLoopMode('single')).toBe('all')
    expect(nextLoopMode('all')).toBe('none')
  })

  it('三种模式都有可读文案', () => {
    expect(LOOP_MODES.map((m) => LOOP_LABELS[m])).toEqual(['顺序播放', '单曲循环', '列表循环'])
  })
})
