import { contextBridge, ipcRenderer } from 'electron'
import type {
  Album,
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
  // 只移除库记录，磁盘文件保留
  deleteTrack: (id: string): Promise<void> => ipcRenderer.invoke('tracks:delete', id),
  // 单曲与批量共用一个通道；albumId 为 null 表示移回未分类
  setTrackAlbum: (ids: string[], albumId: string | null): Promise<Track[]> =>
    ipcRenderer.invoke('tracks:set-album', ids, albumId),
  listAlbums: (): Promise<Album[]> => ipcRenderer.invoke('albums:list'),
  createAlbum: (name: string): Promise<Album[]> => ipcRenderer.invoke('albums:create', name),
  renameAlbum: (id: string, name: string): Promise<Album[]> =>
    ipcRenderer.invoke('albums:rename', id, name),
  deleteAlbum: (id: string): Promise<Album[]> => ipcRenderer.invoke('albums:delete', id),
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
