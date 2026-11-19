// ffmpeg 命令行参数与输出解析：纯字符串处理，不依赖 electron，
// 便于单测（transcode.ts 只负责 spawn 与文件落盘）。

// rubberband 参数：固定 tempo 变速、保持音高，其余选项偏向人声质量
const RUBBERBAND_OPTIONS = [
  'tempo=%RATE%',
  'pitch=1',
  'transients=crisp',
  'detector=compound',
  'phase=laminar',
  'window=standard',
  'formant=preserved',
  'pitchq=quality',
  'channels=together'
].join(':')

// 必须以滤镜名开头（rubberband=），否则 ffmpeg 会把 tempo 当成滤镜名直接报错：
// "No option name near '1.2500:pitch=1:...'"
export function buildFilter(rate: number): string {
  const tempo = Number.isFinite(rate) && rate > 0 ? rate.toFixed(4) : '1.0000'
  return `rubberband=${RUBBERBAND_OPTIONS.replace('%RATE%', tempo)}`
}

// 解析 `ffmpeg -i` 输出里的 Duration 行，返回秒数（解析不到返回 0）
export function parseFfmpegDuration(stderr: string): number {
  const matched = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  if (!matched) return 0
  const seconds =
    Number(matched[1]) * 3600 + Number(matched[2]) * 60 + Number(matched[3])
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

// 解析 `-progress pipe:1` 的输出。不同版本输出 out_time_us 或 out_time_ms，
// 但两者历史上都是微秒；解析不到返回 null。
export function parseProgress(chunk: string): number | null {
  const matched = /out_time_(?:us|ms)=(\d+)/.exec(chunk)
  if (!matched) return null
  const microseconds = Number(matched[1])
  if (!Number.isFinite(microseconds)) return null
  return microseconds / 1e6
}

// 输出时长约为「源时长 / rate」，进度必须以输出时长为分母；
// 上限压到 0.99，1 只在 ffmpeg 正常退出后由调用方给出。
export function progressRatio(
  doneSeconds: number,
  totalSeconds: number,
  rate: number
): number | null {
  if (!(totalSeconds > 0) || !(rate > 0)) return null
  const expected = totalSeconds / rate
  if (!(expected > 0)) return null
  const ratio = doneSeconds / expected
  if (!Number.isFinite(ratio)) return null
  return Math.min(0.99, Math.max(0, ratio))
}
