<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PlayerBar from './components/PlayerBar.vue'
import { player } from './core/player'
import { useLibraryStore } from './stores/library'
import { useStatsStore } from './stores/stats'
import LibraryView from './views/LibraryView.vue'
import RankingView from './views/RankingView.vue'
import StatsView from './views/StatsView.vue'

type ViewKey = 'library' | 'ranking' | 'stats'

const library = useLibraryStore()
const stats = useStatsStore()
const currentView = ref<ViewKey>('library')

function switchView(v: ViewKey): void {
  currentView.value = v
  if (v === 'ranking') void stats.refreshRanking()
  if (v === 'stats') void stats.refreshWeekly()
}

onMounted(() => {
  void library.refresh()
  void stats.refreshWeekly()
  void stats.refreshRanking()
  // 托盘「播放/暂停」
  window.api.onTogglePlay(() => player.toggle())
})
</script>

<template>
  <div class="app">
    <nav class="sidebar">
      <div class="logo">Peak Player</div>
      <button :class="{ active: currentView === 'library' }" @click="switchView('library')">
        音乐库
      </button>
      <button :class="{ active: currentView === 'ranking' }" @click="switchView('ranking')">
        排行榜
      </button>
      <button :class="{ active: currentView === 'stats' }" @click="switchView('stats')">
        用时统计
      </button>
    </nav>
    <main class="content">
      <LibraryView v-if="currentView === 'library'" />
      <RankingView v-else-if="currentView === 'ranking'" />
      <StatsView v-else />
    </main>
    <PlayerBar />
  </div>
</template>
