import { extname } from 'node:path'

// 自定义 media:// 协议的响应构造逻辑。
// 这里刻意不依赖 electron，方便单测（protocol.ts 只做搬运）。

// 必须显式给出 MIME：Chromium 对无 Content-Type 的流嗅探不可靠
export const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
}

export function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

export type RangeResult =
  // 忽略 Range：按整文件 200 返回（头缺失/无法解析/多段请求）
  | { kind: 'full' }
  // 合法区间，start/end 均为闭区间下标
  | { kind: 'partial'; start: number; end: number }
  // 无法满足，应返回 416 并带 content-range: bytes */size
  | { kind: 'unsatisfiable' }

// 解析 Range 请求头。只支持单段的 `bytes=` 形式：
//   bytes=0-      从头到结尾
//   bytes=100-    从 100 到结尾
//   bytes=0-99    前 100 字节
//   bytes=-500    末尾 500 字节
// 多段（逗号）与非法格式一律降级为整文件 200，交给 Chromium 自行处理。
export function parseRange(header: string | null, size: number): RangeResult {
  const value = (header ?? '').trim()
  if (!value) return { kind: 'full' }

  const matched = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!matched) return { kind: 'full' }

  const [, startRaw, endRaw] = matched
  if (!startRaw && !endRaw) return { kind: 'full' }

  // 空文件没有任何字节可以满足 Range（否则会算出 end = -1 这种非法区间）
  if (size <= 0) return { kind: 'unsatisfiable' }

  if (!startRaw) {
    // bytes=-N：末尾 N 字节，N 为 0 视为不满足
    const suffix = Number(endRaw)
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(startRaw)
  if (!Number.isFinite(start) || start >= size) return { kind: 'unsatisfiable' }

  const end = endRaw ? Math.min(Number(endRaw), size - 1) : size - 1
  if (!Number.isFinite(end) || end < start) return { kind: 'unsatisfiable' }

  return { kind: 'partial', start, end }
}

// 206 响应头：长度必须与 content-range 一致，否则 Chromium 的进度/拖动会异常
export function partialHeaders(
  mime: string,
  start: number,
  end: number,
  size: number
): Record<string, string> {
  return {
    'content-type': mime,
    'content-length': String(end - start + 1),
    'content-range': `bytes ${start}-${end}/${size}`,
    'accept-ranges': 'bytes'
  }
}

export function fullHeaders(mime: string, size: number): Record<string, string> {
  return {
    'content-type': mime,
    'content-length': String(size),
    'accept-ranges': 'bytes'
  }
}
