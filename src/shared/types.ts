export type SourceType = 'local' | 'remote'
export type LoopMode = 'none' | 'single' | 'all'
export type RankingBy = 'count' | 'duration'

export interface Track {
  id: string
  title: string
  path: string
  sourceType: SourceType
  playCount: number
  totalSeconds: number
}

export interface DailyUsage {
  date: string
  seconds: number
}
