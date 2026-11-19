import { describe, expect, it } from 'vitest'
import { buildFilter, parseFfmpegDuration, parseProgress, progressRatio } from './ffmpeg-args'

describe('buildFilter', () => {
  // 回归：滤镜串曾漏掉 `rubberband=` 前缀，导致 ffmpeg 报
  // "No option name near '1.2500:pitch=1:...'"，变速功能 100% 失败
  it('必须以滤镜名 rubberband= 开头', () => {
    expect(buildFilter(1.25).startsWith('rubberband=')).toBe(true)
  })

  it('倍速替换为 4 位小数且不残留占位符', () => {
    const filter = buildFilter(1.25)
    expect(filter).toContain('tempo=1.2500')
    expect(filter).not.toContain('%RATE%')
    expect(buildFilter(0.7)).toContain('tempo=0.7000')
    expect(buildFilter(1.5)).toContain('tempo=1.5000')
  })

  it('保留音高与质量相关的固定参数', () => {
    const filter = buildFilter(0.8)
    expect(filter).toContain('pitch=1')
    expect(filter).toContain('formant=preserved')
    expect(filter).toContain('pitchq=quality')
    expect(filter).toContain('channels=together')
  })

  it('非法倍速回退到 1.0，不产生 NaN', () => {
    expect(buildFilter(Number.NaN)).toContain('tempo=1.0000')
    expect(buildFilter(0)).toContain('tempo=1.0000')
    expect(buildFilter(-1)).toContain('tempo=1.0000')
  })
})

describe('parseFfmpegDuration', () => {
  it('解析 mm:ss.xx', () => {
    const stderr = '  Duration: 00:03:20.05, start: 0.025057, bitrate: 192 kb/s'
    expect(parseFfmpegDuration(stderr)).toBeCloseTo(200.05, 2)
  })

  it('解析带小时的时长', () => {
    expect(parseFfmpegDuration('Duration: 01:02:03.00, start: 0.0')).toBe(3723)
  })

  it('解析不到或全零时返回 0', () => {
    expect(parseFfmpegDuration('Duration: N/A, bitrate: N/A')).toBe(0)
    expect(parseFfmpegDuration('')).toBe(0)
    expect(parseFfmpegDuration('Duration: 00:00:00.00, start: 0.0')).toBe(0)
  })
})

describe('parseProgress', () => {
  it('识别 out_time_us（微秒）', () => {
    expect(parseProgress('out_time_us=1000000\nprogress=continue')).toBe(1)
    expect(parseProgress('out_time_us=4500000')).toBe(4.5)
  })

  it('识别 out_time_ms（历史上同样按微秒输出）', () => {
    expect(parseProgress('out_time_ms=2500000')).toBe(2.5)
  })

  it('无进度或不可解析时返回 null', () => {
    expect(parseProgress('frame=120')).toBeNull()
    expect(parseProgress('out_time_us=N/A')).toBeNull()
  })
})

describe('progressRatio', () => {
  it('以「源时长 / rate」为分母', () => {
    // 200s 源文件按 1.25x 输出约 160s，跑到 80s 应是一半
    expect(progressRatio(80, 200, 1.25)).toBeCloseTo(0.5, 5)
  })

  it('上限压到 0.99，1 只由正常退出给出', () => {
    expect(progressRatio(160, 200, 1.25)).toBe(0.99)
    expect(progressRatio(500, 200, 1.25)).toBe(0.99)
  })

  it('非法输入返回 null', () => {
    expect(progressRatio(10, 0, 1.25)).toBeNull()
    expect(progressRatio(10, 200, 0)).toBeNull()
    expect(progressRatio(Number.NaN, 200, 1.25)).toBeNull()
  })
})
