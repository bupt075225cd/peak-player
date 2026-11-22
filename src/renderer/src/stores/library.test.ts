import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Album, DailyUsage, Track } from '../../../shared/types'
import { useLibraryStore } from './library'
import { useStatsStore } from './stats'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: '1',
    title: 'song',
    path: '/music/song.mp3',
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 200,
    albumId: null,
    ...overrides
  }
}

function setupApi(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const api = {
    listTracks: vi.fn(async () => {
      calls.push('listTracks')
      return [makeTrack({ id: '1' })]
    }),
    importFiles: vi.fn(async () => {
      calls.push('importFiles')
      return [makeTrack()]
    }),
    updateTrack: vi.fn(async () => {
      calls.push('updateTrack')
    }),
    deleteTrack: vi.fn(async () => {
      calls.push('deleteTrack')
    }),
    listAlbums: vi.fn(async (): Promise<Album[]> => {
      calls.push('listAlbums')
      return []
    }),
    setTrackAlbum: vi.fn(async (): Promise<Track[]> => {
      calls.push('setTrackAlbum')
      return []
    }),
    createAlbum: vi.fn(async (): Promise<Album[]> => {
      calls.push('createAlbum')
      return []
    }),
    renameAlbum: vi.fn(async (): Promise<Album[]> => {
      calls.push('renameAlbum')
      return []
    }),
    deleteAlbum: vi.fn(async (): Promise<Album[]> => {
      calls.push('deleteAlbum')
      return []
    }),
    getWeeklyUsage: vi.fn(async (): Promise<DailyUsage[]> => {
      calls.push('getWeeklyUsage')
      return []
    }),
    getRanking: vi.fn(async () => {
      calls.push('getRanking')
      return []
    }),
    ...overrides
  }
  return { api, calls }
}

describe('library store', () => {
  let ctx: ReturnType<typeof setupApi>

  beforeEach(() => {
    setActivePinia(createPinia())
    ctx = setupApi()
    vi.stubGlobal('window', { api: ctx.api })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refresh 把列表写入 store', async () => {
    const library = useLibraryStore()
    await library.refresh()
    expect(ctx.api.listTracks).toHaveBeenCalledTimes(1)
    expect(library.tracks).toHaveLength(1)
    expect(library.tracks[0].title).toBe('song')
  })

  it('importFiles 期间 loading 为 true，结束后复位', async () => {
    const library = useLibraryStore()
    const pending = library.importFiles()
    expect(library.loading).toBe(true)
    await pending
    expect(library.loading).toBe(false)
  })

  it('importFiles 抛错时 loading 也要复位', async () => {
    const library = useLibraryStore()
    ctx.api.importFiles.mockRejectedValueOnce(new Error('dialog failed'))
    await expect(library.importFiles()).rejects.toThrow('dialog failed')
    expect(library.loading).toBe(false)
  })

  // 改次数必须「先写库 → 再刷统计 → 最后整表刷新」，
  // 顺序错或用 Promise.all 抢跑都会让用时统计页显示旧值
  it('setPlayCount 先写库、再刷新统计、最后重新拉列表', async () => {
    const library = useLibraryStore()
    await library.setPlayCount('1', 5)
    expect(ctx.calls).toEqual([
      'updateTrack',
      'getWeeklyUsage',
      'getRanking',
      'listTracks',
      'listAlbums'
    ])
    expect(ctx.api.updateTrack).toHaveBeenCalledWith('1', { playCount: 5 })
  })

  it('setPlayCount 会调用统计 store 的刷新方法', async () => {
    const library = useLibraryStore()
    const stats = useStatsStore()
    const weekly = vi.spyOn(stats, 'refreshWeekly')
    const ranking = vi.spyOn(stats, 'refreshRanking')

    await library.setPlayCount('1', 3)

    expect(weekly).toHaveBeenCalledTimes(1)
    expect(ranking).toHaveBeenCalledTimes(1)
  })

  // 删除只作用于库记录：先写库，再本地摘行，最后刷新排行榜（排行榜 JOIN tracks，已删曲目会消失）
  it('remove 先删库、再刷新排行榜，并从本地列表摘掉该行', async () => {
    const library = useLibraryStore()
    library.tracks = [makeTrack({ id: '1' }), makeTrack({ id: '2', title: 'other' })]

    await library.remove('1')

    expect(ctx.api.deleteTrack).toHaveBeenCalledWith('1')
    expect(library.tracks.map((t) => t.id)).toEqual(['2'])
    // 排行榜与专辑曲目数都要跟着刷新
    expect(ctx.calls).toEqual(['deleteTrack', 'getRanking', 'listAlbums'])
  })

  // 队列跟随筛选：列表范围变了，播放与上/下一首的作用范围也跟着变
  it('visibleTracks 跟随专辑筛选', () => {
    const library = useLibraryStore()
    library.tracks = [
      makeTrack({ id: '1', albumId: 'a1' }),
      makeTrack({ id: '2', albumId: 'a2' }),
      makeTrack({ id: '3', albumId: null })
    ]

    expect(library.visibleTracks.map((t) => t.id)).toEqual(['1', '2', '3'])

    library.albumFilter = 'a1'
    expect(library.visibleTracks.map((t) => t.id)).toEqual(['1'])

    library.albumFilter = 'none'
    expect(library.visibleTracks.map((t) => t.id)).toEqual(['3'])
  })

  it('setAlbum 批量归入后清空多选并回写列表', async () => {
    const library = useLibraryStore()
    library.selectedIds = ['1', '2']
    ctx.api.setTrackAlbum.mockResolvedValueOnce([makeTrack({ id: '1', albumId: 'a1' })])

    await library.setAlbum(['1', '2'], 'a1')

    expect(ctx.api.setTrackAlbum).toHaveBeenCalledWith(['1', '2'], 'a1')
    expect(library.selectedIds).toEqual([])
    expect(library.tracks.map((t) => t.id)).toEqual(['1'])
  })

  // 专辑被删后筛选值不能再指向不存在的 id，否则列表会永远为空
  it('refresh 会在筛选专辑已不存在时回退到全部', async () => {
    const library = useLibraryStore()
    library.albumFilter = 'gone'

    await library.refresh()

    expect(library.albumFilter).toBe('all')
  })

  it('createAlbum / renameAlbum 只更新专辑列表', async () => {
    const library = useLibraryStore()
    const album: Album = { id: 'a1', name: 'Jazz', trackCount: 0 }
    ctx.api.createAlbum.mockResolvedValueOnce([album])
    ctx.api.renameAlbum.mockResolvedValueOnce([{ ...album, name: 'Soul' }])

    await library.createAlbum('Jazz')

    expect(ctx.api.createAlbum).toHaveBeenCalledWith('Jazz')
    expect(library.albums).toEqual([album])

    await library.renameAlbum('a1', 'Soul')
    expect(library.albums[0].name).toBe('Soul')
  })

  it('专辑名称为空白时不请求主进程', async () => {
    const library = useLibraryStore()

    await library.createAlbum('   ')
    await library.renameAlbum('a1', '')

    expect(ctx.api.createAlbum).not.toHaveBeenCalled()
    expect(ctx.api.renameAlbum).not.toHaveBeenCalled()
  })

  // 删专辑只是解除归属，曲目要重新拉回来（albumId 已置空）
  it('deleteAlbum 后重拉列表', async () => {
    const library = useLibraryStore()
    ctx.api.deleteAlbum.mockResolvedValueOnce([])
    ctx.api.listTracks.mockResolvedValueOnce([makeTrack({ id: '1' })])

    await library.deleteAlbum('a1')

    expect(library.albums).toEqual([])
    expect(library.tracks.map((t) => t.id)).toEqual(['1'])
    expect(library.tracks[0].albumId).toBeNull()
  })

  // 全选只作用于当前筛选结果，否则批量归入会误伤别的专辑
  it('全选与多选只覆盖当前筛选结果', () => {
    const library = useLibraryStore()
    library.tracks = [makeTrack({ id: '1', albumId: 'a1' }), makeTrack({ id: '2', albumId: 'a2' })]
    library.albumFilter = 'a1'

    library.selectAll()
    expect(library.selectedIds).toEqual(['1'])

    library.toggleSelect('1')
    expect(library.selectedIds).toEqual([])

    library.toggleSelect('1')
    expect(library.selectedIds).toEqual(['1'])

    library.clearSelection()
    expect(library.selectedIds).toEqual([])
  })

  it('syncPlayCount 只改目标行，且保持对象引用不变', async () => {
    const library = useLibraryStore()
    library.tracks = [makeTrack({ id: '1', playCount: 2 }), makeTrack({ id: '2', playCount: 7 })]
    const target = library.tracks[0]

    library.syncPlayCount('1', 9)

    expect(library.tracks[0].playCount).toBe(9)
    // 引用不变，避免播放中当前曲目被替换
    expect(library.tracks[0]).toBe(target)
    expect(library.tracks[1].playCount).toBe(7)
  })

  it('syncPlayCount 遇到不存在的 id 时不报错', () => {
    const library = useLibraryStore()
    library.tracks = [makeTrack({ id: '1' })]
    expect(() => library.syncPlayCount('missing', 5)).not.toThrow()
    expect(library.tracks[0].playCount).toBe(0)
  })
})
