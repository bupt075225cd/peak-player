// 展示层格式化与输入解析：从组件里抽出来的纯函数，便于单测。

// 播放条时间，形如 0:59 / 2:05；非有限值或负数一律 0:00
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest.toString().padStart(2, '0')}`
}

// 排行榜里的口语化时长
export function formatSpokenDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 分钟'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  return `${minutes} 分钟`
}

// 改次数输入框的解析：input[type=number] 上的 v-model 会给出 number，
// 其它情况（初始值/清空）给出 string，两种都要兼容
export function parseCountInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  return Number.isFinite(value) ? value : null
}

// 倍速下拉项的文案，固定两位小数：1.00x / 1.25x
export function formatRateLabel(rate: number): string {
  const value = Number.isFinite(rate) ? rate : 1
  return `${value.toFixed(2)}x`
}

// 转码进度百分比，夹在 0~100 之间的整数
export function progressPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  const percent = Math.round(ratio * 100)
  return Math.min(100, Math.max(0, percent))
}

// 校验这次编辑是否值得写库：非整数、负数、与原值相同都不提交
export function resolveCountChange(current: number, input: number | null): number | null {
  if (input === null) return null
  if (!Number.isInteger(input)) return null
  if (input < 0) return null
  if (input === current) return null
  return input
}
