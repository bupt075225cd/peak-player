import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMediaResponse } from '../../src/main/protocol'
import { makePatternBuffer, writeWav } from '../helpers/wav'
import { makeTempDir, type TempDir } from '../helpers/tmp'

// 集成测试：真实文件系统 + 注入的 stat/stream 默认实现，
// 验证 media:// 协议从「请求 URL」到「状态码 + 头部 + 字节流」的整条链路。
// 纯函数层（range / media-request）已有单测，这里只测接线与真实 I/O。

function mediaRequest(filePath: string, range?: string): { url: string; headers: Headers } {
  const url = 'media://play?path=' + encodeURIComponent(filePath)
  const headers = new Headers()
  if (range !== undefined) headers.set('range', range)
  return { url, headers }
}

async function bodyOf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer())
}

describe('media:// 协议（真实文件）', () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = makeTempDir('media-')
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it('无 Range 时返回 200，头部与整文件字节都正确', async () => {
    const file = tmp.file('song.mp3')
    const pattern = makePatternBuffer(4096)
    writeFileSync(file, pattern)

    const res = await createMediaResponse(mediaRequest(file))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('4096')
    expect(res.headers.get('content-range')).toBeNull()
    expect(await bodyOf(res)).toEqual(pattern)
  })

  it.each([
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.flac', 'audio/flac'],
    ['.m4a', 'audio/mp4'],
    ['.aac', 'audio/aac'],
    ['.ogg', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.bin', 'application/octet-stream']
  ])('%s 的 Content-Type 为 %s', async (ext, mime) => {
    const file = tmp.file(`song${ext}`)
    writeFileSync(file, makePatternBuffer(64))

    const res = await createMediaResponse(mediaRequest(file))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(mime)
  })

  it.each([
    ['bytes=0-', 0, 999],
    ['bytes=100-', 100, 999],
    ['bytes=0-99', 0, 99],
    ['bytes=-500', 500, 999]
  ])('%s 返回 206 且字节偏移精确', async (header, start, end) => {
    const file = tmp.file('range.mp3')
    const pattern = makePatternBuffer(1000)
    writeFileSync(file, pattern)

    const res = await createMediaResponse(mediaRequest(file, header))

    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/1000`)
    expect(res.headers.get('content-length')).toBe(String(end - start + 1))
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await bodyOf(res)).toEqual(pattern.subarray(start, end + 1))
  })

  it('越界区间返回 416 并带 content-range: bytes */size', async () => {
    const file = tmp.file('short.mp3')
    writeFileSync(file, makePatternBuffer(100))

    const res = await createMediaResponse(mediaRequest(file, 'bytes=200-300'))

    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */100')
  })

  it('空文件上的 Range 请求返回 416（不产生非法区间）', async () => {
    const file = tmp.file('empty.mp3')
    writeFileSync(file, '')

    const res = await createMediaResponse(mediaRequest(file, 'bytes=0-'))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */0')

    const full = await createMediaResponse(mediaRequest(file))
    expect(full.status).toBe(200)
    expect(full.headers.get('content-length')).toBe('0')
  })

  it('bytes=-0 视为不可满足', async () => {
    const file = tmp.file('x.mp3')
    writeFileSync(file, makePatternBuffer(10))

    const res = await createMediaResponse(mediaRequest(file, 'bytes=-0'))
    expect(res.status).toBe(416)
  })

  it('多段 Range 降级为整文件 200（现状行为）', async () => {
    const file = tmp.file('multi.mp3')
    const pattern = makePatternBuffer(200)
    writeFileSync(file, pattern)

    const res = await createMediaResponse(mediaRequest(file, 'bytes=0-1,5-9'))

    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual(pattern)
  })

  it('文件不存在返回 404', async () => {
    const res = await createMediaResponse(mediaRequest(tmp.file('missing.mp3')))
    expect(res.status).toBe(404)
  })

  it('路径指向目录时返回 404', async () => {
    const dir = join(tmp.path, 'folder.mp3')
    mkdirSync(dir)

    const res = await createMediaResponse(mediaRequest(dir))
    expect(res.status).toBe(404)
  })

  it('缺少 path 参数返回 400', async () => {
    const res = await createMediaResponse({ url: 'media://play', headers: new Headers() })
    expect(res.status).toBe(400)
  })

  it('非法 URL 返回 400', async () => {
    const res = await createMediaResponse({ url: 'not a url', headers: new Headers() })
    expect(res.status).toBe(400)
  })

  // 名字里只放「各平台文件系统都合法」的字符：? * : " < > | 在 Windows 上不能建文件
  it.each([
    '中文 歌名.mp3',
    'with space.mp3',
    'hash#tag.mp3',
    'amp&sand.mp3',
    "quote'single.mp3",
    '音节 ñ ǔ 🎵.flac'
  ])('特殊字符文件名可正常取到内容：%s', async (name) => {
    const file = tmp.file(name)
    const pattern = makePatternBuffer(128)
    writeFileSync(file, pattern)

    const res = await createMediaResponse(mediaRequest(file))

    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual(pattern)
  })

  // Windows 不允许 ? 出现在文件名里，真实落盘只在 POSIX 上验证
  it.skipIf(process.platform === 'win32')('含 ? 的文件名在 POSIX 上可正常取到内容', async () => {
    const file = tmp.file('query?mark.mp3')
    const pattern = makePatternBuffer(128)
    writeFileSync(file, pattern)

    const res = await createMediaResponse(mediaRequest(file))

    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual(pattern)
  })

  // 平台无关：用注入的 fs 验证「URL 编码 → 还原成原始路径」不会在 ? 处截断
  it('路径含 ? 时 URL 编码往返不失真', async () => {
    const filePath = join(tmp.path, 'query?mark.mp3')
    const statCalls: string[] = []

    const res = await createMediaResponse(mediaRequest(filePath), {
      stat: async (p) => {
        statCalls.push(p)
        return { isFile: () => true, size: 3 }
      },
      createStream: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([7, 8, 9]))
            controller.close()
          }
        })
    })

    expect(statCalls).toEqual([filePath])
    expect(res.status).toBe(200)
    expect([...((await bodyOf(res)) as Buffer)]).toEqual([7, 8, 9])
  })

  it('真实 WAV 文件按字节完整返回', async () => {
    const file = tmp.file('tone.wav')
    const size = writeWav(file, 1.5)

    const res = await createMediaResponse(mediaRequest(file))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(size))
    expect((await bodyOf(res)).length).toBe(size)
  })

  it('stat 抛错（权限不足等）归一化为 404，不向上抛异常', async () => {
    const file = tmp.file('denied.mp3')
    writeFileSync(file, makePatternBuffer(10))

    const res = await createMediaResponse(mediaRequest(file), {
      stat: async () => {
        throw new Error('EACCES')
      }
    })

    expect(res.status).toBe(404)
  })
})
