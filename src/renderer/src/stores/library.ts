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
    await refresh()
  }

  return { tracks, loading, refresh, importFiles, setPlayCount }
})
