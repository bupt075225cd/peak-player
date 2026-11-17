import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RankingBy, Track, VariantProgress, VariantResult } from '../shared/types'
import {
  addTrackSeconds,
  addTracks,
  addUsage,
  getRanking,
  getWeeklyUsage,
  incrementCount,
  listTracks,
  updateTrack
} from './db'
import { prepareVariant } from './transcode'
import { getMainWindow } from './window'

// 仅保留 Chromium 内置可解码的格式；.wma 无解码器，导入后无法播放
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus'])

export function registerIpc(): void {
  ipcMain.handle('tracks:import', async (): Promise<Track[]> => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择音频文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'] }
      ]
    })
    if (result.canceled) return listTracks()

    const tracks: Track[] = result.filePaths
      .filter((p) => AUDIO_EXTS.has(path.extname(p).toLowerCase()))
      .map((p) => ({
        id: randomUUID(),
        title: path.basename(p, path.extname(p)),
        path: p,
        sourceType: 'local',
        playCount: 0,
        totalSeconds: 0
      }))

    addTracks(tracks)
    return listTracks()
  })

  ipcMain.handle('tracks:list', (): Track[] => listTracks())

  ipcMain.handle(
    'tracks:update',
    (_e, id: string, patch: Partial<Pick<Track, 'playCount'>>): void => updateTrack(id, patch)
  )

  ipcMain.handle('tracks:increment', (_e, id: string, delta: number): number =>
    incrementCount(id, delta)
  )

  ipcMain.handle('usage:add', (_e, seconds: number, trackId: string | null): void => {
    addUsage(seconds)
    if (trackId) addTrackSeconds(trackId, seconds)
  })

  ipcMain.handle('usage:weekly', (_e, days?: number) => getWeeklyUsage(days ?? 7))

  ipcMain.handle('stats:ranking', (_e, by: RankingBy) => getRanking(by))
}
