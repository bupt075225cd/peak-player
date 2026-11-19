import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ffmpegBinaryName, resolveFfmpegPathWith } from './ffmpeg-path'

const LINUX_PACKAGED = join('/opt/app/resources', 'bin', 'ffmpeg')
const LINUX_DEV = join('/home/u/peak-player', 'resources', 'bin', 'ffmpeg')

function options(overrides: Partial<Parameters<typeof resolveFfmpegPathWith>[0]> = {}) {
  return {
    platform: 'linux' as NodeJS.Platform,
    isPackaged: false,
    resourcesPath: '/opt/app/resources',
    appPath: '/home/u/peak-player',
    exists: () => false,
    ...overrides
  }
}

describe('ffmpegBinaryName', () => {
  it('Windows 用 ffmpeg.exe，其余平台用 ffmpeg', () => {
    expect(ffmpegBinaryName('win32')).toBe('ffmpeg.exe')
    expect(ffmpegBinaryName('linux')).toBe('ffmpeg')
    expect(ffmpegBinaryName('darwin')).toBe('ffmpeg')
  })
})

describe('resolveFfmpegPathWith', () => {
  it('显式环境变量优先于一切', () => {
    expect(
      resolveFfmpegPathWith(options({ fromEnv: '/custom/ffmpeg', isPackaged: true, exists: () => true }))
    ).toBe('/custom/ffmpeg')
  })

  it('打包态优先使用 resources/bin 下的二进制', () => {
    expect(resolveFfmpegPathWith(options({ isPackaged: true, exists: () => true }))).toBe(
      LINUX_PACKAGED
    )
  })

  it('打包态但资源不存在时回落到开发态路径', () => {
    const path = resolveFfmpegPathWith(
      options({ isPackaged: true, exists: (p) => p === LINUX_DEV })
    )
    expect(path).toBe(LINUX_DEV)
  })

  it('开发态使用项目内 resources/bin', () => {
    expect(resolveFfmpegPathWith(options({ exists: (p) => p === LINUX_DEV }))).toBe(LINUX_DEV)
  })

  it('都没有时回退到 PATH 里的裸命令名', () => {
    expect(resolveFfmpegPathWith(options({ exists: () => false }))).toBe('ffmpeg')
  })

  it('Windows 上拼出 ffmpeg.exe', () => {
    const path = resolveFfmpegPathWith(
      options({ platform: 'win32', isPackaged: true, exists: () => true })
    )
    expect(path.endsWith('ffmpeg.exe')).toBe(true)
  })

  it('空 fromEnv 视为未设置', () => {
    expect(resolveFfmpegPathWith(options({ fromEnv: '', isPackaged: true, exists: () => true }))).toBe(
      LINUX_PACKAGED
    )
  })
})
