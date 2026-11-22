import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Track } from '../../../shared/types'
import { useStatsStore } from './stats'

export const useLibraryStore = defineStore('library', () => {
  const tracks = ref<Track[]>([])
  const loading = ref(false)

  async function refresh(): Promise<void> {
    tracks.value = await window.api.listTracks()
  }

  async function importFiles(): Promise<void> {
    loading.value = true
    try {
      tracks.value = await window.api.importFiles()
    } finally {
      loading.value = false
    }
  }

  async function setPlayCount(id: string, count: number): Promise<void> {
    await window.api.updateTrack(id, { playCount: count })
    syncPlayCount(id, count)
    // 改次数会联动用时与时长，统计页/排行榜需要同步刷新
    const stats = useStatsStore()
    await Promise.all([stats.refreshWeekly(), stats.refreshRanking()])
    await refresh()
  }

  // 只删库记录：本地摘掉该行（保留其他行引用），排行榜里也会少掉这一首
  async function remove(id: string): Promise<void> {
    await window.api.deleteTrack(id)
    tracks.value = tracks.value.filter((t) => t.id !== id)
    await useStatsStore().refreshRanking()
  }

  // 播放结束后由 player 调用：只改动对应行，避免整表重查导致当前播放状态丢失
  function syncPlayCount(id: string, count: number): void {
    const target = tracks.value.find((t) => t.id === id)
    if (target) target.playCount = count
  }

  return { tracks, loading, refresh, importFiles, setPlayCount, syncPlayCount, remove }
})
