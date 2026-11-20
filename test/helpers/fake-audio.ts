import type { AudioLike } from '../../src/renderer/src/core/player-engine'

// 最小 Audio 替身：手动 emit 事件，用来驱动 player-engine 的状态机。
// 真实 Audio 在 node 环境不存在，也不该在集成测试里依赖声卡。
export class FakeAudio implements AudioLike {
  src = ''
  paused = true
  currentTime = 0
  duration = Number.NaN
  playbackRate = 1
  preservesPitch = false
  error: { code: number; message: string } | null = null

  playCalls = 0
  pauseCalls = 0
  loadCalls = 0
  // 让 play() 按用例需要失败（模拟自动播放被拦截/解码失败）
  playError: Error | null = null

  private listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }

  async play(): Promise<void> {
    this.playCalls++
    if (this.playError) throw this.playError
    this.paused = false
    this.emit('play')
  }

  pause(): void {
    this.pauseCalls++
    if (this.paused) return
    this.paused = true
    this.emit('pause')
  }

  load(): void {
    this.loadCalls++
    // Chromium 的 load() 会把 playbackRate 重置为 defaultPlaybackRate(1)
    this.playbackRate = 1
  }
}
