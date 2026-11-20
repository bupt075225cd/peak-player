import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricDoc, Track } from '../../../shared/types'
import { useLyricsStore } from './lyrics'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: '1',
    title: 'song',
    path: '/music/song.mp3',
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 200,
    ...overrides
  }
}

const doc: LyricDoc = {
  lines: [
    { time: 1, text: '第一句' },
    { time: 5, text: '第二句' }
  ],
  offset: 0.5,
  source: 'sidecar'
}

describe('lyrics store', () => {
  let getLyrics: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    getLyrics = vi.fn(async () => doc)
    vi.stubGlobal('window', { api: { getLyrics } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('加载歌词并写入 store', async () => {
    const lyrics = useLyricsStore()
    await lyrics.load(makeTrack())

    expect(getLyrics).toHaveBeenCalledWith('/music/song.mp3')
    expect(lyrics.lines).toEqual(doc.lines)
    expect(lyrics.offset).toBe(0.5)
    expect(lyrics.source).toBe('sidecar')
    expect(lyrics.loading).toBe(false)
  })

  it('加载期间 loading 为 true，解决后复位', async () => {
    let release!: (value: LyricDoc) => void
    getLyrics.mockImplementationOnce(
      () =>
        new Promise<LyricDoc>((resolve) => {
          release = resolve
        })
    )
    const lyrics = useLyricsStore()
    const pending = lyrics.load(makeTrack())

    expect(lyrics.loading).toBe(true)
    release(doc)
    await pending
    expect(lyrics.loading).toBe(false)
  })

  it('切歌时立即清空上一首歌词', async () => {
    const lyrics = useLyricsStore()
    await lyrics.load(makeTrack())

    let release!: (value: LyricDoc) => void
    getLyrics.mockImplementationOnce(
      () =>
        new Promise<LyricDoc>((resolve) => {
          release = resolve
        })
    )
    const pending = lyrics.load(makeTrack({ id: '2', path: '/music/b.mp3' }))

    expect(lyrics.lines).toEqual([])
    expect(lyrics.source).toBe('none')

    release({ lines: [], offset: 0, source: 'none' })
    await pending
  })

  it('快速切歌时丢弃先发出的过期结果', async () => {
    const resolvers: ((value: LyricDoc) => void)[] = []
    getLyrics.mockImplementation(
      () =>
        new Promise<LyricDoc>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const lyrics = useLyricsStore()

    const first = lyrics.load(makeTrack({ id: '1', path: '/music/a.mp3' }))
    const second = lyrics.load(makeTrack({ id: '2', path: '/music/b.mp3' }))

    resolvers[1]!({ lines: [{ time: 2, text: '新歌' }], offset: 0, source: 'sidecar' })
    await second
    resolvers[0]!({ lines: [{ time: 9, text: '旧歌' }], offset: 1, source: 'sidecar' })
    await first

    expect(lyrics.lines).toEqual([{ time: 2, text: '新歌' }])
    expect(lyrics.offset).toBe(0)
    expect(lyrics.loading).toBe(false)
  })

  it('没有当前曲目时清空并从「未加载」状态返回', async () => {
    const lyrics = useLyricsStore()
    await lyrics.load(makeTrack())
    await lyrics.load(null)

    expect(getLyrics).toHaveBeenCalledTimes(1)
    expect(lyrics.lines).toEqual([])
    expect(lyrics.source).toBe('none')
    expect(lyrics.loading).toBe(false)
  })

  it('IPC 失败按无歌词处理，不向调用方抛错', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    getLyrics.mockRejectedValueOnce(new Error('IPC 断开'))
    const lyrics = useLyricsStore()

    await expect(lyrics.load(makeTrack())).resolves.toBeUndefined()

    expect(lyrics.lines).toEqual([])
    expect(lyrics.source).toBe('none')
    expect(lyrics.loading).toBe(false)
  })
})
