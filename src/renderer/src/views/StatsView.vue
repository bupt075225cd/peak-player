<script setup lang="ts">
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStatsStore } from '../stores/stats'
import { buildWeeklyChartOption, toWeeklySeries } from '../utils/chart'

const stats = useStatsStore()
const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

function render(): void {
  if (!chartEl.value) return
  if (!chart) chart = echarts.init(chartEl.value)
  chart.setOption(buildWeeklyChartOption(toWeeklySeries(stats.weekly)) as echarts.EChartsOption)
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
