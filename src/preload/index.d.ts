import type { DailyUsage, RankingBy, Track } from '../shared/types'

export interface PeakPlayerApi {
  importFiles(): Promise<Track[]>
  listTracks(): Promise<Track[]>
  updateTrack(id: string, patch: Partial<Pick<Track, 'playCount'>>): Promise<void>
  incrementCount(id: string, delta: number): Promise<number>
  setTrackDuration(id: string, seconds: number): Promise<void>
  addUsage(seconds: number, trackId: string | null): Promise<void>
  getWeeklyUsage(days?: number): Promise<DailyUsage[]>
  getRanking(by: RankingBy): Promise<Track[]>
  prepareVariant(trackPath: string, rate: number): Promise<VariantResult>
  onVariantProgress(cb: (p: VariantProgress) => void): () => void
  onTogglePlay(cb: () => void): () => void
}

declare global {
  interface Window {
    api: PeakPlayerApi
  }
}

export {}
