import { extname } from 'node:path'

// 仅保留 Chromium 内置可解码的格式；.wma 无解码器，导入后无法播放
export const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus'] as const

export function isSupportedAudio(filePath: string): boolean {
  return (AUDIO_EXTS as readonly string[]).includes(extname(filePath).toLowerCase())
}
