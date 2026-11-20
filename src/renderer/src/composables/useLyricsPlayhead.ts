// 歌词播放头：用 rAF 高频采样引擎时间。
// timeupdate 只有约 4Hz，直接拿它做行内扫光会一跳一跳。
// 刻意不碰 DOM 与组件生命周期，rAF 可注入，便于单测。
import { ref, type Ref } from 'vue'

export interface PlaybackSnapshot {
  playing: boolean
  // 变速预渲染期间 audio 正在换源，此时时间不可信
  preparing: boolean
  currentTime: number
}

export interface FrameScheduler {
  request: (cb: () => void) => number
  cancel: (handle: number) => void
}

export interface LyricsPlayheadDeps {
  // 引擎的精确时间（变速播放时已换算回原速时间轴）
  getDisplayTime: () => number
  getSnapshot: () => PlaybackSnapshot
  // 默认用全局 requestAnimationFrame；单测注入可控调度器
  raf?: FrameScheduler
}

export interface LyricsPlayhead {
  time: Ref<number>
  // 采样一次（挂载时先同步一次，避免歌词停在 0）
  sample: () => void
  start: () => void
  stop: () => void
}

const defaultRaf: FrameScheduler = {
  request: (cb) => globalThis.requestAnimationFrame(cb),
  cancel: (handle) => globalThis.cancelAnimationFrame(handle)
}

export function useLyricsPlayhead(deps: LyricsPlayheadDeps): LyricsPlayhead {
  const raf = deps.raf ?? defaultRaf
  // 直接以当前播放时间起步：组件首帧不会先显示「前奏」再跳到当前行
  const time = ref(deps.getSnapshot().currentTime)
  let handle: number | null = null

  function sample(): void {
    const snapshot = deps.getSnapshot()
    // 换源期间跳过：否则会读到旧文件的 currentTime，歌词瞬间跳回前面
    if (snapshot.preparing) return
    // 播放中用引擎精确时间，暂停时跟随状态（拖动进度条后歌词要立即跟上）
    time.value = snapshot.playing ? deps.getDisplayTime() : snapshot.currentTime
  }

  function frame(): void {
    sample()
    handle = raf.request(frame)
  }

  function start(): void {
    if (handle !== null) return
    sample()
    handle = raf.request(frame)
  }

  function stop(): void {
    if (handle === null) return
    raf.cancel(handle)
    handle = null
  }

  return { time, sample, start, stop }
}
