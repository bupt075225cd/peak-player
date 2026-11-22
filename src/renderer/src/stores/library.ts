import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Album, Track } from '../../../shared/types'
import { useStatsStore } from './stats'

// 播放列表筛选的三个特殊值：全部歌曲、未分类、或某个播放列表 id
export const FILTER_ALL = 'all'
export const FILTER_NONE = 'none'

export const useLibraryStore = defineStore('library', () => {
  const tracks = ref<Track[]>([])
  const albums = ref<Album[]>([])
  const loading = ref(false)
  // 当前筛选项，决定列表内容，也决定播放队列（切歌只在本播放列表内走）
  const albumFilter = ref<string>(FILTER_ALL)
  // 多选后的曲目 id，供批量归入播放列表
  const selectedIds = ref<string[]>([])

  // 播放队列 = 当前筛选结果：播放列表内切歌不会串到别的列表
  const visibleTracks = computed(() => {
    const filter = albumFilter.value
    if (filter === FILTER_ALL) return tracks.value
    if (filter === FILTER_NONE) return tracks.value.filter((t) => t.albumId === null)
    return tracks.value.filter((t) => t.albumId === filter)
  })

  async function refresh(): Promise<void> {
    const [list, albumList] = await Promise.all([
      window.api.listTracks(),
      window.api.listAlbums()
    ])
    tracks.value = list
    albums.value = albumList
    // 正在筛选的播放列表可能已被删除，回退到「全部歌曲」避免空白列表
    if (
      albumFilter.value !== FILTER_ALL &&
      albumFilter.value !== FILTER_NONE &&
      !albumList.some((a) => a.id === albumFilter.value)
    ) {
      albumFilter.value = FILTER_ALL
    }
    // 被删掉的曲目要从多选里摘掉，否则批量操作会带上不存在的 id
    selectedIds.value = selectedIds.value.filter((id) => list.some((t) => t.id === id))
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

  // 只删库记录：本地摘掉该行（保留其他行引用），排行榜与专辑曲目数也要同步
  async function remove(id: string): Promise<void> {
    await window.api.deleteTrack(id)
    tracks.value = tracks.value.filter((t) => t.id !== id)
    selectedIds.value = selectedIds.value.filter((x) => x !== id)
    const stats = useStatsStore()
    const [, albumList] = await Promise.all([stats.refreshRanking(), window.api.listAlbums()])
    albums.value = albumList
  }

  // 单曲下拉与批量归入共用；albumId 为 null 表示未归入任何播放列表
  async function setAlbum(ids: string[], albumId: string | null): Promise<void> {
    if (ids.length === 0) return
    tracks.value = await window.api.setTrackAlbum(ids, albumId)
    albums.value = await window.api.listAlbums()
    selectedIds.value = []
  }

  async function createAlbum(name: string): Promise<void> {
    if (!name.trim()) return
    albums.value = await window.api.createAlbum(name)
  }

  async function renameAlbum(id: string, name: string): Promise<void> {
    if (!name.trim()) return
    albums.value = await window.api.renameAlbum(id, name)
  }

  // 删播放列表只解除归属：曲目回到未分类，需要重拉列表
  async function deleteAlbum(id: string): Promise<void> {
    albums.value = await window.api.deleteAlbum(id)
    await refresh()
  }

  function toggleSelect(id: string): void {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((x) => x !== id)
      : [...selectedIds.value, id]
  }

  function selectAll(): void {
    selectedIds.value = visibleTracks.value.map((t) => t.id)
  }

  function clearSelection(): void {
    selectedIds.value = []
  }

  // 播放结束后由 player 调用：只改动对应行，避免整表重查导致当前播放状态丢失
  function syncPlayCount(id: string, count: number): void {
    const target = tracks.value.find((t) => t.id === id)
    if (target) target.playCount = count
  }

  return {
    tracks,
    albums,
    loading,
    albumFilter,
    selectedIds,
    visibleTracks,
    refresh,
    importFiles,
    setPlayCount,
    syncPlayCount,
    remove,
    setAlbum,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    toggleSelect,
    selectAll,
    clearSelection
  }
})
