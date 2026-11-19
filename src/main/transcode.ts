import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { VariantResult } from '../shared/types'
import { buildFilter, parseFfmpegDuration, parseProgress, progressRatio } from './ffmpeg-args'
import { resolveFfmpegPathWith } from './ffmpeg-path'
import {
  appendCapped,
  buildTranscodeArgs,
  formatExitError,
  formatSpawnError,
  formatTranscodeLog,
  isUsableVariant
} from './transcode-pure'
import { ensureVariantCacheDir, pruneCacheDir, variantFileName } from './variant-cache'

// 变速预渲染：用 ffmpeg 的 rubberband 滤镜离线生成「变速不变调」的文件，
// 质量远好于 Chromium 内置的 WSOLA 时间伸缩（后者在 0.8x 会有明显金属感）。
// 纯逻辑（滤镜串、进度解析、缓存策略、参数拼装、路径回退）都在独立模块里，便于单测。

export type ProgressFn = (ratio: number) => void

const PROBE_STDERR_LIMIT = 64 * 1024
const TRANSCODE_STDERR_LIMIT = 32 * 1024

export function resolveFfmpegPath(): string {
  return resolveFfmpegPathWith({
    platform: process.platform,
    fromEnv: process.env['PEAK_FFMPEG'],
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? '',
    appPath: app.getAppPath(),
    exists: existsSync
  })
}

export function variantCacheDir(): string {
  return ensureVariantCacheDir(app.getPath('userData'))
}

export function variantFile(input: string, rate: number): string {
  const info = statSync(input)
  const name = variantFileName(input, { size: info.size, mtimeMs: info.mtimeMs }, rate)
  return join(variantCacheDir(), name)
}

// 文件是否存在、多少字节；不存在或读不到属性时返回 null，交给 isUsableVariant 判定
function usableFileSize(path: string): number | null {
  try {
    return existsSync(path) ? statSync(path).size : null
  } catch {
    return null
  }
}

function probeDuration(ffmpeg: string, input: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', input], { windowsHide: true })
    let err = ''
    child.stderr.on('data', (chunk) => {
      err = appendCapped(err, chunk.toString(), PROBE_STDERR_LIMIT)
    })
    child.on('error', () => resolve(0))
    child.on('close', () => resolve(parseFfmpegDuration(err)))
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
  if (isUsableVariant(usableFileSize(out))) {
    onProgress?.(1)
    return out
  }

  const ffmpeg = resolveFfmpegPath()
  const total = await probeDuration(ffmpeg, input)
  const filter = buildFilter(rate)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, buildTranscodeArgs(input, filter, out), { windowsHide: true })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk.toString(), TRANSCODE_STDERR_LIMIT)
    })
    child.stdout.on('data', (chunk) => {
      // 兼容不同 ffmpeg 版本：out_time_us / out_time_ms（历史上都按微秒输出）
      const done = parseProgress(chunk.toString())
      if (done === null) return
      const ratio = progressRatio(done, total, rate)
      if (ratio !== null) onProgress?.(ratio)
    })
    child.on('error', (e) => reject(new Error(formatSpawnError(e.message))))
    child.on('close', (code) => {
      if (code === 0 && isUsableVariant(usableFileSize(out))) {
        onProgress?.(1)
        return resolve()
      }
      try {
        if (existsSync(out)) unlinkSync(out)
      } catch {
        // 忽略清理失败
      }
      reject(new Error(formatExitError(code, stderr)))
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
      registerLog(formatTranscodeLog(true, rate, `${Date.now() - started}ms ${path}`))
      return { path }
    },
    (err: Error): VariantResult => {
      // 失败时界面只会退回内置伸缩，这里留痕便于排查（%APPDATA%/peak-player/transcode.log）
      registerLog(
        formatTranscodeLog(
          false,
          rate,
          `ffmpeg=${resolveFfmpegPath()} input=${input} :: ${err.message}`
        )
      )
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
  pruneCacheDir(variantCacheDir())
}
