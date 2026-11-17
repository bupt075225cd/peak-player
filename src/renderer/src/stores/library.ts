import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Track } from '../../../shared/types'

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
  }

  // 播放结束后由 player 调用：只改动对应行，避免整表重查导致当前播放状态丢失
  function syncPlayCount(id: string, count: number): void {
    const target = tracks.value.find((t) => t.id === id)
    if (target) target.playCount = count
  }

  return { tracks, loading, refresh, importFiles, setPlayCount, syncPlayCount }
})
