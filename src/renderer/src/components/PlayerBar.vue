<script setup lang="ts">
import { computed } from 'vue'
import { nextTrack, player, playerState, prevTrack } from '../core/player'
import { LOOP_LABELS, RATE_OPTIONS, nextLoopMode } from '../core/playback'
import { useLibraryStore } from '../stores/library'
import { useLyricsStore } from '../stores/lyrics'
import { formatClock, formatRateLabel, progressPercent } from '../utils/format'
import { currentLyricText } from '../utils/lyrics'

const emit = defineEmits<{ openNowPlaying: [] }>()

const lyrics = useLyricsStore()
const library = useLibraryStore()

const title = computed(() => playerState.current?.title ?? '未在播放')
const loopLabel = computed(() => LOOP_LABELS[playerState.loopMode])
// 当前筛选结果为空时没有可切的目标，按钮直接禁用，避免点了没反应
const canSwitch = computed(() => library.visibleTracks.length > 0)
// 播放条只需要 4Hz 的 currentTime，全屏歌词页才用 rAF 取精确进度
const currentLyric = computed(() => currentLyricText(lyrics.lines, playerState.currentTime))

function setRate(e: Event): void {
  void player.setRate(Number((e.target as HTMLSelectElement).value))
}

function cycleLoop(): void {
  player.loopMode = nextLoopMode(playerState.loopMode)
}

const fmt = formatClock
</script>

<template>
  <div class="player-bar">
    <button class="player-meta" title="打开正在播放" @click="emit('openNowPlaying')">
      <span class="title">{{ title }}</span>
      <span v-if="currentLyric" class="title-lyric">{{ currentLyric }}</span>
    </button>
    <button class="ghost" :disabled="!canSwitch" title="上一曲" @click="prevTrack()">
      上一曲
    </button>
    <button class="ghost" @click="player.toggle()">
      {{ playerState.playing ? '暂停' : '播放' }}
    </button>
    <button class="ghost" :disabled="!canSwitch" title="下一曲" @click="nextTrack()">
      下一曲
    </button>
    <button class="ghost" @click="cycleLoop()">{{ loopLabel }}</button>
    <label class="rate">
      倍速
      <select :value="playerState.rate" @change="setRate">
        <option v-for="r in RATE_OPTIONS" :key="r" :value="r">{{ formatRateLabel(r) }}</option>
      </select>
    </label>
    <span v-if="playerState.preparing" class="prep">
      正在生成 {{ playerState.rate }}x 音频 {{ progressPercent(playerState.progress) }}%
    </span>
    <span v-if="playerState.error" class="error" :title="playerState.error">
      {{ playerState.error }}
    </span>
    <div class="time">{{ fmt(playerState.currentTime) }} / {{ fmt(playerState.duration) }}</div>
    <button class="ghost lyric-toggle" @click="emit('openNowPlaying')">字幕</button>
  </div>
</template>
