import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  Album,
  DailyUsage,
  LyricDoc,
  RankingBy,
  Track,
  VariantProgress,
  VariantResult
} from '../shared/types'
import { isSupportedAudio } from './audio-exts'
import {
  addTrackSeconds,
  addTracks,
  addUsage,
  createAlbum,
  deleteAlbum,
  deleteTrack,
  getRanking,
  getTrack,
  getWeeklyUsage,
  incrementCount,
  listAlbums,
  listTracks,
  renameAlbum,
  setTrackAlbum,
  setTrackDuration,
  updateTrack
} from './db'
import { loadLyrics } from './lyrics'
import { prepareVariant, probeAudioDuration } from './transcode'
import { ensureTrackDuration } from './track-duration'
import { getMainWindow } from './window'

// IPC 处理逻辑与 electron 解耦：真实实现由 createIpcDeps() 注入，
// 集成测试注入真实 db + 桩 dialog，就能跑通「导入 → 计数 → 统计」整条链路，
// 而不用启动 Electron。
export interface IpcDeps {
  // 返回选中的文件绝对路径；用户取消时返回 null
  pickAudioFiles: () => Promise<string[] | null>
  isSupportedAudio: (filePath: string) => boolean
  listTracks: () => Track[]
  addTracks: (tracks: Track[]) => number
  getTrack: (id: string) => Track | undefined
  // 只删库记录，不动磁盘文件
  deleteTrack: (id: string) => void
  listAlbums: () => Album[]
  createAlbum: (id: string, name: string) => void
  renameAlbum: (id: string, name: string) => void
  deleteAlbum: (id: string) => void
  // 批量归属；albumId 为 null 表示移回未分类
  setTrackAlbum: (ids: string[], albumId: string | null) => void
  updateTrack: (id: string, patch: Partial<Pick<Track, 'playCount'>>) => void
  incrementCount: (id: string, delta: number) => number
  setTrackDuration: (id: string, seconds: number) => void
  addUsage: (seconds: number, trackId: string | null) => void
  getWeeklyUsage: (days?: number) => DailyUsage[]
  getRanking: (by: RankingBy) => Track[]
  ensureTrackDuration: (id: string) => Promise<number>
  prepareVariant: (
    trackPath: string,
    rate: number,
    onProgress: (ratio: number) => void
  ) => Promise<VariantResult>
  // 读取歌曲同目录同名 .lrc；没有歌词时返回 source: 'none'
  loadLyrics: (trackPath: string) => Promise<LyricDoc>
  newId: () => string
}

export interface IpcSender {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export interface IpcEvent {
  sender: IpcSender
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type IpcHandler = (event: IpcEvent, ...args: any[]) => unknown
export type IpcHandlers = Record<string, IpcHandler>

export function createIpcHandlers(deps: IpcDeps): IpcHandlers {
  const importTrack = (filePath: string): Track => ({
    id: deps.newId(),
    title: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 0,
    albumId: null
  })

  return {
    'tracks:import': async (): Promise<Track[]> => {
      const selected = await deps.pickAudioFiles()
      if (selected === null) return deps.listTracks()

      deps.addTracks(selected.filter(deps.isSupportedAudio).map(importTrack))
      return deps.listTracks()
    },

    'tracks:list': (): Track[] => deps.listTracks(),

    // 只删库记录，磁盘上的音频与歌词文件保留
    'tracks:delete': (_e: IpcEvent, id: string): void => deps.deleteTrack(id),

    // 单曲下拉与批量归入共用；albumId 为 null 表示移回未分类。
    // 直接返回最新列表，渲染层替换即可，不必再发一次 list
    'tracks:set-album': (_e: IpcEvent, ids: string[], albumId: string | null): Track[] => {
      deps.setTrackAlbum(ids, albumId)
      return deps.listTracks()
    },

    'albums:list': (): Album[] => deps.listAlbums(),

    'albums:create': (_e: IpcEvent, name: string): Album[] => {
      deps.createAlbum(deps.newId(), name)
      return deps.listAlbums()
    },

    'albums:rename': (_e: IpcEvent, id: string, name: string): Album[] => {
      deps.renameAlbum(id, name)
      return deps.listAlbums()
    },

    // 删播放列表只解除归属，曲目保留
    'albums:delete': (_e: IpcEvent, id: string): Album[] => {
      deps.deleteAlbum(id)
      return deps.listAlbums()
    },

    // 改次数会按「曲目真实时长 × 次数差」换算用时统计；
    // 从未播放过（或升级前入库）的曲目 duration 为 0，先补采一次再换算
    'tracks:update': async (
      _e: IpcEvent,
      id: string,
      patch: Partial<Pick<Track, 'playCount'>>
    ): Promise<void> => {
      if (patch.playCount !== undefined) await deps.ensureTrackDuration(id)
      deps.updateTrack(id, patch)
    },

    'tracks:increment': (_e: IpcEvent, id: string, delta: number): number =>
      deps.incrementCount(id, delta),

    // 播放时上报曲目真实时长，供改次数时换算用时
    'tracks:duration': (_e: IpcEvent, id: string, seconds: number): void =>
      deps.setTrackDuration(id, seconds),

    'usage:add': (_e: IpcEvent, seconds: number, trackId: string | null): void =>
      deps.addUsage(seconds, trackId),

    'usage:weekly': (_e: IpcEvent, days?: number): DailyUsage[] => deps.getWeeklyUsage(days),

    'stats:ranking': (_e: IpcEvent, by: RankingBy): Track[] => deps.getRanking(by),

    // 歌词：只读歌曲同目录同名 .lrc，缺失时返回 source: 'none'
    'lyrics:get': (_e: IpcEvent, trackPath: string): Promise<LyricDoc> =>
      deps.loadLyrics(trackPath),

    // 变速预渲染：失败时返回 { error } 让渲染进程退回内置伸缩
    'audio:variant': (e: IpcEvent, trackPath: string, rate: number): Promise<VariantResult> => {
      const sender = e.sender
      return deps.prepareVariant(trackPath, rate, (ratio): void => {
        const payload: VariantProgress = { trackPath, rate, ratio }
        if (!sender.isDestroyed()) sender.send('audio:variant-progress', payload)
      })
    }
  }
}

// 生产环境依赖：dialog 选文件 + 真实 db / 转码
export function createIpcDeps(): IpcDeps {
  return {
    pickAudioFiles: async () => {
      const win = getMainWindow()
      const result = await dialog.showOpenDialog(win!, {
        title: '选择音频文件',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] }
        ]
      })
      return result.canceled ? null : result.filePaths
    },
    isSupportedAudio,
    listTracks,
    addTracks,
    getTrack,
    deleteTrack,
    listAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    setTrackAlbum,
    updateTrack,
    incrementCount,
    setTrackDuration,
    addUsage: (seconds, trackId) => {
      addUsage(seconds)
      if (trackId) addTrackSeconds(trackId, seconds)
    },
    getWeeklyUsage: (days) => getWeeklyUsage(days ?? 7),
    getRanking,
    ensureTrackDuration: (id) =>
      ensureTrackDuration(id, { getTrack, probeAudioDuration, setTrackDuration }),
    prepareVariant,
    loadLyrics,
    newId: () => randomUUID()
  }
}

export function registerIpc(deps: IpcDeps = createIpcDeps()): void {
  for (const [channel, handler] of Object.entries(createIpcHandlers(deps))) {
    ipcMain.handle(channel, (event, ...args) => handler(event as IpcEvent, ...args))
  }
}
