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
  syncPlayCount: (id, count) => useLibraryStore().syncPlayCount(id, count)
})

// 上/下一首：按播放列表顺序切换，首尾相接；未在播放时从头/尾开始。
// 队列顺序由 library store 决定，引擎只负责加载与播放。
function playNeighbor(dir: 1 | -1): Promise<void> {
  const target = neighborTrack(useLibraryStore().tracks, playerState.current?.id, dir)
  return target === null ? Promise.resolve() : player.play(target)
}

export const nextTrack = (): Promise<void> => playNeighbor(1)
export const prevTrack = (): Promise<void> => playNeighbor(-1)
