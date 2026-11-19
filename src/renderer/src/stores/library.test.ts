import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyUsage, Track } from '../../../shared/types'
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
      'listTracks'
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
