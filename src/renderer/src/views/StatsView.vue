<script setup lang="ts">
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStatsStore } from '../stores/stats'

const stats = useStatsStore()
const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function render(): void {
  if (!chartEl.value) return
  if (!chart) chart = echarts.init(chartEl.value)

  const labels = stats.weekly.map((d) => d.date.slice(5)) // '11-14'
  const values = stats.weekly.map((d) => Math.round((d.seconds / 60) * 10) / 10) // 分钟，保留 1 位

  chart.setOption({
    title: { text: '近一周用时（分钟）', left: 'center', textStyle: { color: '#e8e9ed' } },
    grid: { left: 50, right: 20, top: 60, bottom: 40 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: labels,
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
        data: values,
        barMaxWidth: 48,
        itemStyle: { color: '#4f8cff', borderRadius: [6, 6, 0, 0] },
        label: { show: true, position: 'top', color: '#9a9ba3' }
      }
    ]
  })
}

function resize(): void {
  chart?.resize()
}

onMounted(() => {
  void stats.refreshWeekly().then(render)
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})

watch(() => stats.weekly, render, { deep: true })
</script>

<template>
  <div class="view">
    <h2>用时统计</h2>
    <div ref="chartEl" class="chart"></div>
  </div>
</template>
