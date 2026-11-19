import { reactive } from 'vue'
import { resolveTrackUrl } from '../../../shared/track-url'
import type { LoopMode, Track } from '../../../shared/types'
import { useLibraryStore } from '../stores/library'
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

export type { LoopMode }
export { RATE_MAX, RATE_MIN }

export const playerState = reactive({
  current: null as Track | null,
  playing: false,
  rate: 1.0,
  loopMode: 'single' as LoopMode,
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
})

class PlayerEngine {
  private audio = new Audio()
  private startTime = 0
  private settleTimer: number | null = null
  // 当前 audio.src 对应的倍速，1 表示播放的是原文件
  private srcRate = 1
  // 倍速切换令牌：快速连续切换时丢弃过期结果
  private rateToken = 0
  // ffmpeg 不可用后不再重试，直接走内置伸缩
  private variantDisabled = false

  constructor() {
    // 不降调（仅在退回内置伸缩时生效，rubberband 由 ffmpeg 负责保持音高）
    this.audio.preservesPitch = true

    this.audio.addEventListener('ended', () => {
      this.stopTimer()
      this.onEnded()
    })
    this.audio.addEventListener('play', () => {
      playerState.playing = true
      this.beginTimer()
    })
    this.audio.addEventListener('pause', () => {
      playerState.playing = false
      this.stopTimer()
    })
    this.audio.addEventListener('timeupdate', () => {
      playerState.currentTime = toDisplayTime(this.audio.currentTime, this.srcRate)
    })
    // loadedmetadata 阶段 duration 可能是 Infinity（长度未确定），
    // 用 durationchange 兜底，并只接受有限值
    this.audio.addEventListener('loadedmetadata', () => this.syncDuration())
    this.audio.addEventListener('durationchange', () => this.syncDuration())
    // 资源加载失败（文件被移动/删除、协议取不到数据）不会抛到界面上，这里兜住
    this.audio.addEventListener('error', () => {
      const err = this.audio.error
      if (!err) return
      playerState.error = formatMediaError(err.code, err.message)
      // play() 会先触发 play 事件再报错，这里纠正状态，避免显示「暂停」却没声音
      this.stopTimer()
      playerState.playing = false
      console.warn('[player] 音频加载失败：', err.code, err.message)
    })

    window.api.onVariantProgress((p) => {
      if (acceptsProgress(p, playerState)) playerState.progress = p.ratio
    })
  }

  get loopMode(): LoopMode {
    return playerState.loopMode
  }
  set loopMode(m: LoopMode) {
    playerState.loopMode = m
  }

  get rate(): number {
    return playerState.rate
  }

  // 切换倍速：0.8~1.5 走 ffmpeg 预渲染（变速不变调、音质更好），失败则退回内置伸缩
  async setRate(r: number): Promise<void> {
    const v = clampRate(r)
    if (v === playerState.rate) return

    const token = ++this.rateToken
    const wasPlaying = playerState.playing
    const srcTime = playerState.currentTime
    const track = playerState.current

    playerState.rate = v
    if (!track) return

    this.audio.pause()
    await this.load(track, srcTime)
    if (token !== this.rateToken) return
    if (wasPlaying) await this.safePlay()
  }

  async play(track?: Track): Promise<void> {
    if (track && playerState.current?.id !== track.id) {
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
      playerState.error = ''
    } catch (err) {
      playerState.error = `播放失败：${err instanceof Error ? err.message : String(err)}`
      playerState.playing = false
      console.warn('[player] 播放失败：', err)
    }
  }

  toggle(): void {
    if (playerState.preparing) return
    if (this.audio.paused) void this.play()
    else this.audio.pause()
  }

  pause(): void {
    this.audio.pause()
  }

  // seconds 为原速时间轴上的位置
  seek(seconds: number): void {
    if (!this.audio.src) return
    const target = Math.max(0, seconds)
    this.audio.currentTime = toSourceTime(target, this.srcRate)
    playerState.currentTime = target
  }

  async load(track: Track, srcTime = 0): Promise<void> {
    playerState.current = track
    playerState.currentTime = srcTime
    playerState.duration = 0

    const url = await this.resolveUrl(track)
    if (!url) return

    this.audio.src = url
    this.audio.load()
    // load() 会把 playbackRate 重置为 defaultPlaybackRate(1)，
    // 退回内置伸缩时必须重新设置，否则降速完全不生效
    this.audio.playbackRate = resolvePlaybackRate(this.srcRate, playerState.rate)
    if (srcTime > 0) this.audio.currentTime = toSourceTime(srcTime, this.srcRate)
  }

  private async resolveUrl(track: Track): Promise<string | null> {
    const rate = playerState.rate

    // 1x、远程源、ffmpeg 已判定不可用：直接播放原文件
    if (!needsVariant({ rate, sourceType: track.sourceType, variantDisabled: this.variantDisabled })) {
      this.srcRate = 1
      this.audio.playbackRate = rate
      playerState.fallback = rate !== 1
      return resolveTrackUrl(track)
    }

    playerState.preparing = true
    playerState.progress = 0
    try {
      const res = await window.api.prepareVariant(track.path, rate)
      if ('path' in res) {
        this.srcRate = rate
        this.audio.playbackRate = 1
        playerState.fallback = false
        return 'media://play?path=' + encodeURIComponent(res.path)
      }
      this.variantDisabled = true
      console.warn('[player] 变速生成失败，退回内置伸缩：', res.error)
    } catch (err) {
      this.variantDisabled = true
      console.warn('[player] 变速生成异常，退回内置伸缩：', err)
    } finally {
      playerState.preparing = false
      playerState.progress = 0
    }

    // 降级：交给 Chromium 做时间伸缩（有金属感，但至少能播）
    this.srcRate = 1
    this.audio.playbackRate = rate
    playerState.fallback = true
    return resolveTrackUrl(track)
  }

  // 同步时长到 UI，并采集曲目真实时长（改次数时按它换算用时统计）
  private syncDuration(): void {
    const duration = toDisplayDuration(this.audio.duration, this.srcRate)
    // 加载中或长度未知时 Chromium 会给 Infinity/NaN，换算后为 0，这里直接跳过
    if (duration <= 0) return
    playerState.duration = duration

    const cur = playerState.current
    if (cur && needsDurationReport(cur.duration, duration)) {
      cur.duration = duration
      void window.api.setTrackDuration(cur.id, duration)
    }
  }

  // 完成一次播放：计数 +1；单曲循环则重播（不用 audio.loop，否则不触发 ended）
  private onEnded(): void {
    const cur = playerState.current
    if (cur) {
      const id = cur.id
      // 以主进程返回的最新次数为准，同时同步音乐库列表，避免界面停留在旧值
      void window.api.incrementCount(id, 1).then((count) => {
        if (playerState.current?.id === id) playerState.current.playCount = count
        useLibraryStore().syncPlayCount(id, count)
      })
    }
    if (endedAction(this.loopMode) === 'replay') {
      this.audio.currentTime = 0
      void this.safePlay()
    }
    // 'all' 模式由外部队列处理切歌；'none' 模式自然停止
  }

  private beginTimer(): void {
    this.startTime = Date.now()
    this.settleTimer = window.setInterval(() => this.settleTime(), 10000)
  }

  private settleTime(): void {
    if (this.startTime === 0) return
    const sec = elapsedSeconds(this.startTime, Date.now())
    if (sec > 0 && playerState.current) {
      window.api.addUsage(sec, playerState.current.id)
    }
    this.startTime = Date.now()
  }

  private stopTimer(): void {
    if (this.settleTimer !== null) {
      window.clearInterval(this.settleTimer)
      this.settleTimer = null
    }
    this.settleTime()
    this.startTime = 0
  }
}

export const player = new PlayerEngine()
