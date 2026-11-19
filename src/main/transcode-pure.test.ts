import { describe, expect, it } from 'vitest'
import {
  appendCapped,
  buildTranscodeArgs,
  formatExitError,
  formatSpawnError,
  formatTranscodeLog,
  isUsableVariant
} from './transcode-pure'

describe('isUsableVariant', () => {
  it('非空文件才算可用', () => {
    expect(isUsableVariant(1)).toBe(true)
    expect(isUsableVariant(1024)).toBe(true)
  })

  it('0 字节、缺失、非法值都不可用', () => {
    expect(isUsableVariant(0)).toBe(false)
    expect(isUsableVariant(null)).toBe(false)
    expect(isUsableVariant(undefined)).toBe(false)
    expect(isUsableVariant(Number.NaN)).toBe(false)
  })
})

describe('buildTranscodeArgs', () => {
  const args = buildTranscodeArgs('/in/a.mp3', 'rubberband=tempo=1.25', '/out.v.flac')

  it('输入、滤镜、输出按顺序就位', () => {
    expect(args.slice(args.indexOf('-i'))).toEqual([
      '-i',
      '/in/a.mp3',
      '-vn',
      '-filter:a',
      'rubberband=tempo=1.25',
      '-c:a',
      'flac',
      '-compression_level',
      '5',
      '-progress',
      'pipe:1',
      '-nostats',
      '/out.v.flac'
    ])
  })

  it('覆盖输出且不解析统计信息', () => {
    expect(args).toContain('-y')
    expect(args).toContain('-nostats')
    expect(args.indexOf('-progress')).toBeLessThan(args.indexOf('pipe:1'))
  })
})

describe('appendCapped', () => {
  it('未超限时直接拼接', () => {
    expect(appendCapped('ab', 'cd', 10)).toBe('abcd')
  })

  it('超限后只保留尾部', () => {
    expect(appendCapped('abc', 'def', 4)).toBe('cdef')
    expect(appendCapped('abc', 'def', 6)).toBe('abcdef')
  })
})

describe('formatSpawnError', () => {
  it('附上原因', () => {
    expect(formatSpawnError('ENOENT')).toBe('无法启动 ffmpeg：ENOENT')
  })
})

describe('formatExitError', () => {
  it('带退出码与 stderr 尾部', () => {
    expect(formatExitError(1, '  boom  ')).toBe('ffmpeg 退出码 1：boom')
    expect(formatExitError(null, '')).toBe('ffmpeg 退出码 null：')
  })

  // 整首解码日志可能有几百 KB，塞进错误信息会撑爆 IPC
  it('stderr 只保留末尾 400 字符', () => {
    const long = 'x'.repeat(1000) + 'TAIL'
    const message = formatExitError(1, long)
    expect(message.endsWith('TAIL')).toBe(true)
    expect(message.length).toBe('ffmpeg 退出码 1：'.length + 400)
  })
})

describe('formatTranscodeLog', () => {
  it('成功与失败用不同前缀，便于 grep', () => {
    expect(formatTranscodeLog(true, 1.25, '320ms /out.flac')).toBe('ok   rate=1.25 320ms /out.flac')
    expect(formatTranscodeLog(false, 0.8, ':: boom')).toBe('fail rate=0.8 :: boom')
  })
})
