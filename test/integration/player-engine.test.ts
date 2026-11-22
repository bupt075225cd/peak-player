import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialPlayerState,
  PlayerEngine,
  type PlayerState
} from '../../src/renderer/src/core/player-engine'
import { FakeAudio } from '../helpers/fake-audio'
import { createFakeApi, makeTrack, type FakeApi } from '../helpers/fake-api'

// 集成测试：真实播放引擎状态机 + 假 Audio + 记录型 api。
// 覆盖倍速预渲染/降级、时间轴换算、循环计数、计时结算、错误兜底等跨模块行为。

describe('PlayerEngine', () => {
  let audio: FakeAudio
  let api: FakeApi
  let state: PlayerState
  let syncPlayCount: ReturnType<typeof vi.fn>
  let engine: PlayerEngine

  // 每次都新建 audio/api：同一假 Audio 上挂两个引擎会让旧实例的 play 事件
  // 重置计时起点，测出来的用时是错的（正是这里踩过的坑）
  function build(overrides: { intervalMs?: number } = {}): void {
    audio = new FakeAudio()
    api = createFakeApi()
    state = createInitialPlayerState()
    syncPlayCount = vi.fn()
    engine = new PlayerEngine({
      audio,
      api,
      state,
      syncPlayCount,
      intervalMs: overrides.intervalMs
    })
  }

  beforeEach(() => {
    build()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('构造时关闭变调并注册进度监听', () => {
    expect(audio.preservesPitch).toBe(true)
    expect(api.progressListenerCount()).toBe(1)
  })

  describe('播放与加载', () => {
    it('播放本地曲目时使用 media:// 协议并置为播放中', async () => {
      const track = makeTrack({ path: '/music/中文 歌.mp3' })

      await engine.play(track)

      expect(state.current?.id).toBe('t1')
      expect(audio.src).toBe('media://play?path=' + encodeURIComponent(track.path))
      expect(audio.playbackRate).toBe(1)
      expect(audio.loadCalls).toBe(1)
      expect(state.playing).toBe(true)
      expect(state.error).toBe('')
    })

    it('远程源直接使用原始地址', async () => {
      await engine.play(makeTrack({ sourceType: 'remote', path: 'https://cdn/a.mp3' }))
      expect(audio.src).toBe('https://cdn/a.mp3')
    })

    it('play() 被拒绝时把错误暴露到界面并保持暂停', async () => {
      audio.playError = new Error('NotAllowedError')

      await engine.play(makeTrack())

      expect(state.playing).toBe(false)
      expect(state.error).toBe('播放失败：NotAllowedError')
    })

    it('没有 src 且未指定曲目时不调用 play', async () => {
      await engine.play()
      expect(audio.playCalls).toBe(0)
    })
  })

  describe('倍速与 ffmpeg 预渲染', () => {
    it('1.25x 走预渲染：src 换成产物、playbackRate 保持 1', async () => {
      await engine.play(makeTrack())

      await engine.setRate(1.25)

      expect(api.calls.prepareVariant).toEqual([['/music/a.mp3', 1.25]])
      expect(audio.src).toBe('media://play?path=' + encodeURIComponent('/cache/1.25x.flac'))
      expect(audio.playbackRate).toBe(1)
      expect(state.fallback).toBe(false)
      expect(state.playing).toBe(true)
    })

    it('预渲染失败时退回内置伸缩，且之后不再重试 ffmpeg', async () => {
      api.prepareVariant = vi.fn(async () => ({ error: 'ffmpeg 挂了' }))
      await engine.play(makeTrack())

      await engine.setRate(1.25)

      expect(state.fallback).toBe(true)
      expect(audio.playbackRate).toBe(1.25)
      expect(audio.src).toBe('media://play?path=' + encodeURIComponent('/music/a.mp3'))

      await engine.setRate(1.5)
      expect(api.prepareVariant).toHaveBeenCalledTimes(1)
      expect(audio.playbackRate).toBe(1.5)
    })

    it('预渲染抛异常同样降级，不把异常抛给调用方', async () => {
      api.prepareVariant = vi.fn(async () => {
        throw new Error('IPC 断开')
      })
      await engine.play(makeTrack())

      await expect(engine.setRate(1.1)).resolves.toBeUndefined()

      expect(state.fallback).toBe(true)
      expect(state.preparing).toBe(false)
    })

    it('越界倍速被钳制，非法值回到 1x', async () => {
      await engine.play(makeTrack())

      await engine.setRate(3)
      expect(state.rate).toBe(1.5)

      await engine.setRate(Number.NaN)
      expect(state.rate).toBe(1)
    })

    it('相同倍速不重复触发预渲染', async () => {
      await engine.play(makeTrack())
      await engine.setRate(1.25)
      const calls = api.calls.prepareVariant.length

      await engine.setRate(1.25)

      expect(api.calls.prepareVariant).toHaveLength(calls)
    })

    it('未播放曲目时切换倍速只更新状态', async () => {
      await engine.setRate(1.5)

      expect(state.rate).toBe(1.5)
      expect(api.calls.prepareVariant).toHaveLength(0)
      expect(audio.src).toBe('')
    })

    it('生成期间 toggle 被忽略，避免半加载状态误触播放', async () => {
      let release!: (v: { path: string }) => void
      api.prepareVariant = vi.fn(
        () =>
          new Promise<{ path: string }>((resolve) => {
            release = resolve
          })
      )
      await engine.play(makeTrack())
      const playCallsBefore = audio.playCalls

      const pending = engine.setRate(1.25)
      await Promise.resolve()
      expect(state.preparing).toBe(true)

      engine.toggle()
      expect(audio.playCalls).toBe(playCallsBefore)

      release({ path: '/cache/v.flac' })
      await pending
      expect(state.preparing).toBe(false)
    })
  })

  describe('时间轴换算', () => {
    it('播放变速产物时 UI 显示原速时间', async () => {
      await engine.play(makeTrack())
      await engine.setRate(1.25)

      audio.currentTime = 24
      audio.emit('timeupdate')
      expect(state.currentTime).toBe(30)

      engine.seek(30)
      expect(audio.currentTime).toBe(24)
      expect(state.currentTime).toBe(30)
    })

    it('播放原文件时倍速直接作用在 audio 上，时间不做换算', async () => {
      api.prepareVariant = vi.fn(async () => ({ error: 'no ffmpeg' }))
      await engine.play(makeTrack())
      await engine.setRate(1.25)

      audio.currentTime = 24
      audio.emit('timeupdate')
      expect(state.currentTime).toBe(24)

      engine.seek(30)
      expect(audio.currentTime).toBe(30)
    })

    it('seek 不支持负值', async () => {
      await engine.play(makeTrack())
      engine.seek(-5)
      expect(audio.currentTime).toBe(0)
      expect(state.currentTime).toBe(0)
    })

    it('displayTime 始终返回原速时间（歌词 rAF 采样用）', async () => {
      await engine.play(makeTrack())
      audio.currentTime = 12
      expect(engine.displayTime()).toBe(12)

      await engine.setRate(1.25)
      audio.currentTime = 12
      expect(engine.displayTime()).toBe(15)
    })
  })

  describe('时长同步', () => {
    it('有限时长同步到 UI 并上报，Infinity 被忽略', async () => {
      await engine.play(makeTrack())

      audio.duration = 100
      audio.emit('loadedmetadata')
      expect(state.duration).toBe(100)
      expect(api.calls.setTrackDuration).toEqual([['t1', 100]])

      audio.duration = Number.POSITIVE_INFINITY
      audio.emit('durationchange')
      expect(state.duration).toBe(100)
      expect(api.calls.setTrackDuration).toHaveLength(1)
    })

    it('变速产物按原速换算展示时长，差异小于 1 秒不重复上报', async () => {
      await engine.play(makeTrack())
      await engine.setRate(1.25)

      audio.duration = 80
      audio.emit('durationchange')
      expect(state.duration).toBe(100)
      expect(api.calls.setTrackDuration.at(-1)).toEqual(['t1', 100])

      audio.duration = 80.5
      audio.emit('durationchange')
      expect(api.calls.setTrackDuration).toHaveLength(1)
    })

    it('加载失败（error 事件）给出可读文案并纠正播放状态', async () => {
      await engine.play(makeTrack())

      audio.error = { code: 4, message: 'MEDIA_ELEMENT_ERROR' }
      audio.emit('error')

      expect(state.error).toBe('无法读取音频（code 4）：MEDIA_ELEMENT_ERROR')
      expect(state.playing).toBe(false)
    })
  })

  describe('循环与计数', () => {
    it('单曲循环：结束时计数 +1 并自动重播', async () => {
      await engine.play(makeTrack())
      audio.currentTime = 42
      const playCallsBefore = audio.playCalls

      audio.emit('ended')
      await vi.waitFor(() => expect(state.current?.playCount).toBe(1))

      expect(api.calls.incrementCount).toEqual([['t1', 1]])
      expect(syncPlayCount).toHaveBeenCalledWith('t1', 1)
      expect(audio.currentTime).toBe(0)
      expect(audio.playCalls).toBe(playCallsBefore + 1)
    })

    it('顺序播放：结束时只计数，不自动重播', async () => {
      engine.loopMode = 'none'
      await engine.play(makeTrack())
      const playCallsBefore = audio.playCalls

      audio.emit('ended')
      await vi.waitFor(() => expect(api.calls.incrementCount).toHaveLength(1))

      expect(audio.playCalls).toBe(playCallsBefore)
    })

    it('列表循环（all）当前不会自动切歌，作为回归护栏', async () => {
      engine.loopMode = 'all'
      await engine.play(makeTrack())
      const playCallsBefore = audio.playCalls

      audio.emit('ended')
      await vi.waitFor(() => expect(api.calls.incrementCount).toHaveLength(1))

      expect(audio.playCalls).toBe(playCallsBefore)
      expect(state.current?.id).toBe('t1')
    })

    it('结束前切换了曲目时，旧曲目的计数结果不写回当前曲目', async () => {
      await engine.play(makeTrack({ id: 't1' }))
      let resolveCount!: (n: number) => void
      api.incrementCount = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            resolveCount = resolve
          })
      )

      audio.emit('ended')
      await engine.play(makeTrack({ id: 't2', title: 'Second' }))

      resolveCount(9)
      await vi.waitFor(() => expect(syncPlayCount).toHaveBeenCalledWith('t1', 9))

      expect(state.current?.id).toBe('t2')
      expect(state.current?.playCount).toBe(0)
    })
  })

  describe('用时结算', () => {
    it('每 10 秒结算一次，暂停时补齐最后一段', async () => {
      vi.useFakeTimers()
      build({ intervalMs: 10000 })

      await engine.play(makeTrack())

      vi.advanceTimersByTime(10000)
      expect(api.calls.addUsage).toEqual([[10, 't1']])

      vi.advanceTimersByTime(10000)
      expect(api.calls.addUsage).toEqual([
        [10, 't1'],
        [10, 't1']
      ])

      vi.advanceTimersByTime(5000)
      engine.pause()
      expect(api.calls.addUsage.at(-1)).toEqual([5, 't1'])
      expect(state.playing).toBe(false)

      // 暂停后不再累计
      vi.advanceTimersByTime(30000)
      expect(api.calls.addUsage).toHaveLength(3)
    })

    it('结束播放时结算最后一段且不重复计时', async () => {
      vi.useFakeTimers()
      build({ intervalMs: 10000 })
      await engine.play(makeTrack())

      vi.advanceTimersByTime(12000)
      expect(api.calls.addUsage).toEqual([[10, 't1']])

      // fake timers 下 waitFor 不会推进时钟，这里直接断言同步结算结果
      audio.emit('ended')
      expect(api.calls.addUsage).toEqual([
        [10, 't1'],
        [2, 't1']
      ])
    })
  })

  // 删除正在播放的曲目时会调用 stop()，必须把播放条/歌词指向的状态一起清干净
  describe('删除曲目后停止', () => {
    it('清空当前曲目与播放状态，并结算最后一段用时', async () => {
      vi.useFakeTimers()
      build({ intervalMs: 10000 })
      await engine.play(makeTrack())

      vi.advanceTimersByTime(3000)
      engine.stop()

      expect(api.calls.addUsage).toEqual([[3, 't1']])
      expect(state.current).toBeNull()
      expect(state.playing).toBe(false)
      expect(state.currentTime).toBe(0)
      expect(state.duration).toBe(0)
      expect(state.error).toBe('')
      expect(audio.src).toBe('')
      expect(audio.playbackRate).toBe(1)

      // 计时已停止，不会继续累计
      vi.advanceTimersByTime(30000)
      expect(api.calls.addUsage).toHaveLength(1)
    })

    it('清空 src 触发的 error 事件不显示为播放失败', async () => {
      await engine.play(makeTrack())
      engine.stop()

      audio.error = { code: 4, message: 'MEDIA_ELEMENT_ERROR' }
      audio.emit('error')

      expect(state.error).toBe('')
    })
  })

  describe('可注入依赖', () => {
    it('支持自定义 URL 解析、计时器，且同步回调可缺省', async () => {
      const timers = {
        setInterval: vi.fn(() => 42),
        clearInterval: vi.fn()
      }
      audio = new FakeAudio()
      api = createFakeApi()
      state = createInitialPlayerState()
      engine = new PlayerEngine({
        audio,
        api,
        state,
        resolveUrl: (t) => `file://${t.path}`,
        timers,
        intervalMs: 5000
      })

      await engine.play(makeTrack())
      expect(audio.src).toBe('file:///music/a.mp3')
      expect(timers.setInterval).toHaveBeenCalled()

      // syncPlayCount 缺省时结束播放不应抛错
      audio.emit('ended')
      await vi.waitFor(() => expect(api.calls.incrementCount).toHaveLength(1))
      expect(timers.clearInterval).toHaveBeenCalledWith(42)
    })
  })

  describe('转码进度', () => {
    it('只接受「正在生成且倍速匹配」的进度', async () => {
      await engine.play(makeTrack())

      api.pushProgress({ trackPath: '/music/a.mp3', rate: 1.25, ratio: 0.5 })
      expect(state.progress).toBe(0)

      let release!: (v: { path: string }) => void
      api.prepareVariant = vi.fn(
        () =>
          new Promise<{ path: string }>((resolve) => {
            release = resolve
          })
      )
      const pending = engine.setRate(1.25)
      await Promise.resolve()

      api.pushProgress({ trackPath: '/music/a.mp3', rate: 1.1, ratio: 0.9 })
      expect(state.progress).toBe(0)

      api.pushProgress({ trackPath: '/music/a.mp3', rate: 1.25, ratio: 0.4 })
      expect(state.progress).toBe(0.4)

      api.pushProgress({ trackPath: '/music/a.mp3', rate: 1.25, ratio: Number.NaN })
      expect(state.progress).toBe(0.4)

      release({ path: '/cache/v.flac' })
      await pending
      expect(state.progress).toBe(0)
    })
  })
})
