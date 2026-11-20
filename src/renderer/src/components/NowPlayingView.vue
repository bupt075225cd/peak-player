<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import LyricsPanel from './LyricsPanel.vue'
import { useSeekDrag } from '../composables/useSeekDrag'
import { player, playerState } from '../core/player'
import { LOOP_LABELS, RATE_OPTIONS, nextLoopMode } from '../core/playback'
import { useLyricsStore } from '../stores/lyrics'
import { formatClock, formatRateLabel, progressPercent } from '../utils/format'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const lyrics = useLyricsStore()

// 拖动状态与「松手才 seek」的逻辑在 composable 里，单测覆盖
const drag = useSeekDrag({
  getCurrentTime: () => playerState.currentTime,
  seek: (seconds) => player.seek(seconds)
})
const displayTime = drag.displayTime

const title = computed(() => playerState.current?.title ?? '未在播放')

function close(): void {
  emit('close')
}

function onSeekInput(e: Event): void {
  drag.update(Number((e.target as HTMLInputElement).value))
}

function onSeekCommit(e: Event): void {
  drag.commit(Number((e.target as HTMLInputElement).value))
}

function setRate(e: Event): void {
  void player.setRate(Number((e.target as HTMLSelectElement).value))
}

function cycleLoop(): void {
  player.loopMode = nextLoopMode(playerState.loopMode)
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.open || e.key !== 'Escape') return
  e.preventDefault()
  close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Transition name="now-playing">
    <section
      v-if="open"
      class="now-playing"
      role="dialog"
      aria-modal="true"
      aria-label="正在播放"
    >
      <div class="now-playing-bg" aria-hidden="true"></div>

      <header class="now-playing-head">
        <div class="np-heading">
          <p class="np-eyebrow">正在播放</p>
          <h2 class="np-title" :title="title">{{ title }}</h2>
        </div>
        <button class="np-close ghost" title="收起（Esc）" @click="close">收起</button>
      </header>

      <LyricsPanel :lines="lyrics.lines" @seek="player.seek($event)" />

      <footer class="now-playing-foot">
        <div class="np-progress">
          <input
            class="np-range"
            type="range"
            min="0"
            :max="playerState.duration || 0"
            step="0.1"
            :value="displayTime"
            :disabled="!playerState.current || playerState.duration <= 0"
            @input="onSeekInput"
            @change="onSeekCommit"
          />
          <div class="np-times">
            <span>{{ formatClock(displayTime) }}</span>
            <span>{{ formatClock(playerState.duration) }}</span>
          </div>
        </div>

        <div class="np-controls">
          <button class="np-play" :disabled="playerState.preparing" @click="player.toggle()">
            {{ playerState.playing ? '暂停' : '播放' }}
          </button>
          <button class="ghost" @click="cycleLoop()">{{ LOOP_LABELS[playerState.loopMode] }}</button>
          <label class="np-rate">
            倍速
            <select :value="playerState.rate" @change="setRate">
              <option v-for="r in RATE_OPTIONS" :key="r" :value="r">
                {{ formatRateLabel(r) }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="playerState.preparing" class="np-hint">
          正在生成 {{ playerState.rate }}x 音频 {{ progressPercent(playerState.progress) }}%
        </p>
        <p v-else-if="playerState.error" class="np-error">{{ playerState.error }}</p>
      </footer>
    </section>
  </Transition>
</template>
