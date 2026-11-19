import { describe, expect, it } from 'vitest'
import { buildWeeklyChartOption, toMinutes, toShortDate, toWeeklySeries } from './chart'

describe('toShortDate', () => {
  it('去掉年份', () => {
    expect(toShortDate('2026-11-14')).toBe('11-14')
    expect(toShortDate('2026-01-05')).toBe('01-05')
  })

  it('格式不符时原样返回', () => {
    expect(toShortDate('2026-1-5')).toBe('2026-1-5')
    expect(toShortDate('')).toBe('')
    expect(toShortDate('2026/11/14')).toBe('2026/11/14')
  })
})

describe('toMinutes', () => {
  it('秒换算成分钟并保留 1 位小数', () => {
    expect(toMinutes(60)).toBe(1)
    expect(toMinutes(90)).toBe(1.5)
    expect(toMinutes(7325)).toBe(122.1)
    expect(toMinutes(59)).toBe(1)
  })

  it('0、负数、非有限值都按 0 处理', () => {
    expect(toMinutes(0)).toBe(0)
    expect(toMinutes(-30)).toBe(0)
    expect(toMinutes(Number.NaN)).toBe(0)
    expect(toMinutes(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('toWeeklySeries', () => {
  it('一次遍历同时给出 labels 与 values', () => {
    const series = toWeeklySeries([
      { date: '2026-11-12', seconds: 600 },
      { date: '2026-11-13', seconds: 0 },
      { date: '2026-11-14', seconds: 3600 }
    ])
    expect(series.labels).toEqual(['11-12', '11-13', '11-14'])
    expect(series.values).toEqual([10, 0, 60])
  })

  it('空数据返回空数组', () => {
    expect(toWeeklySeries([])).toEqual({ labels: [], values: [] })
  })
})

describe('buildWeeklyChartOption', () => {
  const option = buildWeeklyChartOption({ labels: ['11-13', '11-14'], values: [12.5, 60] })
  const xAxis = option.xAxis as { data: string[] }
  const yAxis = option.yAxis as { name: string }
  const series = (option.series as { data: number[]; type: string }[])[0]

  it('x 轴放日期、y 轴单位是分钟', () => {
    expect(xAxis.data).toEqual(['11-13', '11-14'])
    expect(yAxis.name).toBe('分钟')
  })

  it('单条柱状系列，数据来自整形结果', () => {
    expect(option.series).toHaveLength(1)
    expect(series.type).toBe('bar')
    expect(series.data).toEqual([12.5, 60])
  })
})
