import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLyricFollow, type FollowTarget } from './useLyricFollow'

function createTarget(overrides: Partial<FollowTarget> = {}) {
  const scrollTo = vi.fn()
  const target: FollowTarget = {
    viewport: { clientHeight: 400, scrollTo },
    activeLine: { offsetTop: 300, offsetHeight: 40 },
    ...overrides
  }
  return { target, scrollTo }
}

describe('useLyricFollow', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('把当前行滚到视口正中', () => {
    const { target, scrollTo } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target })

    expect(follow.follow()).toBe(true)
    // 300 + 40/2 - 400/2 = 120
    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'smooth' })
  })

  it('没有视口或当前行时不滚动', () => {
    const noViewport = createTarget({ viewport: null })
    const noLine = createTarget({ activeLine: null })

    expect(useLyricFollow({ getTarget: () => noViewport.target }).follow()).toBe(false)
    expect(noViewport.scrollTo).not.toHaveBeenCalled()

    expect(useLyricFollow({ getTarget: () => noLine.target }).follow()).toBe(false)
    expect(noLine.scrollTo).not.toHaveBeenCalled()
  })

  it('用户手动浏览期间不跟随', () => {
    vi.useFakeTimers()
    const { target, scrollTo } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target, suspendMs: 4000 })

    follow.pause()
    expect(follow.userScrolling.value).toBe(true)
    expect(follow.follow()).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3999)
    expect(follow.userScrolling.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(follow.userScrolling.value).toBe(false)
    expect(follow.follow()).toBe(true)
  })

  it('多次 pause 以最后一次为准，不会提前恢复', () => {
    vi.useFakeTimers()
    const { target } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target, suspendMs: 4000 })

    follow.pause()
    vi.advanceTimersByTime(3000)
    follow.pause()

    vi.advanceTimersByTime(3000)
    expect(follow.userScrolling.value).toBe(true)

    vi.advanceTimersByTime(1000)
    expect(follow.userScrolling.value).toBe(false)
  })

  it('resume 立即恢复跟随并滚回当前行', () => {
    vi.useFakeTimers()
    const { target, scrollTo } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target, suspendMs: 4000 })

    follow.pause()
    follow.resume()

    expect(follow.userScrolling.value).toBe(false)
    expect(scrollTo).toHaveBeenCalledTimes(1)

    // 之前的挂起计时器已清除，不会被再次翻转
    vi.advanceTimersByTime(4000)
    expect(follow.userScrolling.value).toBe(false)
  })

  it('dispose 清理挂起计时器', () => {
    vi.useFakeTimers()
    const { target } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target, suspendMs: 4000 })

    follow.pause()
    follow.dispose()
    vi.advanceTimersByTime(4000)

    // 计时器已清除，状态不会再被改
    expect(follow.userScrolling.value).toBe(true)
  })

  it('尊重系统「减少动态效果」设置', () => {
    const { target, scrollTo } = createTarget()
    const follow = useLyricFollow({
      getTarget: () => target,
      prefersReducedMotion: () => true
    })

    follow.follow()

    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'auto' })
  })

  it('可注入计时器，重复 pause 会先清掉上一轮挂起', () => {
    const timers = {
      setTimeout: vi.fn(() => 42),
      clearTimeout: vi.fn()
    }
    const { target } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target, timers })

    follow.pause()
    expect(timers.setTimeout).toHaveBeenCalledTimes(1)

    follow.pause()
    expect(timers.clearTimeout).toHaveBeenCalledWith(42)
    expect(timers.setTimeout).toHaveBeenCalledTimes(2)

    follow.dispose()
    expect(timers.clearTimeout).toHaveBeenCalledTimes(2)
  })

  it('未注入计时器时使用全局定时器', () => {
    vi.useFakeTimers()
    const { target } = createTarget()
    const follow = useLyricFollow({ getTarget: () => target })

    follow.pause()
    vi.advanceTimersByTime(4000)

    expect(follow.userScrolling.value).toBe(false)
  })
})
