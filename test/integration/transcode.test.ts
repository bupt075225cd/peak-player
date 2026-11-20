import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureVariantWith, type TranscodeEnv } from '../../src/main/transcode'
import { variantFileName } from '../../src/main/variant-cache'
import { FFMPEG, probeWithFfmpeg } from '../helpers/ffmpeg'
import { makeTempDir, type TempDir } from '../helpers/tmp'
import { writeWav } from '../helpers/wav'

// 集成测试：真实 ffmpeg + rubberband + 真实文件系统。
// 机器上没有可用 ffmpeg（或缺少 rubberband）时整组跳过，CI 上有则全跑。
const describeFfmpeg = FFMPEG.available ? describe : describe.skip

describeFfmpeg('ffmpeg 变速产线', () => {
  let tmp: TempDir
  let spawnCalls = 0

  const env = (): TranscodeEnv => ({
    ffmpegPath: () => FFMPEG.path,
    outputFor: (input, rate) => {
      const info = statSync(input)
      const name = variantFileName(input, { size: info.size, mtimeMs: info.mtimeMs }, rate)
      return join(tmp.path, name)
    },
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawnCalls++
      return spawn(...args)
    }) as typeof spawn,
    probe: (bin, input) => probeWithFfmpeg(bin, input)
  })

  beforeEach(() => {
    tmp = makeTempDir('transcode-')
    spawnCalls = 0
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it('生成变速产物：flac 头、时长约为源时长/倍速、进度收敛到 1', async () => {
    const input = join(tmp.path, 'tone.wav')
    writeWav(input, 2)

    const progress: number[] = []
    const out = await ensureVariantWith(input, 1.25, (r) => progress.push(r), env())

    expect(existsSync(out)).toBe(true)
    expect(statSync(out).size).toBeGreaterThan(0)
    // FLAC 魔数
    expect(readFileSync(out).subarray(0, 4).toString('ascii')).toBe('fLaC')

    const outputSeconds = await probeWithFfmpeg(FFMPEG.path, out)
    expect(outputSeconds).toBeGreaterThan(1.2)
    expect(outputSeconds).toBeLessThan(2.0)

    expect(progress.at(-1)).toBe(1)
    expect(progress.every((r) => r >= 0 && r <= 1)).toBe(true)
  }, 60000)

  it('缓存命中：第二次调用不再启动 ffmpeg', async () => {
    const input = join(tmp.path, 'cached.wav')
    writeWav(input, 2)

    const first = await ensureVariantWith(input, 1.5, undefined, env())
    const callsAfterFirst = spawnCalls
    expect(callsAfterFirst).toBeGreaterThan(0)

    const progress: number[] = []
    const second = await ensureVariantWith(input, 1.5, (r) => progress.push(r), env())

    expect(second).toBe(first)
    expect(spawnCalls).toBe(callsAfterFirst)
    expect(progress).toEqual([1])
  }, 60000)

  it('产物被截断为 0 字节时视为不可用，会重新生成', async () => {
    const input = join(tmp.path, 'broken-cache.wav')
    writeWav(input, 1.5)

    const out = await ensureVariantWith(input, 1.5, undefined, env())
    truncateSync(out, 0)
    const callsBefore = spawnCalls

    const regenerated = await ensureVariantWith(input, 1.5, undefined, env())

    expect(regenerated).toBe(out)
    expect(statSync(out).size).toBeGreaterThan(0)
    expect(spawnCalls).toBeGreaterThan(callsBefore)
  }, 60000)

  it('源文件 mtime 变化会改变缓存 key，生成新产物', async () => {
    const input = join(tmp.path, 'changed.wav')
    writeWav(input, 1.5)

    const first = await ensureVariantWith(input, 1.2, undefined, env())

    const future = new Date(Date.now() + 60000)
    utimesSync(input, future, future)
    const second = await ensureVariantWith(input, 1.2, undefined, env())

    expect(second).not.toBe(first)
    expect(existsSync(first)).toBe(true)
    expect(existsSync(second)).toBe(true)
  }, 60000)

  it('输入文件不存在时直接报错，不启动 ffmpeg', async () => {
    await expect(ensureVariantWith(join(tmp.path, 'nope.wav'), 1.5, undefined, env())).rejects.toThrow(
      '文件不存在'
    )
    expect(spawnCalls).toBe(0)
  })

  it('非音频输入转码失败，且不留下半成品文件', async () => {
    const input = join(tmp.path, 'not-audio.wav')
    writeFileSync(input, 'this is definitely not audio')
    const out = env().outputFor(input, 1.5)

    await expect(ensureVariantWith(input, 1.5, undefined, env())).rejects.toThrow(/ffmpeg 退出码/)

    expect(existsSync(out)).toBe(false)
  }, 60000)

  it('ffmpeg 不可执行时给出可读错误', async () => {
    const input = join(tmp.path, 'tone.wav')
    writeWav(input, 1)

    await expect(
      ensureVariantWith(input, 1.5, undefined, {
        ...env(),
        ffmpegPath: () => join(tmp.path, 'missing-ffmpeg')
      })
    ).rejects.toThrow(/无法启动 ffmpeg/)
  }, 30000)

  it('0.7x 与 1.5x 产物时长方向相反（降速变长、加速变短）', async () => {
    const slowInput = join(tmp.path, 'slow.wav')
    writeWav(slowInput, 2)
    const slow = await ensureVariantWith(slowInput, 0.7, undefined, env())
    const slowSeconds = await probeWithFfmpeg(FFMPEG.path, slow)

    const fastInput = join(tmp.path, 'fast.wav')
    writeWav(fastInput, 2)
    const fast = await ensureVariantWith(fastInput, 1.5, undefined, env())
    const fastSeconds = await probeWithFfmpeg(FFMPEG.path, fast)

    expect(slowSeconds).toBeGreaterThan(fastSeconds)
    expect(slowSeconds).toBeGreaterThan(2.4)
    expect(fastSeconds).toBeLessThan(1.6)
  }, 90000)
})
