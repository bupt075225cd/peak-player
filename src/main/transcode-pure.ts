// transcode.ts 里的纯逻辑：参数拼装、产物判定、错误与日志文案。
// 不依赖 electron / fs / child_process，便于单测；编排与 spawn 仍留在 transcode.ts。

// 产物的「可用」判定：必须存在且非空，0 字节文件说明 ffmpeg 中途失败
export function isUsableVariant(size: number | null | undefined): boolean {
  return typeof size === 'number' && Number.isFinite(size) && size > 0
}

export function buildTranscodeArgs(input: string, filter: string, out: string): string[] {
  return [
    '-hide_banner',
    '-y',
    '-i',
    input,
    '-vn',
    '-filter:a',
    filter,
    '-c:a',
    'flac',
    '-compression_level',
    '5',
    '-progress',
    'pipe:1',
    '-nostats',
    out
  ]
}

// ffmpeg 的 stderr 可能刷出整首的解码日志，只保留尾部固定长度，避免内存无限增长
export function appendCapped(prev: string, chunk: string, limit: number): string {
  const next = prev + chunk
  if (next.length <= limit) return next
  return next.slice(-limit)
}

export function formatSpawnError(message: string): string {
  return `无法启动 ffmpeg：${message}`
}

// 塞进界面/日志的失败原因只带 stderr 末尾，够定位又不至于刷屏
export function formatExitError(code: number | null, stderr: string): string {
  return `ffmpeg 退出码 ${code}：${stderr.trim().slice(-400)}`
}

export function formatTranscodeLog(ok: boolean, rate: number, detail: string): string {
  return `${ok ? 'ok  ' : 'fail'} rate=${rate} ${detail}`
}
