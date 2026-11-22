// 播放引擎：与 Audio 元素、IPC api、Vue 响应式状态解耦的工厂实现。
// 生产环境在 player.ts 里用真实 Audio + window.api 组装单例；
// 集成测试注入假 Audio 与记录型 api，就能验证完整状态机（倍速/降级/循环/计时）。
import type { LoopMode, Track } from '../../../shared/types'
import {
  acceptsProgress,
  clampRate,
  endedAction,
  elapsedSeconds,
  formatMediaError,
  needsVariant,
  RATE_MAX,
  RATE_MIN
} from './playback'
import {
  needsDurationReport,
  resolvePlaybackRate,
  toDisplayDuration,
  toDisplayTime,
  toSourceTime
} from './time-mapping'

export interface PlayerState {
  current: Track | null
  playing: boolean
  rate: number
  loopMode: LoopMode
  currentTime: number
  duration: number
  preparing: boolean
  progress: number
  fallback: boolean
  error: string
}

export function createInitialPlayerState(): PlayerState {
  return {
    current: null,
    playing: false,
    rate: 1.0,
    loopMode: 'single',
    // 展示用时间轴：始终是「原速」时间，变速播放时由内部换算
    currentTime: 0,
    duration: 0,
    // 正在用 ffmpeg 生成变速文件
    preparing: false,
    progress: 0,
    // true 表示本次变速退回了 Chromium 内置伸缩
    fallback: false,
    // 播放失败原因（文件缺失/解码失败/被策略拦截），正常播放时为空
    error: ''
  }
}

// 只声明引擎用到的成员，便于测试注入假实现
export interface AudioLike {
  src: string
  paused: boolean
  currentTime: number
  readonly duration: number
  playbackRate: number
  preservesPitch: boolean
  error: { code: number; message: string } | null
  play(): Promise<void>
  pause(): void
  load(): void
  addEventListener(type: string, listener: () => void): void
}

export interface VariantLike {
  path?: string
  error?: string
}

// 引擎依赖的 IPC 子集
export interface PlayerApi {
  prepareVariant(trackPath: string, rate: number): Promise<VariantLike>
  setTrackDuration(id: string, seconds: number): Promise<void> | void
  incrementCount(id: string, delta: number): Promise<number>
  addUsage(seconds: number, trackId: string | null): Promise<void> | void
  onVariantProgress(cb: (p: { trackPath: string; rate: number; ratio: number }) => void): () => void
}

export interface PlayerTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

export interface PlayerDeps {
  audio: AudioLike
  api: PlayerApi
  state: PlayerState
  // 播放结束后同步列表里的次数，避免整表重查
  syncPlayCount?: (id: string, count: number) => void
  // 顺序/列表循环下自动切下一首；缺省时结束就停住
  playNext?: () => void | Promise<void>
  resolveUrl?: (track: Track) => string
  timers?: PlayerTimers
  intervalMs?: number
}

const defaultTimers: PlayerTimers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
}

const defaultResolveUrl = (track: Track): string =>
  track.sourceType === 'remote'
    ? track.path
    : 'media://play?path=' + encodeURIComponent(track.path)

export class PlayerEngine {
  private readonly audio: AudioLike
  private readonly api: PlayerApi
  private readonly timers: PlayerTimers
  private readonly intervalMs: number
  private readonly resolveTrackUrl: (track: Track) => string

  private startTime = 0
  private settleTimer: unknown = null
  // 当前 audio.src 对应的倍速，1 表示播放的是原文件
  private srcRate = 1
  // 倍速切换令牌：快速连续切换时丢弃过期结果
  private rateToken = 0
  // ffmpeg 不可用后不再重试，直接走内置伸缩
  private variantDisabled = false

  constructor(private readonly deps: PlayerDeps) {
    this.audio = deps.audio
    this.api = deps.api
    this.timers = deps.timers ?? defaultTimers
    this.intervalMs = deps.intervalMs ?? 10000
    this.resolveTrackUrl = deps.resolveUrl ?? defaultResolveUrl

    // 不降调（仅在退回内置伸缩时生效，rubberband 由 ffmpeg 负责保持音高）
    this.audio.preservesPitch = true

    this.audio.addEventListener('ended', () => {
      this.stopTimer()
      this.onEnded()
    })
    this.audio.addEventListener('play', () => {
      this.state.playing = true
      this.beginTimer()
    })
    this.audio.addEventListener('pause', () => {
      this.state.playing = false
      this.stopTimer()
    })
    this.audio.addEventListener('timeupdate', () => {
      this.state.currentTime = toDisplayTime(this.audio.currentTime, this.srcRate)
    })
    // loadedmetadata 阶段 duration 可能是 Infinity（长度未确定），
    // 用 durationchange 兜底，并只接受有限值
    this.audio.addEventListener('loadedmetadata', () => this.syncDuration())
    this.audio.addEventListener('durationchange', () => this.syncDuration())
    // 资源加载失败（文件被移动/删除、协议取不到数据）不会抛到界面上，这里兜住
    this.audio.addEventListener('error', () => {
      const err = this.audio.error
      // stop() 会清空当前曲目，此时 src 置空可能触发一次 error，不应显示成播放失败
      if (!err || !this.state.current) return
      this.state.error = formatMediaError(err.code, err.message)
      // play() 会先触发 play 事件再报错，这里纠正状态，避免显示「暂停」却没声音
      this.stopTimer()
      this.state.playing = false
      console.warn('[player] 音频加载失败：', err.code, err.message)
    })

    this.api.onVariantProgress((p) => {
      if (acceptsProgress(p, this.state)) this.state.progress = p.ratio
    })
  }

  get state(): PlayerState {
    return this.deps.state
  }

  get loopMode(): LoopMode {
    return this.state.loopMode
  }
  set loopMode(m: LoopMode) {
    this.state.loopMode = m
  }

  get rate(): number {
    return this.state.rate
  }

  // 切换倍速：0.8~1.5 走 ffmpeg 预渲染（变速不变调、音质更好），失败则退回内置伸缩
  async setRate(r: number): Promise<void> {
    const v = clampRate(r)
    if (v === this.state.rate) return

    const token = ++this.rateToken
    const wasPlaying = this.state.playing
    const srcTime = this.state.currentTime
    const track = this.state.current

    this.state.rate = v
    if (!track) return

    this.audio.pause()
    await this.load(track, srcTime)
    if (token !== this.rateToken) return
    if (wasPlaying) await this.safePlay()
  }

  async play(track?: Track): Promise<void> {
    if (track && this.state.current?.id !== track.id) {
      await this.load(track)
    } else if (!this.audio.src) {
      return
    }
    await this.safePlay()
  }

  // play() 失败（文件丢失、解码不支持、自动播放被拦截）默认只会产生一条
  // 静默的 Promise rejection，界面上表现为「点了没反应」，这里显式暴露出来
  private async safePlay(): Promise<void> {
    try {
      await this.audio.play()
      this.state.error = ''
    } catch (err) {
      this.state.error = `播放失败：${err instanceof Error ? err.message : String(err)}`
      this.state.playing = false
      console.warn('[player] 播放失败：', err)
    }
  }

  toggle(): void {
    if (this.state.preparing) return
    if (this.audio.paused) void this.play()
    else this.audio.pause()
  }

  pause(): void {
    this.audio.pause()
  }

  // 从库中删除正在播放的曲目时调用：清空当前曲目并停止播放。
  // 否则播放条、歌词面板会继续指向一条已经不存在的记录。
  stop(): void {
    this.audio.pause()
    this.stopTimer()
    // 丢弃仍在进行的变速请求，避免其结果回来后重新写入状态
    this.rateToken++
    this.srcRate = 1
    this.state.current = null
    this.state.playing = false
    this.state.currentTime = 0
    this.state.duration = 0
    this.state.preparing = false
    this.state.progress = 0
    this.state.fallback = false
    this.state.error = ''
    this.audio.src = ''
    this.audio.playbackRate = 1
  }

  // seconds 为原速时间轴上的位置
  seek(seconds: number): void {
    if (!this.audio.src) return
    const target = Math.max(0, seconds)
    this.audio.currentTime = toSourceTime(target, this.srcRate)
    this.state.currentTime = target
  }

  // 歌词面板用 rAF 采样精确进度：timeupdate 只有约 4Hz，
  // 直接拿 state.currentTime 做行内扫光会一跳一跳
  displayTime(): number {
    return toDisplayTime(this.audio.currentTime, this.srcRate)
  }

  async load(track: Track, srcTime = 0): Promise<void> {
    this.state.current = track
    this.state.currentTime = srcTime
    this.state.duration = 0

    const url = await this.resolveUrl(track)
    if (!url) return

    this.audio.src = url
    this.audio.load()
    // load() 会把 playbackRate 重置为 defaultPlaybackRate(1)，
    // 退回内置伸缩时必须重新设置，否则降速完全不生效
    this.audio.playbackRate = resolvePlaybackRate(this.srcRate, this.state.rate)
    if (srcTime > 0) this.audio.currentTime = toSourceTime(srcTime, this.srcRate)
  }

  private async resolveUrl(track: Track): Promise<string | null> {
    const rate = this.state.rate

    // 1x、远程源、ffmpeg 已判定不可用：直接播放原文件
    if (!needsVariant({ rate, sourceType: track.sourceType, variantDisabled: this.variantDisabled })) {
      this.srcRate = 1
      this.audio.playbackRate = rate
      this.state.fallback = rate !== 1
      return this.resolveTrackUrl(track)
    }

    this.state.preparing = true
    this.state.progress = 0
    try {
      const res = await this.api.prepareVariant(track.path, rate)
      if (res.path) {
        this.srcRate = rate
        this.audio.playbackRate = 1
        this.state.fallback = false
        return 'media://play?path=' + encodeURIComponent(res.path)
      }
      this.variantDisabled = true
      console.warn('[player] 变速生成失败，退回内置伸缩：', res.error)
    } catch (err) {
      this.variantDisabled = true
      console.warn('[player] 变速生成异常，退回内置伸缩：', err)
    } finally {
      this.state.preparing = false
      this.state.progress = 0
    }

    // 降级：交给 Chromium 做时间伸缩（有金属感，但至少能播）
    this.srcRate = 1
    this.audio.playbackRate = rate
    this.state.fallback = true
    return this.resolveTrackUrl(track)
  }

  // 同步时长到 UI，并采集曲目真实时长（改次数时按它换算用时统计）
  private syncDuration(): void {
    const duration = toDisplayDuration(this.audio.duration, this.srcRate)
    // 加载中或长度未知时 Chromium 会给 Infinity/NaN，换算后为 0，这里直接跳过
    if (duration <= 0) return
    this.state.duration = duration

    const cur = this.state.current
    if (cur && needsDurationReport(cur.duration, duration)) {
      cur.duration = duration
      void this.api.setTrackDuration(cur.id, duration)
    }
  }

  // 完成一次播放：计数 +1；单曲循环则重播（不用 audio.loop，否则不触发 ended）
  private onEnded(): void {
    const cur = this.state.current
    if (cur) {
      const id = cur.id
      // 以主进程返回的最新次数为准，同时同步播放列表，避免界面停留在旧值
      void this.api.incrementCount(id, 1).then((count) => {
        if (this.state.current?.id === id) this.state.current.playCount = count
        this.deps.syncPlayCount?.(id, count)
      })
    }
    if (endedAction(this.loopMode) === 'replay') {
      this.audio.currentTime = 0
      void this.safePlay()
      return
    }
    // 顺序 / 列表循环交给外部队列：顺序模式在列表末尾停下，列表循环回绕
    void this.deps.playNext?.()
  }

  private beginTimer(): void {
    this.startTime = Date.now()
    this.settleTimer = this.timers.setInterval(() => this.settleTime(), this.intervalMs)
  }

  private settleTime(): void {
    if (this.startTime === 0) return
    const sec = elapsedSeconds(this.startTime, Date.now())
    if (sec > 0 && this.state.current) {
      void this.api.addUsage(sec, this.state.current.id)
    }
    this.startTime = Date.now()
  }

  private stopTimer(): void {
    if (this.settleTimer !== null) {
      this.timers.clearInterval(this.settleTimer)
      this.settleTimer = null
    }
    this.settleTime()
    this.startTime = 0
  }
}

export { RATE_MAX, RATE_MIN }
export type { LoopMode }
