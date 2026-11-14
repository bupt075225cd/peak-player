import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DailyUsage, RankingBy, Track } from '../../../shared/types'

export const useStatsStore = defineStore('stats', () => {
  const weekly = ref<DailyUsage[]>([])
  const ranking = ref<Track[]>([])
  const rankingBy = ref<RankingBy>('count')

  async function refreshWeekly(): Promise<void> {
    weekly.value = await window.api.getWeeklyUsage(7)
  }

  async function refreshRanking(): Promise<void> {
    ranking.value = await window.api.getRanking(rankingBy.value)
  }

  async function setRankingBy(by: RankingBy): Promise<void> {
    rankingBy.value = by
    await refreshRanking()
  }

  return { weekly, ranking, rankingBy, refreshWeekly, refreshRanking, setRankingBy }
})
