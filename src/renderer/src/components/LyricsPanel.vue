<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { LyricLine } from '../../../shared/types'
import { useLyricFollow } from '../composables/useLyricFollow'
import { useLyricsPlayhead } from '../composables/useLyricsPlayhead'
import { player, playerState } from '../core/player'
import { activeLineIndex, lineProgress } from '../utils/lyrics'

const props = defineProps<{ lines: LyricLine[] }>()
const emit = defineEmits<{ seek: [time: number] }>()

const viewport = ref<HTMLElement | null>(null)
// 首行/末行也要能滚到正中：上下留出半个视口高度的空白，
// 纯 CSS 拿不到视口高度，这里在挂载/尺寸变化时算一次
const spacer = ref(0)

// 元素引用不进响应式：歌词可能有上百行，交给 Vue 代理没有收益
const lineEls = new Map<number, HTMLElement>()

// rAF 采样逻辑与「跟随/挂起」逻辑都已抽到 composables 并有单测，
// 组件只负责把它接到 DOM 上
const playhead = useLyricsPlayhead({
  getDisplayTime: () => player.displayTime(),
  getSnapshot: () => ({
    playing: playerState.playing,
    preparing: playerState.preparing,
    currentTime: playerState.currentTime
  })
})
const now = playhead.time
const activeIndex = computed(() => activeLineIndex(props.lines, now.value))
const fill = computed(() => lineProgress(props.lines, activeIndex.value, now.value))

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const follow = useLyricFollow({
  getTarget: () => ({
    viewport: viewport.value,
    activeLine: lineEls.get(activeIndex.value) ?? null
  }),
  prefersReducedMotion
})
const userScrolling = follow.userScrolling

function setLineRef(el: Element | ComponentPublicInstance | null, index: number): void {
  if (el instanceof HTMLElement) lineEls.set(index, el)
  else lineEls.delete(index)
}

function updateSpacer(): void {
  spacer.value = viewport.value ? Math.floor(viewport.value.clientHeight / 2) : 0
}

function onResize(): void {
  updateSpacer()
  follow.follow()
}

function selectLine(time: number): void {
  emit('seek', time)
  follow.resume()
}

function backToCurrent(): void {
  follow.resume()
}

watch(activeIndex, () => {
  void nextTick(follow.follow)
})

// 换歌后回到顶部，避免沿用上一首的滚动位置
watch(
  () => props.lines,
  () => {
    lineEls.clear()
    void nextTick(() => {
      updateSpacer()
      viewport.value?.scrollTo({ top: 0, behavior: 'auto' })
      follow.resume()
    })
  }
)

onMounted(() => {
  playhead.start()
  updateSpacer()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  playhead.stop()
  follow.dispose()
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="lyrics-panel">
    <div v-if="lines.length === 0" class="lyrics-empty">
      <p class="lyrics-empty-title">暂无歌词</p>
      <p class="lyrics-empty-hint">在歌曲同目录放置同名 .lrc 文件即可显示</p>
    </div>

    <template v-else>
      <div
        ref="viewport"
        class="lyrics-viewport"
        @wheel.passive="follow.pause()"
        @pointerdown="follow.pause()"
      >
        <div
          class="lyrics-inner"
          :style="{ paddingTop: `${spacer}px`, paddingBottom: `${spacer}px` }"
        >
          <p
            v-for="(line, i) in lines"
            :key="`${line.time}-${i}`"
            :ref="(el) => setLineRef(el, i)"
            class="lyric-line"
            :class="{ active: i === activeIndex, sung: i < activeIndex }"
            :style="i === activeIndex ? { '--fill': fill } : undefined"
            @click="selectLine(line.time)"
          >
            <span class="lyric-main">{{ line.text || '♪' }}</span>
            <span v-if="line.translation" class="lyric-sub">{{ line.translation }}</span>
          </p>
        </div>
      </div>

      <button v-if="userScrolling" class="lyrics-back" @click="backToCurrent">
        回到当前歌词
      </button>
    </template>
  </div>
</template>
