import { contextBridge, ipcRenderer } from 'electron'
import type {
  DailyUsage,
  LyricDoc,
  RankingBy,
  Track,
  VariantProgress,
  VariantResult
} from '../shared/types'

const api = {
  importFiles: (): Promise<Track[]> => ipcRenderer.invoke('tracks:import'),
  listTracks: (): Promise<Track[]> => ipcRenderer.invoke('tracks:list'),
  updateTrack: (id: string, patch: Partial<Pick<Track, 'playCount'>>): Promise<void> =>
    ipcRenderer.invoke('tracks:update', id, patch),
  incrementCount: (id: string, delta: number): Promise<number> =>
    ipcRenderer.invoke('tracks:increment', id, delta),
  setTrackDuration: (id: string, seconds: number): Promise<void> =>
    ipcRenderer.invoke('tracks:duration', id, seconds),
  addUsage: (seconds: number, trackId: string | null): Promise<void> =>
    ipcRenderer.invoke('usage:add', seconds, trackId),
  getWeeklyUsage: (days?: number): Promise<DailyUsage[]> =>
    ipcRenderer.invoke('usage:weekly', days),
  getRanking: (by: RankingBy): Promise<Track[]> => ipcRenderer.invoke('stats:ranking', by),
  prepareVariant: (trackPath: string, rate: number): Promise<VariantResult> =>
    ipcRenderer.invoke('audio:variant', trackPath, rate),
  getLyrics: (trackPath: string): Promise<LyricDoc> =>
    ipcRenderer.invoke('lyrics:get', trackPath),
  onVariantProgress: (cb: (p: VariantProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: VariantProgress): void => cb(p)
    ipcRenderer.on('audio:variant-progress', listener)
    return () => {
      ipcRenderer.removeListener('audio:variant-progress', listener)
    }
  },
  onTogglePlay: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('player:toggle', listener)
    return () => {
      ipcRenderer.removeListener('player:toggle', listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PeakPlayerApi = typeof api
