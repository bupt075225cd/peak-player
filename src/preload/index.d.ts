import type { DailyUsage, RankingBy, Track } from '../shared/types'

export interface PeakPlayerApi {
  importFiles(): Promise<Track[]>
  listTracks(): Promise<Track[]>
  updateTrack(id: string, patch: Partial<Pick<Track, 'playCount'>>): Promise<void>
  incrementCount(id: string, delta: number): Promise<number>
  addUsage(seconds: number, trackId: string | null): Promise<void>
  getWeeklyUsage(days?: number): Promise<DailyUsage[]>
  getRanking(by: RankingBy): Promise<Track[]>
  onTogglePlay(cb: () => void): () => void
}

declare global {
  interface Window {
    api: PeakPlayerApi
  }
}

export {}
