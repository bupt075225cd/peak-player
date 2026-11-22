import { reactive } from 'vue'
import type { LoopMode } from '../../../shared/types'
import { useLibraryStore } from '../stores/library'
import { neighborTrack } from '../utils/queue'
import { RATE_MAX, RATE_MIN } from './playback'
import {
  createInitialPlayerState,
  PlayerEngine,
  type AudioLike,
  type PlayerState
} from './player-engine'

export type { LoopMode }
export { RATE_MAX, RATE_MIN, PlayerEngine, createInitialPlayerState }
export type { PlayerState }

// 单例：播放状态（组件直接读它）、音频元素、preload 暴露的 IPC api
export const playerState = reactive<PlayerState>(createInitialPlayerState())

export const player = new PlayerEngine({
  audio: new Audio() as unknown as AudioLike,
  api: window.api,
  state: playerState,
  syncPlayCount: (id, count) => useLibraryStore().syncPlayCount(id, count),
  // 播完一首自动续播：顺序模式到末尾停下，列表循环才回绕
  playNext: () => autoNext()
})

// 队列跟随播放列表的当前筛选结果：在专辑 / 未分类范围内切歌，不会串到别的分组。
// 队列顺序由 library store 决定，引擎只负责加载与播放。
function playNeighbor(dir: 1 | -1, opts: { wrap?: boolean } = {}): Promise<void> {
  const { visibleTracks } = useLibraryStore()
  const target = neighborTrack(visibleTracks, playerState.current?.id, dir, opts)
  return target === null ? Promise.resolve() : player.play(target)
}

// 手动点按钮：始终首尾相接
export const nextTrack = (): Promise<void> => playNeighbor(1)
export const prevTrack = (): Promise<void> => playNeighbor(-1)

// 自动续播：只有列表循环才回绕，顺序模式到末尾返回 null 即停
export function autoNext(): Promise<void> {
  return playNeighbor(1, { wrap: playerState.loopMode === 'all' })
}
