import { join } from 'node:path'

// ffmpeg 可执行文件定位。环境（是否打包、资源目录、存在性判断）由调用方注入，
// 这样四条回退分支都能在单测里覆盖，不需要真的跑 electron。

export interface FfmpegPathOptions {
  platform: NodeJS.Platform
  // 显式覆盖（开发调试用，对应 PEAK_FFMPEG 环境变量）
  fromEnv?: string
  isPackaged: boolean
  resourcesPath: string
  appPath: string
  exists: (path: string) => boolean
}

export function ffmpegBinaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

export function resolveFfmpegPathWith(options: FfmpegPathOptions): string {
  const name = ffmpegBinaryName(options.platform)

  if (options.fromEnv) return options.fromEnv

  // 打包态：ffmpeg 通过 extraResources 落到 resources/bin
  const packaged = join(options.resourcesPath, 'bin', name)
  if (options.isPackaged && options.exists(packaged)) return packaged

  // 开发态：项目内 resources/bin（由 scripts/fetch-ffmpeg.mjs 下载）
  const dev = join(options.appPath, 'resources', 'bin', name)
  if (options.exists(dev)) return dev

  // 最后回退到系统 PATH
  return name
}
