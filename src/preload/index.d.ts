import type {
  Album,
  DailyUsage,
  LyricDoc,
  RankingBy,
  Track,
  VariantProgress,
  VariantResult
} from '../shared/types'

export interface PeakPlayerApi {
  importFiles(): Promise<Track[]>
  listTracks(): Promise<Track[]>
  deleteTrack(id: string): Promise<void>
  setTrackAlbum(ids: string[], albumId: string | null): Promise<Track[]>
  listAlbums(): Promise<Album[]>
  createAlbum(name: string): Promise<Album[]>
  renameAlbum(id: string, name: string): Promise<Album[]>
  deleteAlbum(id: string): Promise<Album[]>
  updateTrack(id: string, patch: Partial<Pick<Track, 'playCount'>>): Promise<void>
  incrementCount(id: string, delta: number): Promise<number>
  setTrackDuration(id: string, seconds: number): Promise<void>
  addUsage(seconds: number, trackId: string | null): Promise<void>
  getWeeklyUsage(days?: number): Promise<DailyUsage[]>
  getRanking(by: RankingBy): Promise<Track[]>
  prepareVariant(trackPath: string, rate: number): Promise<VariantResult>
  getLyrics(trackPath: string): Promise<LyricDoc>
  onVariantProgress(cb: (p: VariantProgress) => void): () => void
  onTogglePlay(cb: () => void): () => void
}

declare global {
  interface Window {
    api: PeakPlayerApi
  }
}

export {}
