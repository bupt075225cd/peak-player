import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useLyricsPlayhead,
  type FrameScheduler,
  type PlaybackSnapshot
} from './useLyricsPlayhead'

function createScheduler() {
  const queue: (() => void)[] = []
  const scheduler: FrameScheduler = {
    request: vi.fn((cb: () => void) => {
      queue.push(cb)
      return queue.length
    }),
    cancel: vi.fn()
  }
  return { queue, scheduler }
}

function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return { playing: true, preparing: false, currentTime: 0, ...overrides }
}

describe('useLyricsPlayhead', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('播放中用引擎精确时间，暂停时跟随状态时间', () => {
    let display = 5.5
    let state = snapshot({ currentTime: 3 })
    const playhead = useLyricsPlayhead({
      getDisplayTime: () => display,
      getSnapshot: () => state
    })

    // 初始值直接取当前播放时间，避免首帧落后
    expect(playhead.time.value).toBe(3)

    playhead.sample()
    expect(playhead.time.value).toBe(5.5)

    state = snapshot({ playing: false, currentTime: 12.4 })
    playhead.sample()
    expect(playhead.time.value).toBe(12.4)

    display = 20
    playhead.sample()
    expect(playhead.time.value).toBe(12.4)
  })

  it('变速预渲染期间跳过采样，避免歌词瞬间回跳', () => {
    let state = snapshot()
    const playhead = useLyricsPlayhead({
      getDisplayTime: () => 30,
      getSnapshot: () => state
    })

    playhead.sample()
    expect(playhead.time.value).toBe(30)

    state = snapshot({ preparing: true })
    playhead.sample()
    expect(playhead.time.value).toBe(30)
  })

  it('start 先同步一次，再按帧持续采样', () => {
    const { queue, scheduler } = createScheduler()
    let display = 1
    const playhead = useLyricsPlayhead({
      getDisplayTime: () => display,
      getSnapshot: () => snapshot(),
      raf: scheduler
    })

    playhead.start()
    expect(playhead.time.value).toBe(1)
    expect(queue).toHaveLength(1)

    display = 2
    queue[0]!()
    expect(playhead.time.value).toBe(2)
    // 每帧结束后继续排下一帧
    expect(queue).toHaveLength(2)
  })

  it('重复 start 不会叠加多路循环', () => {
    const { queue, scheduler } = createScheduler()
    const playhead = useLyricsPlayhead({
      getDisplayTime: () => 0,
      getSnapshot: () => snapshot(),
      raf: scheduler
    })

    playhead.start()
    playhead.start()

    expect(scheduler.request).toHaveBeenCalledTimes(1)
    expect(queue).toHaveLength(1)
  })

  it('stop 取消挂起的帧，重复 stop 与未启动时 stop 都安全', () => {
    const { scheduler } = createScheduler()
    const playhead = useLyricsPlayhead({
      getDisplayTime: () => 0,
      getSnapshot: () => snapshot(),
      raf: scheduler
    })

    playhead.stop()
    expect(scheduler.cancel).not.toHaveBeenCalled()

    playhead.start()
    playhead.stop()
    expect(scheduler.cancel).toHaveBeenCalledTimes(1)

    playhead.stop()
    expect(scheduler.cancel).toHaveBeenCalledTimes(1)
  })

  it('默认调度器使用全局 requestAnimationFrame', () => {
    const request = vi.fn(() => 7)
    const cancel = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    vi.stubGlobal('cancelAnimationFrame', cancel)

    const playhead = useLyricsPlayhead({
      getDisplayTime: () => 0,
      getSnapshot: () => snapshot()
    })
    playhead.start()
    playhead.stop()

    expect(request).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(7)
  })
})
