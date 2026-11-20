import { describe, expect, it } from 'vitest'
import {
  activeLineIndex,
  currentLyricText,
  LAST_LINE_FALLBACK_SECONDS,
  lineProgress,
  lyricScrollTop
} from './lyrics'

const lines = [
  { time: 5, text: '第一句' },
  { time: 10, text: '第二句' },
  { time: 20, text: '第三句' }
]

describe('activeLineIndex', () => {
  it('定位到最后一条已到时间的行', () => {
    expect(activeLineIndex(lines, 5)).toBe(0)
    expect(activeLineIndex(lines, 9.99)).toBe(0)
    expect(activeLineIndex(lines, 10)).toBe(1)
    expect(activeLineIndex(lines, 100)).toBe(2)
  })

  it('前奏返回 -1', () => {
    expect(activeLineIndex(lines, 0)).toBe(-1)
    expect(activeLineIndex(lines, 4.99)).toBe(-1)
    expect(activeLineIndex(lines, -3)).toBe(-1)
  })

  it('空歌词与非法时间返回 -1', () => {
    expect(activeLineIndex([], 5)).toBe(-1)
    expect(activeLineIndex(lines, Number.NaN)).toBe(-1)
    expect(activeLineIndex(lines, Number.POSITIVE_INFINITY)).toBe(-1)
  })

  it('重复时间戳取最后一个，避免同一时刻出现多行高亮', () => {
    const dup = [
      { time: 1, text: 'a' },
      { time: 1, text: 'b' }
    ]
    expect(activeLineIndex(dup, 1)).toBe(1)
  })
})

describe('lineProgress', () => {
  it('按下一行时间线性推进', () => {
    expect(lineProgress(lines, 0, 5)).toBe(0)
    expect(lineProgress(lines, 0, 7.5)).toBe(0.5)
    expect(lineProgress(lines, 0, 10)).toBe(1)
  })

  it('越界与非法行号返回 0', () => {
    expect(lineProgress(lines, -1, 5)).toBe(0)
    expect(lineProgress(lines, 3, 100)).toBe(0)
    expect(lineProgress([], 0, 1)).toBe(0)
  })

  it('末行用固定兜底区间，超过后钳在 1', () => {
    expect(lineProgress(lines, 2, 20)).toBe(0)
    expect(lineProgress(lines, 2, 22.5)).toBe(0.5)
    expect(lineProgress(lines, 2, 25)).toBe(1)
    expect(lineProgress(lines, 2, 999)).toBe(1)
    expect(LAST_LINE_FALLBACK_SECONDS).toBe(5)
  })

  it('同一时间戳的相邻行直接视为唱完', () => {
    const dup = [
      { time: 1, text: 'a' },
      { time: 1, text: 'b' }
    ]
    expect(lineProgress(dup, 0, 1)).toBe(1)
  })

  it('非法时间返回 0', () => {
    expect(lineProgress(lines, 0, Number.NaN)).toBe(0)
  })
})

describe('lyricScrollTop', () => {
  it('让目标行居中', () => {
    expect(lyricScrollTop(300, 40, 400)).toBe(120)
  })

  it('首行居中结果为负时归零', () => {
    expect(lyricScrollTop(0, 40, 400)).toBe(0)
  })

  it('非法输入返回 0', () => {
    expect(lyricScrollTop(Number.NaN, 40, 400)).toBe(0)
    expect(lyricScrollTop(10, Number.NaN, 400)).toBe(0)
    expect(lyricScrollTop(10, 40, Number.NaN)).toBe(0)
  })
})

describe('currentLyricText', () => {
  it('取当前行文本', () => {
    expect(currentLyricText(lines, 11)).toBe('第二句')
  })

  it('前奏返回空串', () => {
    expect(currentLyricText(lines, 1)).toBe('')
  })

  it('纯音乐空行原样返回空串', () => {
    expect(currentLyricText([{ time: 1, text: '' }], 2)).toBe('')
  })
})
