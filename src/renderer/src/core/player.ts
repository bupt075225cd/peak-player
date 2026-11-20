import { reactive } from 'vue'
import type { LoopMode } from '../../../shared/types'
import { useLibraryStore } from '../stores/library'
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
