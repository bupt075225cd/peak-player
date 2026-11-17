import { reactive } from 'vue'
import { resolveTrackUrl } from '../../../shared/track-url'
import type { LoopMode, Track } from '../../../shared/types'
import { useLibraryStore } from '../stores/library'

export type { LoopMode }

export const RATE_MIN = 0.8
export const RATE_MAX = 1.5

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
  // true 表示本次变速退回了 Chromium 内置伸缩（音质会差一些）
  fallback: false
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
      playerState.currentTime = this.audio.currentTime * this.srcRate
    })
    this.audio.addEventListener('loadedmetadata', () => {
      playerState.duration = (this.audio.duration || 0) * this.srcRate
    })

    window.api.onVariantProgress((p) => {
      if (playerState.preparing && p.rate === playerState.rate) playerState.progress = p.ratio
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
    const v = Math.min(RATE_MAX, Math.max(RATE_MIN, r))
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
    if (wasPlaying) await this.audio.play()
  }

  async play(track?: Track): Promise<void> {
    if (track && playerState.current?.id !== track.id) {
      await this.load(track)
    } else if (!this.audio.src) {
      return
    }
    await this.audio.play()
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
    this.audio.currentTime = target / this.srcRate
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
    if (srcTime > 0) this.audio.currentTime = srcTime / this.srcRate
  }

  private async resolveUrl(track: Track): Promise<string | null> {
    const rate = playerState.rate

    // 1x 或远程源：直接播放原文件
    if (rate === 1 || track.sourceType === 'remote' || this.variantDisabled) {
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
    if (this.loopMode === 'single') {
      this.audio.currentTime = 0
      void this.audio.play()
    }
    // 'all' 模式由外部队列处理切歌；'none' 模式自然停止
  }

  private beginTimer(): void {
    this.startTime = Date.now()
    this.settleTimer = window.setInterval(() => this.settleTime(), 10000)
  }

  private settleTime(): void {
    if (this.startTime === 0) return
    const sec = Math.floor((Date.now() - this.startTime) / 1000)
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
