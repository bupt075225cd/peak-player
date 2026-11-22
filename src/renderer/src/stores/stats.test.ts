import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyUsage, Track } from '../../../shared/types'
import { useStatsStore } from './stats'

const WEEKLY: DailyUsage[] = [
  { date: '2026-11-16', seconds: 60 },
  { date: '2026-11-17', seconds: 120 }
]

const RANKED: Track[] = [
  {
    id: '1',
    title: 'song',
    path: '/music/song.mp3',
    sourceType: 'local',
    playCount: 5,
    totalSeconds: 300,
    duration: 200,
    albumId: null
  }
]

function setupApi() {
  const api = {
    getWeeklyUsage: vi.fn(async () => WEEKLY),
    getRanking: vi.fn(async (_by: string) => RANKED)
  }
  return api
}

describe('stats store', () => {
  let api: ReturnType<typeof setupApi>

  beforeEach(() => {
    setActivePinia(createPinia())
    api = setupApi()
    vi.stubGlobal('window', { api })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refreshWeekly 固定取近 7 天', async () => {
    const stats = useStatsStore()
    await stats.refreshWeekly()
    expect(api.getWeeklyUsage).toHaveBeenCalledWith(7)
    expect(stats.weekly).toEqual(WEEKLY)
  })

  it('refreshRanking 使用当前排序维度', async () => {
    const stats = useStatsStore()
    await stats.refreshRanking()
    expect(api.getRanking).toHaveBeenCalledWith('count')
    expect(stats.ranking).toEqual(RANKED)
  })

  it('setRankingBy 先切换维度再重新拉取', async () => {
    const stats = useStatsStore()
    await stats.setRankingBy('duration')
    expect(stats.rankingBy).toBe('duration')
    expect(api.getRanking).toHaveBeenLastCalledWith('duration')
  })

  it('切回按次数时同样会刷新', async () => {
    const stats = useStatsStore()
    await stats.setRankingBy('duration')
    await stats.setRankingBy('count')
    expect(stats.rankingBy).toBe('count')
    expect(api.getRanking).toHaveBeenCalledTimes(2)
    expect(api.getRanking).toHaveBeenLastCalledWith('count')
  })
})
