import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, type TempDir } from '../helpers/tmp'

// 打包冒烟的两层保障：
// 1) 配置层：electron-builder 必须把 ffmpeg 拷进包（extraResources），且不塞进 asar
// 2) 产物层：scripts/check-package.mjs 对真实产物做存在性 + 可执行 + rubberband 校验
// 这里用构造出来的假产物目录验证脚本的判定逻辑，真实产物由 package:* 脚本与 CI 兜底。

const SCRIPT = 'scripts/check-package.mjs'
const MB = 1024 * 1024

function runSmoke(releaseDir: string) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env, PEAK_RELEASE_DIR: releaseDir },
    encoding: 'utf8'
  })
  return { code: result.status, out: result.stdout ?? '', err: result.stderr ?? '' }
}

// 造一个「体积达标、能执行、-filters 里有 rubberband」的假 ffmpeg
function writeFakeFfmpeg(path: string): void {
  const script = ['#!/bin/sh', 'case "$*" in', '  *-filters*) echo " ... rubberband ...";;', 'esac', 'exit 0', ''].join('\n')
  // 脚本必须超过 1MB 才会被判定为「完整二进制」，用注释补足体积
  const padding = '# padding to exceed the size threshold\n'.repeat(Math.ceil(MB / 40) + 200)
  writeFileSync(path, script + padding)
  chmodSync(path, 0o755)
}

function artifact(release: string, name: string, ffmpegName: string | null): string {
  const binDir = join(release, name, 'resources', 'bin')
  mkdirSync(binDir, { recursive: true })
  if (ffmpegName) writeFileSync(join(binDir, ffmpegName), '')
  return binDir
}

describe('打包配置：ffmpeg 必须随包', () => {
  const yml = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }

  it('extraResources 把 resources/bin 拷到包内 bin', () => {
    expect(yml).toMatch(/extraResources:\s*\n\s*-\s*from:\s*resources\/bin\s*\n\s*to:\s*bin/)
  })

  it('resources/bin 被排除在 asar 之外（asar 内的二进制 spawn 不到）', () => {
    expect(yml).toContain("'!resources/bin/**'")
  })

  it('三个打包脚本都在出包后执行冒烟校验', () => {
    for (const name of ['package:win', 'package:mac', 'package:linux']) {
      expect(pkg.scripts[name]).toContain('node scripts/check-package.mjs')
    }
  })
})

describe('冒烟脚本判定逻辑', () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = makeTempDir('pkg-')
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it('没有 release 目录时明确失败', () => {
    const result = runSmoke(join(tmp.path, 'not-created'))

    expect(result.code).toBe(1)
    expect(result.err).toContain('没有找到打包产物')
  })

  it('产物里缺 resources/bin/ffmpeg 时失败', () => {
    artifact(tmp.path, 'win-unpacked', null)

    const result = runSmoke(tmp.path)

    expect(result.code).toBe(1)
    expect(result.err).toContain('没有 resources/bin/ffmpeg')
    expect(result.err).toContain('extraResources')
  })

  it('ffmpeg 是下载失败的残骸（体积异常）时失败', () => {
    const binDir = artifact(tmp.path, 'win-unpacked', 'ffmpeg.exe')
    writeFileSync(join(binDir, 'ffmpeg.exe'), 'partial')

    const result = runSmoke(tmp.path)

    expect(result.code).toBe(1)
    expect(result.err).toContain('体积异常')
  })

  it('Windows 产物里的二进制被命名成 ffmpeg（交叉打包下错平台）时失败', () => {
    const binDir = artifact(tmp.path, 'win-unpacked', 'ffmpeg')
    writeFileSync(join(binDir, 'ffmpeg'), Buffer.alloc(2 * MB))

    const result = runSmoke(tmp.path)

    expect(result.code).toBe(1)
    expect(result.err).toContain('文件名应为 ffmpeg.exe')
  })

  it.skipIf(process.platform === 'win32')('宿主平台产物可执行且带 rubberband 时通过', () => {
    const binDir = artifact(tmp.path, 'linux-unpacked', 'ffmpeg')
    writeFakeFfmpeg(join(binDir, 'ffmpeg'))

    const result = runSmoke(tmp.path)

    expect(result.code).toBe(0)
    expect(result.out).toContain('打包产物冒烟通过')
    expect(result.out).toContain('ok')
  })

  it.skipIf(process.platform === 'win32')('宿主平台二进制缺少 rubberband 时失败', () => {
    const binDir = artifact(tmp.path, 'linux-unpacked', 'ffmpeg')
    const noRubberband = ['#!/bin/sh', 'exit 0', ''].join('\n')
    writeFileSync(join(binDir, 'ffmpeg'), noRubberband.padEnd(2 * MB, '#'))
    chmodSync(join(binDir, 'ffmpeg'), 0o755)

    const result = runSmoke(tmp.path)

    expect(result.code).toBe(1)
    expect(result.err).toContain('缺少 rubberband')
  })
})
