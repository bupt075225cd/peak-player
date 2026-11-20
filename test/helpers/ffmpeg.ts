import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseFfmpegDuration } from '../../src/main/ffmpeg-args'

// 只有「能执行、且带 rubberband 滤镜」的 ffmpeg 才能跑转码集成测试。
// 仓库里的 resources/bin 是按平台下载的二进制（可能是 Windows exe），
// 所以不能只看文件存在，必须真的执行一次 --version 与 -filters。
export interface FfmpegCheck {
  available: boolean
  path: string
  reason?: string
}

let cached: FfmpegCheck | undefined

function executableCandidates(): string[] {
  const fromEnv = process.env['PEAK_FFMPEG']
  if (fromEnv) return [fromEnv]
  return [join(process.cwd(), 'resources', 'bin', 'ffmpeg'), 'ffmpeg']
}

export function detectFfmpeg(): FfmpegCheck {
  if (cached) return cached
  for (const candidate of executableCandidates()) {
    // 裸命令名交给 PATH 解析；带分隔符的路径先确认存在
    if (candidate.includes('/') && !existsSync(candidate)) continue
    try {
      execFileSync(candidate, ['-hide_banner', '-version'], { stdio: 'ignore', timeout: 10000 })
      const filters = execFileSync(candidate, ['-hide_banner', '-filters'], {
        encoding: 'utf8',
        timeout: 10000
      })
      if (!/rubberband/.test(filters)) {
        cached = { available: false, path: candidate, reason: 'ffmpeg 缺少 rubberband 滤镜' }
        continue
      }
      cached = { available: true, path: candidate }
      return cached
    } catch {
      // 继续尝试下一个候选
    }
  }
  cached = cached ?? { available: false, path: 'ffmpeg', reason: '找不到可执行的 ffmpeg' }
  return cached
}

export function ffmpegPath(): string {
  return detectFfmpeg().path
}

// 无可用 ffmpeg 时整组跳过（本机开发机常见），CI 上有则全跑
export const FFMPEG = detectFfmpeg()

// 与 transcode.ts 内部探测同构：`ffmpeg -i <file>` 的 stderr 里取 Duration
export function probeWithFfmpeg(bin: string, input: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', input], { windowsHide: true })
    let err = ''
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.on('error', () => resolve(0))
    child.on('close', () => resolve(parseFfmpegDuration(err)))
  })
}
