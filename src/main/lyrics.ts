// 歌词装载：只认「歌曲同目录、同名 .lrc」这一种来源，完全离线、零新依赖。
// 读盘与解析拆开：解析在 shared/lyrics.ts（纯函数），这里只负责路径探测、
// 编码兜底与缓存。文件缺失、超限、损坏都降级为「无歌词」，绝不向渲染进程抛错。
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { emptyLyrics, parseLrc } from '../shared/lyrics'
import type { LyricDoc } from '../shared/types'

// 超过这个体积基本可以断定不是歌词（误放了日志之类），直接忽略
export const MAX_LYRIC_BYTES = 512 * 1024

export function candidateLyricPaths(audioPath: string): string[] {
  if (!audioPath) return []
  const dir = dirname(audioPath)
  const stem = basename(audioPath, extname(audioPath))
  // Linux 区分大小写，两种常见写法都探测一次
  return [join(dir, `${stem}.lrc`), join(dir, `${stem}.LRC`)]
}

function hasPrefix(buf: Uint8Array, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false
  return bytes.every((b, i) => buf[i] === b)
}

// 中文 .lrc 大量是 GBK：先按 UTF-8 严格解码，失败再回退 GBK，
// 两种都不行时用非严格 UTF-8 兜底（尽量显示可读内容而不是整篇丢失）
export function decodeLyricBuffer(input: Uint8Array): string {
  if (input.length === 0) return ''

  if (hasPrefix(input, [0xef, 0xbb, 0xbf])) {
    return new TextDecoder('utf-8').decode(input.subarray(3))
  }
  if (hasPrefix(input, [0xff, 0xfe])) {
    return new TextDecoder('utf-16le').decode(input.subarray(2))
  }
  if (hasPrefix(input, [0xfe, 0xff])) {
    return new TextDecoder('utf-16be').decode(input.subarray(2))
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    try {
      return new TextDecoder('gbk').decode(input)
    } catch {
      return new TextDecoder('utf-8').decode(input)
    }
  }
}

export interface LyricFileInfo {
  size: number
  mtimeMs: number
}

// 依赖注入：集成测试用真实 fs，单测可用桩模拟 EACCES / 目录 / 坏编码
export interface LyricIo {
  stat: (path: string) => Promise<LyricFileInfo>
  read: (path: string) => Promise<Uint8Array>
}

const defaultIo: LyricIo = {
  stat: async (p) => {
    const info = await stat(p)
    return { size: info.size, mtimeMs: info.mtimeMs }
  },
  read: (p) => readFile(p)
}

interface CacheEntry {
  size: number
  mtimeMs: number
  doc: LyricDoc
}

// 按 .lrc 路径缓存，mtime/大小变化即视为用户改过文件，下次读取重新解析
const cache = new Map<string, CacheEntry>()

export function clearLyricsCache(): void {
  cache.clear()
}

export async function loadLyrics(
  audioPath: string,
  io: Partial<LyricIo> = {}
): Promise<LyricDoc> {
  if (!audioPath) return emptyLyrics()
  const { stat: statFile, read } = { ...defaultIo, ...io }

  for (const lyricPath of candidateLyricPaths(audioPath)) {
    let info: LyricFileInfo
    try {
      info = await statFile(lyricPath)
    } catch {
      continue
    }
    if (info.size <= 0 || info.size > MAX_LYRIC_BYTES) continue

    const cached = cache.get(lyricPath)
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      return cached.doc
    }

    try {
      const parsed = parseLrc(decodeLyricBuffer(await read(lyricPath)))
      const doc: LyricDoc = {
        ...parsed,
        source: parsed.lines.length > 0 ? 'sidecar' : 'none'
      }
      cache.set(lyricPath, { size: info.size, mtimeMs: info.mtimeMs, doc })
      return doc
    } catch {
      // 读盘失败（权限/文件被占用）当作没有歌词，不影响播放
      continue
    }
  }

  return emptyLyrics()
}
