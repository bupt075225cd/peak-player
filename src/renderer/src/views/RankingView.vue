<script setup lang="ts">
import type { Track } from '../../../shared/types'
import { player } from '../core/player'
import { useStatsStore } from '../stores/stats'

const stats = useStatsStore()

function play(track: Track): void {
  void player.play(track)
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h} 小时 ${m} 分`
  return `${m} 分钟`
}
</script>

<template>
  <div class="view">
    <div class="toolbar">
      <h2>排行榜</h2>
      <div class="tabs">
        <button
          :class="{ active: stats.rankingBy === 'count' }"
          @click="stats.setRankingBy('count')"
        >
          按次数
        </button>
        <button
          :class="{ active: stats.rankingBy === 'duration' }"
          @click="stats.setRankingBy('duration')"
        >
          按时长
        </button>
      </div>
    </div>

    <ol v-if="stats.ranking.length" class="ranking">
      <li v-for="(t, i) in stats.ranking" :key="t.id" @dblclick="play(t)">
        <span class="rank">{{ i + 1 }}</span>
        <span class="title">{{ t.title }}</span>
        <span class="val">
          {{ stats.rankingBy === 'count' ? `${t.playCount} 次` : fmtDuration(t.totalSeconds) }}
        </span>
      </li>
    </ol>
    <p v-else class="empty">暂无排行数据，播放歌曲后这里会生成排名。</p>
  </div>
</template>
