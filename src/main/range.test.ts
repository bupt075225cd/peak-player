import { describe, expect, it } from 'vitest'
import { fullHeaders, mimeFor, parseRange, partialHeaders } from './range'

const SIZE = 1000

describe('parseRange', () => {
  it('没有 Range 头时按整文件返回', () => {
    expect(parseRange(null, SIZE)).toEqual({ kind: 'full' })
    expect(parseRange('', SIZE)).toEqual({ kind: 'full' })
    expect(parseRange('   ', SIZE)).toEqual({ kind: 'full' })
  })

  it('bytes=0- 表示整个文件', () => {
    expect(parseRange('bytes=0-', SIZE)).toEqual({ kind: 'partial', start: 0, end: 999 })
  })

  it('bytes=N- 从 N 到结尾', () => {
    expect(parseRange('bytes=100-', SIZE)).toEqual({
      kind: 'partial',
      start: 100,
      end: 999
    })
  })

  it('bytes=0-N 截断到文件末尾', () => {
    expect(parseRange('bytes=0-99', SIZE)).toEqual({ kind: 'partial', start: 0, end: 99 })
    expect(parseRange('bytes=0-99999', SIZE)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999
    })
  })

  it('bytes=-N 取末尾 N 字节', () => {
    expect(parseRange('bytes=-500', SIZE)).toEqual({
      kind: 'partial',
      start: 500,
      end: 999
    })
    // 请求超过文件大小 → 整个文件
    expect(parseRange('bytes=-5000', SIZE)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999
    })
  })

  it('bytes=-0 视为不满足', () => {
    expect(parseRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('起点越界返回不满足（应回 416）', () => {
    expect(parseRange('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=2000-3000', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('结束位早于起始位返回不满足', () => {
    expect(parseRange('bytes=500-100', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('非法格式与多段请求降级为整文件，交给 Chromium 处理', () => {
    expect(parseRange('bytes=abc-', SIZE)).toEqual({ kind: 'full' })
    expect(parseRange('bytes=0-1,5-6', SIZE)).toEqual({ kind: 'full' })
    expect(parseRange('items=0-10', SIZE)).toEqual({ kind: 'full' })
    expect(parseRange('bytes=-', SIZE)).toEqual({ kind: 'full' })
  })

  // 回归：空文件曾算出 end = -1，产出非法 content-range
  it('空文件带 Range 时返回不满足，而不是负数区间', () => {
    expect(parseRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('空文件不带头时仍按整文件返回', () => {
    expect(parseRange(null, 0)).toEqual({ kind: 'full' })
  })

  it('首尾空白不影响解析', () => {
    expect(parseRange('  bytes=0-9  ', SIZE)).toEqual({ kind: 'partial', start: 0, end: 9 })
  })
})

describe('mimeFor', () => {
  it('常见音频扩展名映射到 audio/*', () => {
    expect(mimeFor('/music/a.mp3')).toBe('audio/mpeg')
    expect(mimeFor('/music/a.wav')).toBe('audio/wav')
    expect(mimeFor('/music/a.flac')).toBe('audio/flac')
    expect(mimeFor('/music/a.m4a')).toBe('audio/mp4')
    expect(mimeFor('/music/a.opus')).toBe('audio/ogg')
  })

  it('扩展名大小写不敏感', () => {
    expect(mimeFor('/music/A.MP3')).toBe('audio/mpeg')
    expect(mimeFor('/music/A.FlAc')).toBe('audio/flac')
  })

  it('未知或缺失扩展名回退到 octet-stream', () => {
    expect(mimeFor('/music/a.wma')).toBe('application/octet-stream')
    expect(mimeFor('/music/noext')).toBe('application/octet-stream')
  })
})

describe('响应头', () => {
  it('206 的 content-length 与 content-range 保持一致', () => {
    const headers = partialHeaders('audio/mpeg', 100, 199, SIZE)
    expect(headers['content-length']).toBe('100')
    expect(headers['content-range']).toBe('bytes 100-199/1000')
    expect(headers['accept-ranges']).toBe('bytes')
    expect(headers['content-type']).toBe('audio/mpeg')
  })

  it('200 带完整长度（缺长度会让 duration 变 Infinity）', () => {
    const headers = fullHeaders('audio/flac', SIZE)
    expect(headers['content-length']).toBe('1000')
    expect(headers['accept-ranges']).toBe('bytes')
    expect(headers['content-range']).toBeUndefined()
  })
})
