// media:// 协议的请求解析与状态码决策。刻意不依赖 electron / fs，
// 便于单测；protocol.ts 只负责 stat、建流与构造 Response。

import type { RangeResult } from './range'

// 从 media://play?path=<encodeURIComponent(绝对路径)> 里取路径。
// 参数缺失、空串、以及非法 URL 一律返回 null（由调用方回 400）
export function parseMediaPath(requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  const filePath = url.searchParams.get('path') ?? ''
  return filePath ? filePath : null
}

// 区间不可满足必须优先于 partial 判定，否则会算出非法长度
export function mediaStatus(range: RangeResult): 200 | 206 | 416 {
  if (range.kind === 'unsatisfiable') return 416
  if (range.kind === 'partial') return 206
  return 200
}

// 416 必须带 content-range，Chromium 据此判断是「区间越界」而不是「文件没了」
export function unsatisfiableHeaders(size: number): Record<string, string> {
  return { 'content-range': `bytes */${size}` }
}
