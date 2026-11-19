import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { VariantResult } from '../shared/types'
import { buildFilter, parseFfmpegDuration, parseProgress, progressRatio } from './ffmpeg-args'

// 变速预渲染：用 ffmpeg 的 rubberband 滤镜离线生成「变速不变调」的文件，
// 质量远好于 Chromium 内置的 WSOLA 时间伸缩（后者在 0.8x 会有明显金属感）。

// 缓存上限：超过后按最久未使用优先删除
const CACHE_MAX_BYTES = 2 * 1024 ** 3
const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000

export type ProgressFn = (ratio: number) => void

function binName(): string {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

export function resolveFfmpegPath(): string {
  const name = binName()
  const fromEnv = process.env['PEAK_FFMPEG']
  if (fromEnv) return fromEnv

  const packaged = join(process.resourcesPath ?? '', 'bin', name)
  if (app.isPackaged && existsSync(packaged)) return packaged

  // 开发态：项目内 resources/bin（由 scripts/fetch-ffmpeg.mjs 下载）
  const dev = join(app.getAppPath(), 'resources', 'bin', name)
  if (existsSync(dev)) return dev

  // 最后回退到系统 PATH
  return name
}

export function variantCacheDir(): string {
  const dir = join(app.getPath('userData'), 'variants')
  mkdirSync(dir, { recursive: true })
  return dir
}

// 缓存 key 包含源文件大小与 mtime，源文件被替换后会自动重新生成
export function variantFile(input: string, rate: number): string {
  const st = statSync(input)
  const key = createHash('sha1')
    .update(`${input}|${st.size}|${st.mtimeMs}|${rate}`)
    .digest('hex')
    .slice(0, 16)
  return join(variantCacheDir(), `${key}-${rate}x.flac`)
}

function probeDuration(ffmpeg: string, input: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', input], { windowsHide: true })
    let err = ''
    child.stderr.on('data', (chunk) => {
      err += chunk.toString()
      if (err.length > 64 * 1024) err = err.slice(-64 * 1024)
    })
    child.on('error', () => resolve(0))
    child.on('close', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
      if (!m) return resolve(0)
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
    })
  })
}

// 主进程侧探测曲目时长：导入后从未播放过的曲目 duration 为 0，
// 改次数时没有换算依据，这里用随包的 ffmpeg 补采一次（失败返回 0）
export async function probeAudioDuration(input: string): Promise<number> {
  const seconds = await probeDuration(resolveFfmpegPath(), input)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
}

export async function ensureVariant(
  input: string,
  rate: number,
  onProgress?: ProgressFn
): Promise<string> {
  if (!existsSync(input)) throw new Error(`文件不存在：${input}`)

  const out = variantFile(input, rate)
  if (existsSync(out) && statSync(out).size > 0) {
    onProgress?.(1)
    return out
  }

  const ffmpeg = resolveFfmpegPath()
  const total = await probeDuration(ffmpeg, input)
  const filter = buildFilter(rate)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
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
      ],
      { windowsHide: true }
    )

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 32 * 1024) stderr = stderr.slice(-32 * 1024)
    })
    child.stdout.on('data', (chunk) => {
      // 兼容不同 ffmpeg 版本：out_time_us / out_time_ms（历史上都按微秒输出）
      const done = parseProgress(chunk.toString())
      if (done === null) return
      const ratio = progressRatio(done, total, rate)
      if (ratio !== null) onProgress?.(ratio)
    })
    child.on('error', (e) => reject(new Error(`无法启动 ffmpeg：${e.message}`)))
    child.on('close', (code) => {
      if (code === 0 && existsSync(out) && statSync(out).size > 0) {
        onProgress?.(1)
        return resolve()
      }
      try {
        if (existsSync(out)) unlinkSync(out)
      } catch {
        // 忽略清理失败
      }
      reject(new Error(`ffmpeg 退出码 ${code}：${stderr.trim().slice(-400)}`))
    })
  })

  return out
}

export function prepareVariant(
  input: string,
  rate: number,
  onProgress?: ProgressFn
): Promise<VariantResult> {
  const started = Date.now()
  return ensureVariant(input, rate, onProgress).then(
    (path): VariantResult => {
      registerLog(`ok  rate=${rate} ${Date.now() - started}ms ${path}`)
      return { path }
    },
    (err: Error): VariantResult => {
      // 失败时界面只会退回内置伸缩，这里留痕便于排查（%APPDATA%/peak-player/transcode.log）
      registerLog(`fail rate=${rate} ffmpeg=${resolveFfmpegPath()} input=${input} :: ${err.message}`)
      return { error: err.message }
    }
  )
}

// 简单的追加日志，失败不影响主流程
export function registerLog(message: string): void {
  try {
    appendFileSync(
      join(app.getPath('userData'), 'transcode.log'),
      `[${new Date().toISOString()}] ${message}\n`
    )
  } catch {
    // 日志写不进去就算了
  }
}

// 启动时清理：先删过期文件，再按最近访问时间删到总量上限内
export function pruneVariantCache(): void {
  try {
    const dir = variantCacheDir()
    const now = Date.now()
    const files: { path: string; size: number; mtime: number }[] = []
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      try {
        const st = statSync(p)
        if (!st.isFile()) continue
        if (now - st.mtimeMs > CACHE_MAX_AGE_MS) {
          unlinkSync(p)
          continue
        }
        files.push({ path: p, size: st.size, mtime: st.mtimeMs })
      } catch {
        // 单个文件异常不影响整体清理
      }
    }

    let total = files.reduce((sum, f) => sum + f.size, 0)
    if (total <= CACHE_MAX_BYTES) return
    files.sort((a, b) => a.mtime - b.mtime)
    for (const f of files) {
      if (total <= CACHE_MAX_BYTES) break
      try {
        unlinkSync(f.path)
        total -= f.size
      } catch {
        // 忽略删除失败
      }
    }
  } catch {
    // 缓存目录不可用时静默跳过
  }
}
