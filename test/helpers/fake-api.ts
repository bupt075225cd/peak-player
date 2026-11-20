import { vi } from 'vitest'
import type { PlayerApi, VariantLike } from '../../src/renderer/src/core/player-engine'

export interface FakeApi extends PlayerApi {
  calls: {
    prepareVariant: [string, number][]
    setTrackDuration: [string, number][]
    incrementCount: [string, number][]
    addUsage: [number, string | null][]
  }
  // 模拟主进程推送变速进度
  pushProgress(p: { trackPath: string; rate: number; ratio: number }): void
  progressListenerCount(): number
}

export function createFakeApi(overrides: Partial<PlayerApi> = {}): FakeApi {
  const calls: FakeApi['calls'] = {
    prepareVariant: [],
    setTrackDuration: [],
    incrementCount: [],
    addUsage: []
  }

  let listener: ((p: { trackPath: string; rate: number; ratio: number }) => void) | null = null
  let nextCount = 1

  const api: FakeApi = {
    calls,
    prepareVariant: vi.fn(async (trackPath: string, rate: number): Promise<VariantLike> => {
      calls.prepareVariant.push([trackPath, rate])
      return { path: `/cache/${rate}x.flac` }
    }),
    setTrackDuration: vi.fn((id: string, seconds: number) => {
      calls.setTrackDuration.push([id, seconds])
    }),
    incrementCount: vi.fn(async (id: string, delta: number) => {
      calls.incrementCount.push([id, delta])
      return nextCount++
    }),
    addUsage: vi.fn((seconds: number, trackId: string | null) => {
      calls.addUsage.push([seconds, trackId])
    }),
    onVariantProgress: (cb) => {
      listener = cb
      return () => {
        listener = null
      }
    },
    pushProgress: (p) => listener?.(p),
    progressListenerCount: () => (listener ? 1 : 0),
    ...overrides
  }
  return api
}

export function makeTrack(overrides: Partial<import('../../src/shared/types').Track> = {}) {
  return {
    id: 't1',
    title: 'Track 1',
    path: '/music/a.mp3',
    sourceType: 'local' as const,
    playCount: 0,
    totalSeconds: 0,
    duration: 0,
    ...overrides
  }
}
