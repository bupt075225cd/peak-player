import { describe, expect, it } from 'vitest'
import { mediaStatus, parseMediaPath, unsatisfiableHeaders } from './media-request'

describe('parseMediaPath', () => {
  it('取出解码后的绝对路径', () => {
    const filePath = '/music/专辑/01 - 开场.mp3'
    const url = 'media://play?path=' + encodeURIComponent(filePath)
    expect(parseMediaPath(url)).toBe(filePath)
  })

  // Windows 路径带盘符与反斜杠，必须原样还原
  it('还原 Windows 路径', () => {
    const filePath = 'C:\\Users\\me\\Music\\a b.flac'
    const url = 'media://play?path=' + encodeURIComponent(filePath)
    expect(parseMediaPath(url)).toBe(filePath)
  })

  it('缺少 path 参数返回 null', () => {
    expect(parseMediaPath('media://play')).toBeNull()
    expect(parseMediaPath('media://play?foo=1')).toBeNull()
  })

  it('空串返回 null', () => {
    expect(parseMediaPath('media://play?path=')).toBeNull()
  })

  it('非法 URL 返回 null 而不是抛错', () => {
    expect(parseMediaPath('not a url')).toBeNull()
    expect(parseMediaPath('')).toBeNull()
  })
})

describe('mediaStatus', () => {
  it('未请求区间时整文件 200', () => {
    expect(mediaStatus({ kind: 'full' })).toBe(200)
  })

  it('合法区间返回 206', () => {
    expect(mediaStatus({ kind: 'partial', start: 0, end: 99 })).toBe(206)
  })

  // 顺序很重要：不可满足必须在 partial 之前判定
  it('不可满足返回 416', () => {
    expect(mediaStatus({ kind: 'unsatisfiable' })).toBe(416)
  })
})

describe('unsatisfiableHeaders', () => {
  it('带 bytes */size 的 content-range', () => {
    expect(unsatisfiableHeaders(4096)).toEqual({ 'content-range': 'bytes */4096' })
    expect(unsatisfiableHeaders(0)).toEqual({ 'content-range': 'bytes */0' })
  })
})
