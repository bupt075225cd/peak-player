// 用时统计图的数据整形与 option 构造：从 StatsView 里抽出来，
// 不依赖 echarts / DOM，便于单测。

import type { DailyUsage } from '../../../shared/types'

export interface WeeklySeries {
  labels: string[]
  values: number[]
}

// 'YYYY-MM-DD' → 'MM-DD'；格式不符时原样返回，避免把 '2026-1-5' 切成 '1-5'
export function toShortDate(date: string): string {
  const matched = /^\d{4}-(\d{2})-(\d{2})/.exec(date)
  return matched ? `${matched[1]}-${matched[2]}` : date
}

// 秒 → 分钟，保留 1 位小数；非法/负数按 0 处理，避免图上出现 NaN 柱
export function toMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round((seconds / 60) * 10) / 10
}

export function toWeeklySeries(weekly: DailyUsage[]): WeeklySeries {
  return {
    labels: weekly.map((d) => toShortDate(d.date)),
    values: weekly.map((d) => toMinutes(d.seconds))
  }
}

export function buildWeeklyChartOption(series: WeeklySeries): Record<string, unknown> {
  return {
    title: { text: '近一周用时（分钟）', left: 'center', textStyle: { color: '#e8e9ed' } },
    grid: { left: 50, right: 20, top: 60, bottom: 40 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: series.labels,
      axisLabel: { color: '#9a9ba3' },
      axisLine: { lineStyle: { color: '#3a3b42' } }
    },
    yAxis: {
      type: 'value',
      name: '分钟',
      nameTextStyle: { color: '#9a9ba3' },
      axisLabel: { color: '#9a9ba3' },
      splitLine: { lineStyle: { color: '#3a3b42' } }
    },
    series: [
      {
        type: 'bar',
        data: series.values,
        barMaxWidth: 48,
        itemStyle: { color: '#4f8cff', borderRadius: [6, 6, 0, 0] },
        label: { show: true, position: 'top', color: '#9a9ba3' }
      }
    ]
  }
}
