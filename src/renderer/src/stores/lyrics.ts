import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LyricDoc, LyricLine, LyricSource, Track } from '../../../shared/types'

export const useLyricsStore = defineStore('lyrics', () => {
  const lines = ref<LyricLine[]>([])
  const offset = ref(0)
  const source = ref<LyricSource>('none')
  const loading = ref(false)

  // 切歌令牌：连续快速切歌时只让最后一次请求的结果落到界面上，
  // 否则先发出的慢请求会覆盖后一首歌的歌词
  let token = 0

  async function load(track: Track | null): Promise<void> {
    const seq = ++token

    // 先清空：避免上一首的歌词在新歌加载期间停留在屏幕上
    lines.value = []
    offset.value = 0
    source.value = 'none'

    if (!track) {
      loading.value = false
      return
    }

    loading.value = true
    try {
      const doc: LyricDoc = await window.api.getLyrics(track.path)
      if (seq !== token) return
      lines.value = doc.lines
      offset.value = doc.offset
      source.value = doc.source
    } catch (err) {
      // 歌词是增强信息，读不到不能影响播放，界面上按「无歌词」处理
      if (seq === token) {
        lines.value = []
        source.value = 'none'
        console.warn('[lyrics] 加载歌词失败：', err)
      }
    } finally {
      if (seq === token) loading.value = false
    }
  }

  return { lines, offset, source, loading, load }
})
