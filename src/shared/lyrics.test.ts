import { describe, expect, it } from 'vitest'
import { emptyLyrics, parseLrc, parseTimestamp } from './lyrics'

describe('parseTimestamp', () => {
  it('整秒与毫秒按位补齐', () => {
    expect(parseTimestamp('00', '12')).toBe(12)
    expect(parseTimestamp('01', '05')).toBe(65)
    expect(parseTimestamp('00', '12', '5')).toBe(12.5)
    expect(parseTimestamp('00', '12', '05')).toBe(12.05)
    expect(parseTimestamp('00', '12', '345')).toBe(12.345)
  })

  it('超过 3 位小数截断到毫秒', () => {
    expect(parseTimestamp('00', '12', '3456')).toBe(12.345)
  })

  it('分钟超过 3 位（超出正则）或非数字时返回 NaN', () => {
    expect(parseTimestamp('abc', '12')).toBeNaN()
    expect(parseTimestamp('00', 'x')).toBeNaN()
    expect(parseTimestamp('00', '12', 'x')).toBeNaN()
  })
})

describe('parseLrc', () => {
  it('解析、排序并去掉首尾空白', () => {
    const { lines } = parseLrc(['[00:20.50] 第二句 ', '[00:10.00]第一句'].join('\n'))

    expect(lines).toEqual([
      { time: 10, text: '第一句' },
      { time: 20.5, text: '第二句' }
    ])
  })

  it('一行多个时间戳展开成多行', () => {
    const { lines } = parseLrc('[00:10.00][01:20.00]副歌')

    expect(lines.map((l) => l.time)).toEqual([10, 80])
    expect(lines.every((l) => l.text === '副歌')).toBe(true)
  })

  it('保留纯音乐空行（只写时间戳的行）', () => {
    const { lines } = parseLrc('[00:05.00]\n[00:08.00]开口')

    expect(lines).toEqual([
      { time: 5, text: '' },
      { time: 8, text: '开口' }
    ])
  })

  it('同时间戳的两行合并为原文 + 译文', () => {
    const { lines } = parseLrc('[00:10.00]Hello\n[00:10.02]你好')

    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({ time: 10, text: 'Hello', translation: '你好' })
  })

  it('同时间戳多行译文用换行拼接', () => {
    const { lines } = parseLrc('[00:10.00]Hello\n[00:10.00]你好\n[00:10.00]こんにちは')

    expect(lines[0]?.translation).toBe('你好\nこんにちは')
  })

  it('同时间戳的重复文本与空行不产生多余内容', () => {
    const { lines } = parseLrc('[00:10.00]\n[00:10.00]副歌\n[00:10.00]副歌\n[00:10.00]')

    expect(lines).toEqual([{ time: 10, text: '副歌' }])
  })

  it('offset 正数延后、负数提前', () => {
    expect(parseLrc('[offset:+500]\n[00:10.00]a').lines[0]?.time).toBe(10.5)
    expect(parseLrc('[offset:-500]\n[00:10.00]a').lines[0]?.time).toBe(9.5)
    expect(parseLrc('[offset:abc]\n[00:10.00]a').lines[0]?.time).toBe(10)
  })

  it('offset 写在时间戳之后仍然生效', () => {
    const { lines, offset } = parseLrc('[00:10.00]a\n[offset:+1000]')

    expect(offset).toBe(1)
    expect(lines[0]?.time).toBe(11)
  })

  it('忽略元信息行与不含时间戳的正文', () => {
    const { lines } = parseLrc('[ti:标题]\n[ar:歌手]\n[al:专辑]\n这是一段说明\n[00:01.00]真歌词')

    expect(lines).toEqual([{ time: 1, text: '真歌词' }])
  })

  it('时间戳不在行首时整行丢弃', () => {
    const { lines } = parseLrc('前面有字[00:10.00]不算数\n[00:12.00]算数')

    expect(lines).toEqual([{ time: 12, text: '算数' }])
  })

  it('空内容与无时间戳内容返回空结果', () => {
    expect(parseLrc('')).toEqual({ lines: [], offset: 0 })
    expect(parseLrc(null as unknown as string)).toEqual({ lines: [], offset: 0 })
    expect(parseLrc('   \n\n')).toEqual({ lines: [], offset: 0 })
    expect(parseLrc('没有时间戳的歌词')).toEqual({ lines: [], offset: 0 })
    expect(parseLrc('[offset:+500]')).toEqual({ lines: [], offset: 0.5 })
  })

  it('空歌词文档的默认结构', () => {
    expect(emptyLyrics()).toEqual({ lines: [], offset: 0, source: 'none' })
  })

  it('兼容 CRLF 与毫秒精度，不产生浮点尾差', () => {
    const { lines } = parseLrc('[00:01.10]a\r\n[00:01.20]b\r\n')

    expect(lines[0]?.time).toBe(1.1)
    expect(lines[1]?.time).toBe(1.2)
  })
})
