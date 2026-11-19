import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RankingBy, Track, VariantProgress, VariantResult } from '../shared/types'
import {
  addTrackSeconds,
  addTracks,
  addUsage,
  getRanking,
  getTrack,
  getWeeklyUsage,
  incrementCount,
  listTracks,
  setTrackDuration,
  updateTrack
} from './db'
import { prepareVariant, probeAudioDuration } from './transcode'
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
        totalSeconds: 0,
        duration: 0
      }))

    addTracks(tracks)
    return listTracks()
  })

  ipcMain.handle('tracks:list', (): Track[] => listTracks())

  // 改次数会按「曲目真实时长 × 次数差」换算用时统计；
  // 从未播放过（或升级前入库）的曲目 duration 为 0，先用 ffmpeg 补采一次再换算
  ipcMain.handle(
    'tracks:update',
    async (_e, id: string, patch: Partial<Pick<Track, 'playCount'>>): Promise<void> => {
      if (patch.playCount !== undefined) await ensureTrackDuration(id)
      updateTrack(id, patch)
    }
  )

  ipcMain.handle('tracks:increment', (_e, id: string, delta: number): number =>
    incrementCount(id, delta)
  )

  // 播放时上报曲目真实时长，供改次数时换算用时
  ipcMain.handle('tracks:duration', (_e, id: string, seconds: number): void =>
    setTrackDuration(id, seconds)
  )

  ipcMain.handle('usage:add', (_e, seconds: number, trackId: string | null): void => {
    addUsage(seconds)
    if (trackId) addTrackSeconds(trackId, seconds)
  })

  ipcMain.handle('usage:weekly', (_e, days?: number) => getWeeklyUsage(days ?? 7))

  ipcMain.handle('stats:ranking', (_e, by: RankingBy) => getRanking(by))

  // 变速预渲染：失败时返回 { error } 让渲染进程退回内置伸缩
  ipcMain.handle(
    'audio:variant',
    (e, trackPath: string, rate: number): Promise<VariantResult> => {
      const sender = e.sender
      return prepareVariant(trackPath, rate, (ratio): void => {
        const payload: VariantProgress = { trackPath, rate, ratio }
        if (!sender.isDestroyed()) sender.send('audio:variant-progress', payload)
      })
    }
  )
}

// duration 未知时补采一次（失败保持 0，改次数只是不联动用时）
async function ensureTrackDuration(id: string): Promise<void> {
  const track = getTrack(id)
  if (!track || track.duration > 0) return
  const seconds = await probeAudioDuration(track.path)
  if (seconds > 0) setTrackDuration(id, seconds)
}
