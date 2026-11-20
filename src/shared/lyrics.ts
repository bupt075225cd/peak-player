// LRC 解析：主进程读盘后调用，渲染进程也可复用于粘贴的歌词文本。
// 刻意做成零依赖纯函数（不碰 fs、不碰 Vue），解析规则全部由单测固定。
import type { LyricDoc, LyricLine } from './types'

// [mm:ss]、[mm:ss.x]、[mm:ss.xx]、[mm:ss.xxx]；分钟最多 3 位（长音频）
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,4}))?\]/g
// [ti:标题] / [ar:歌手] / [offset:+500] 等元信息
const META_TAG = /^\[([a-zA-Z]+):(.*)\]$/

// 同时间戳的行合并成「原文 + 译文」的容差（秒）
const MERGE_TOLERANCE = 0.05

export interface ParsedLyrics {
  lines: LyricLine[]
  offset: number
}

export function emptyLyrics(): LyricDoc {
  return { lines: [], offset: 0, source: 'none' }
}

// 小数位按毫秒对齐：.5 → 500ms，.05 → 50ms，超过 3 位截断
export function parseTimestamp(minutes: string, seconds: string, fraction?: string): number {
  const m = Number(minutes)
  const s = Number(seconds)
  if (!Number.isFinite(m) || !Number.isFinite(s)) return Number.NaN
  let ms = 0
  if (fraction) {
    ms = Number(fraction.slice(0, 3).padEnd(3, '0'))
    if (!Number.isFinite(ms)) return Number.NaN
  }
  // 统一到毫秒精度，避免 0.1 + 0.2 这类浮点噪声影响合并与比较
  return Math.round((m * 60 + s) * 1000 + ms) / 1000
}

function parseOffsetMs(raw: string): number {
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : 0
}

interface TimeTags {
  times: number[]
  text: string
}

// 只认行首连续的多个时间戳（[00:10.00][01:20.00]副歌），
// 中间出现非时间戳内容即停止，防止把正文里的方括号当成时间
function parseTimeTags(line: string): TimeTags {
  const times: number[] = []
  let cursor = 0
  TIME_TAG.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = TIME_TAG.exec(line)) !== null) {
    if (match.index !== cursor) break
    // 正则分组只可能是数字，这里得到的必然是有限值
    times.push(parseTimestamp(match[1], match[2], match[3]))
    cursor = TIME_TAG.lastIndex
  }

  return { times, text: times.length > 0 ? line.slice(cursor).trim() : '' }
}

export function parseLrc(content: string): ParsedLyrics {
  if (typeof content !== 'string' || content === '') return { lines: [], offset: 0 }

  const drafts: { time: number; text: string }[] = []
  let offsetMs = 0

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    const meta = META_TAG.exec(line)
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') offsetMs = parseOffsetMs(meta[2])
      continue
    }

    const { times, text } = parseTimeTags(line)
    for (const time of times) drafts.push({ time, text })
  }

  if (drafts.length === 0) return { lines: [], offset: offsetMs / 1000 }

  // [offset] 正数表示整体延后显示
  const offset = offsetMs / 1000
  drafts.sort((a, b) => a.time - b.time)

  const lines: LyricLine[] = []
  for (const draft of drafts) {
    const time = Math.round((draft.time + offset) * 1000) / 1000
    const last = lines[lines.length - 1]
    if (last && time - last.time <= MERGE_TOLERANCE) {
      // 纯时间戳的空行不覆盖已有文本；完全重复的行直接丢弃
      if (!draft.text || draft.text === last.text) continue
      if (!last.text) {
        last.text = draft.text
        continue
      }
      last.translation = last.translation ? `${last.translation}\n${draft.text}` : draft.text
      continue
    }

    lines.push({ time, text: draft.text })
  }

  return { lines, offset }
}
