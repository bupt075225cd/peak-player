// 歌词自动跟随：把「滚到当前行」与「用户手动浏览时暂停跟随」从组件里拆出来。
// 只依赖注入的目标元素与计时器，不直接读 DOM，便于单测。
import { ref, type Ref } from 'vue'
import { lyricScrollTop } from '../utils/lyrics'

export interface FollowViewport {
  clientHeight: number
  scrollTo: (options: { top: number; behavior: 'auto' | 'smooth' }) => void
}

export interface FollowLine {
  offsetTop: number
  offsetHeight: number
}

export interface FollowTarget {
  viewport: FollowViewport | null
  activeLine: FollowLine | null
}

export interface FollowTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface LyricFollowDeps {
  getTarget: () => FollowTarget
  prefersReducedMotion?: () => boolean
  // 用户停止滚动后多久恢复自动跟随
  suspendMs?: number
  timers?: FollowTimers
}

export interface LyricFollow {
  userScrolling: Ref<boolean>
  // 滚到当前行；被手动浏览挂起或没有目标行时返回 false
  follow: () => boolean
  // 用户开始滚轮/拖拽
  pause: () => void
  // 立即恢复跟随并滚回当前行
  resume: () => void
  dispose: () => void
}

const defaultTimers: FollowTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export function useLyricFollow(deps: LyricFollowDeps): LyricFollow {
  const timers = deps.timers ?? defaultTimers
  const suspendMs = deps.suspendMs ?? 4000
  const userScrolling = ref(false)
  let timer: unknown = null

  function clearTimer(): void {
    if (timer === null) return
    timers.clearTimeout(timer)
    timer = null
  }

  function follow(): boolean {
    if (userScrolling.value) return false

    const { viewport, activeLine } = deps.getTarget()
    if (!viewport || !activeLine) return false

    viewport.scrollTo({
      top: lyricScrollTop(activeLine.offsetTop, activeLine.offsetHeight, viewport.clientHeight),
      behavior: deps.prefersReducedMotion?.() ? 'auto' : 'smooth'
    })
    return true
  }

  function pause(): void {
    userScrolling.value = true
    clearTimer()
    timer = timers.setTimeout(() => {
      timer = null
      userScrolling.value = false
    }, suspendMs)
  }

  function resume(): void {
    clearTimer()
    userScrolling.value = false
    follow()
  }

  function dispose(): void {
    clearTimer()
  }

  return { userScrolling, follow, pause, resume, dispose }
}
