import { reactive } from 'vue'
import { resolveTrackUrl } from '../../../shared/track-url'
import type { LoopMode, Track } from '../../../shared/types'

export type { LoopMode }

export const playerState = reactive({
  current: null as Track | null,
  playing: false,
  rate: 1.0,
  loopMode: 'single' as LoopMode,
  currentTime: 0,
  duration: 0
})

class PlayerEngine {
  private audio = new Audio()
  private startTime = 0
  private settleTimer: number | null = null

  constructor() {
    // 变速不变调
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
      playerState.currentTime = this.audio.currentTime
    })
    this.audio.addEventListener('loadedmetadata', () => {
      playerState.duration = this.audio.duration || 0
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
  set rate(r: number) {
    // 限定 0.8 ~ 1.5
    const v = Math.min(1.5, Math.max(0.8, r))
    playerState.rate = v
    this.audio.playbackRate = v
  }

  load(track: Track): void {
    playerState.current = track
    playerState.currentTime = 0
    playerState.duration = 0
    this.audio.src = resolveTrackUrl(track)
    this.audio.load()
  }

  async play(track?: Track): Promise<void> {
    if (track && playerState.current?.id !== track.id) this.load(track)
    if (!this.audio.src) return
    await this.audio.play()
  }

  toggle(): void {
    if (this.audio.paused) void this.play()
    else this.audio.pause()
  }

  pause(): void {
    this.audio.pause()
  }

  seek(seconds: number): void {
    if (this.audio.src) this.audio.currentTime = seconds
  }

  // 完成一次播放：计数 +1；单曲循环则重播（不用 audio.loop，否则不触发 ended）
  private onEnded(): void {
    if (playerState.current) {
      const next = playerState.current.playCount + 1
      window.api.incrementCount(playerState.current.id, 1)
      playerState.current = { ...playerState.current, playCount: next }
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
