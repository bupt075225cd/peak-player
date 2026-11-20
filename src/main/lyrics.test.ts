import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  candidateLyricPaths,
  clearLyricsCache,
  decodeLyricBuffer,
  loadLyrics,
  MAX_LYRIC_BYTES,
  type LyricIo
} from './lyrics'

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

// GBK 编码的「你好」：证明非 UTF-8 歌词不会变成乱码
const GBK_HELLO = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3])

// 路径断言一律用 node:path 拼：CI 在 Windows 跑，写死 `/music/a.lrc` 会因分隔符不同而红
const AUDIO = join('/music', 'a.mp3')
const LRC = join('/music', 'a.lrc')
const LRC_UPPER = join('/music', 'a.LRC')

// 同时用 posix / win32 两套 path 跑同一组断言：CI 只在 Windows 上跑，
// 显式覆盖另一种分隔符后，Linux 上的 pre-push 也能提前发现路径回归
const PATH_STYLES = [
  { name: 'posix', api: posix, audio: '/music/a.mp3', dir: '/music' },
  { name: 'win32', api: win32, audio: 'C:\\music\\a.mp3', dir: 'C:\\music' }
]

describe.each(PATH_STYLES)('candidateLyricPaths（$name 路径）', ({ api, audio, dir }) => {
  it('同目录同名，大小写两种扩展', () => {
    expect(candidateLyricPaths(audio, api)).toEqual([
      api.join(dir, 'a.lrc'),
      api.join(dir, 'a.LRC')
    ])
  })

  it('带多个点的文件名只去掉最后一个扩展名', () => {
    expect(candidateLyricPaths(api.join(dir, '歌手 - 歌名.flac'), api)[0]).toBe(
      api.join(dir, '歌手 - 歌名.lrc')
    )
    expect(candidateLyricPaths(api.join(dir, '01.02.track.m4a'), api)[0]).toBe(
      api.join(dir, '01.02.track.lrc')
    )
  })

  it('没有扩展名时直接拼 .lrc', () => {
    expect(candidateLyricPaths(api.join(dir, 'demo'), api)[0]).toBe(api.join(dir, 'demo.lrc'))
  })

  it('空路径没有候选文件', () => {
    expect(candidateLyricPaths('', api)).toEqual([])
  })
})

describe('candidateLyricPaths 分隔符', () => {
  it('Windows 风格路径只产生反斜杠', () => {
    const [lower] = candidateLyricPaths('C:\\music\\a.mp3', win32)

    expect(lower).toBe('C:\\music\\a.lrc')
    expect(lower).not.toContain('/')
  })

  it('显式传入 posix 时不产生反斜杠', () => {
    const [lower] = candidateLyricPaths('/music/a.mp3', posix)

    expect(lower).toBe('/music/a.lrc')
    expect(lower).not.toContain('\\')
  })
})

describe('decodeLyricBuffer', () => {
  it('UTF-8 原样解码', () => {
    expect(decodeLyricBuffer(encodeUtf8('[00:01.00]你好'))).toBe('[00:01.00]你好')
  })

  it('剥掉 UTF-8 BOM', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encodeUtf8('[00:01.00]a')])
    expect(decodeLyricBuffer(withBom)).toBe('[00:01.00]a')
  })

  it('GBK 歌词回退解码', () => {
    expect(decodeLyricBuffer(GBK_HELLO)).toBe('你好')
  })

  it('UTF-16LE / BE 按 BOM 解码', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])
    expect(decodeLyricBuffer(le)).toBe('你好')

    const be = new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d])
    expect(decodeLyricBuffer(be)).toBe('你好')
  })

  it('空缓冲区与过短缓冲区返回空串', () => {
    expect(decodeLyricBuffer(new Uint8Array())).toBe('')
    // 短到连 BOM 都放不下：各前缀判定都要安全跳过
    expect(decodeLyricBuffer(new Uint8Array([0x41]))).toBe('A')
  })
})

describe('loadLyrics', () => {
  interface FakeIo extends LyricIo {
    reads: string[]
    stats: string[]
  }

  function fakeIo(
    files: Record<string, { content: string | Uint8Array; size?: number; mtimeMs?: number }>,
    options: { readError?: boolean } = {}
  ): FakeIo {
    const reads: string[] = []
    const stats: string[] = []
    return {
      reads,
      stats,
      stat: async (p) => {
        stats.push(p)
        const file = files[p]
        if (!file) throw new Error('ENOENT')
        const content =
          typeof file.content === 'string' ? encodeUtf8(file.content) : file.content
        return { size: file.size ?? content.length, mtimeMs: file.mtimeMs ?? 1 }
      },
      read: async (p) => {
        reads.push(p)
        if (options.readError) throw new Error('EACCES')
        const file = files[p]!
        return typeof file.content === 'string' ? encodeUtf8(file.content) : file.content
      }
    }
  }

  beforeEach(() => clearLyricsCache())
  afterEach(() => clearLyricsCache())

  it('解析同名 .lrc 并标记来源', async () => {
    const io = fakeIo({ [LRC]: { content: '[00:01.00]你好' } })

    const doc = await loadLyrics(AUDIO, io)

    expect(doc).toEqual({ lines: [{ time: 1, text: '你好' }], offset: 0, source: 'sidecar' })
  })

  it('小写不存在时回退大写 .LRC', async () => {
    const io = fakeIo({ [LRC_UPPER]: { content: '[00:02.00]hi' } })

    const doc = await loadLyrics(AUDIO, io)

    expect(doc.lines).toEqual([{ time: 2, text: 'hi' }])
    expect(io.reads).toEqual([LRC_UPPER])
  })

  it('没有歌词文件时返回空文档', async () => {
    const io = fakeIo({})

    expect(await loadLyrics(AUDIO, io)).toEqual({
      lines: [],
      offset: 0,
      source: 'none'
    })
  })

  it('空文件与超过体积上限的文件被忽略', async () => {
    const io = fakeIo({
      [join('/music', 'empty.lrc')]: { content: '', size: 0 },
      [join('/music', 'huge.lrc')]: { content: '[00:01.00]a', size: MAX_LYRIC_BYTES + 1 }
    })

    expect((await loadLyrics(join('/music', 'empty.mp3'), io)).source).toBe('none')
    expect((await loadLyrics(join('/music', 'huge.mp3'), io)).source).toBe('none')
    expect(io.reads).toEqual([])
  })

  it('有文件但没有有效时间戳时来源仍为 none', async () => {
    const io = fakeIo({ [LRC]: { content: '这不是歌词' } })

    const doc = await loadLyrics(AUDIO, io)

    expect(doc.lines).toEqual([])
    expect(doc.source).toBe('none')
  })

  it('读盘失败不影响播放，降级为空文档', async () => {
    const io = fakeIo({ [LRC]: { content: '[00:01.00]a' } }, { readError: true })

    expect(await loadLyrics(AUDIO, io)).toEqual({
      lines: [],
      offset: 0,
      source: 'none'
    })
  })

  it('同一文件 mtime/size 未变时命中缓存，不再读盘', async () => {
    const io = fakeIo({ [LRC]: { content: '[00:01.00]a', mtimeMs: 100 } })

    await loadLyrics(AUDIO, io)
    await loadLyrics(AUDIO, io)

    expect(io.stats).toHaveLength(2) // 每次都 stat，保证文件变化能被发现
    expect(io.reads).toHaveLength(1)
  })

  it('文件被修改后缓存失效并重新解析', async () => {
    const files = { [LRC]: { content: '[00:01.00]旧', mtimeMs: 100 } }
    const io = fakeIo(files)

    expect((await loadLyrics(AUDIO, io)).lines[0]?.text).toBe('旧')

    files[LRC] = { content: '[00:01.00]新', mtimeMs: 200 }
    expect((await loadLyrics(AUDIO, io)).lines[0]?.text).toBe('新')
    expect(io.reads).toHaveLength(2)
  })

  it('大小变化（即使 mtime 相同）也会重新读盘', async () => {
    const files = { [LRC]: { content: '[00:01.00]a', mtimeMs: 100 } }
    const io = fakeIo(files)

    await loadLyrics(AUDIO, io)
    files[LRC] = { content: '[00:01.00]ab', mtimeMs: 100 }

    expect((await loadLyrics(AUDIO, io)).lines[0]?.text).toBe('ab')
    expect(io.reads).toHaveLength(2)
  })

  it('空音频路径直接返回空文档', async () => {
    expect((await loadLyrics('', fakeIo({}))).source).toBe('none')
  })

  it('真实文件系统：读盘 + 中文路径 + 文件更新', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'peak-lyrics-'))
    try {
      const audio = join(dir, '歌手 - 歌名.mp3')
      const lyric = join(dir, '歌手 - 歌名.lrc')
      await writeFile(lyric, '[00:03.00]第一版', 'utf8')

      const first = await loadLyrics(audio)
      expect(first.source).toBe('sidecar')
      expect(first.lines[0]?.text).toBe('第一版')

      await writeFile(lyric, '[00:03.00]第二版', 'utf8')
      await utimes(lyric, new Date(), new Date(Date.now() + 1000))

      const second = await loadLyrics(audio)
      expect(second.lines[0]?.text).toBe('第二版')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
