<script setup lang="ts">
import { computed } from 'vue'
import { player, playerState } from '../core/player'
import { formatClock, formatRateLabel, progressPercent } from '../utils/format'

const rateOptions = [0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5]

const loopOrder = ['none', 'single', 'all'] as const
const loopLabels: Record<string, string> = {
  none: '顺序播放',
  single: '单曲循环',
  all: '列表循环'
}

const title = computed(() => playerState.current?.title ?? '未在播放')
const loopLabel = computed(() => loopLabels[playerState.loopMode])

function setRate(e: Event): void {
  void player.setRate(Number((e.target as HTMLSelectElement).value))
}

function cycleLoop(): void {
  const idx = loopOrder.indexOf(playerState.loopMode)
  player.loopMode = loopOrder[(idx + 1) % loopOrder.length]
}

const fmt = formatClock
</script>

<template>
  <div class="player-bar">
    <div class="title" :title="title">{{ title }}</div>
    <button class="ghost" @click="player.toggle()">
      {{ playerState.playing ? '暂停' : '播放' }}
    </button>
    <button class="ghost" @click="cycleLoop()">{{ loopLabel }}</button>
    <label class="rate">
      倍速
      <select :value="playerState.rate" @change="setRate">
        <option v-for="r in rateOptions" :key="r" :value="r">{{ formatRateLabel(r) }}</option>
      </select>
    </label>
    <span v-if="playerState.preparing" class="prep">
      正在生成 {{ playerState.rate }}x 音频 {{ progressPercent(playerState.progress) }}%
    </span>
    <span v-if="playerState.error" class="error" :title="playerState.error">
      {{ playerState.error }}
    </span>
    <div class="time">{{ fmt(playerState.currentTime) }} / {{ fmt(playerState.duration) }}</div>
  </div>
</template>
