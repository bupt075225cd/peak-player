import { describe, expect, it } from 'vitest'
import type { Track } from '../../../shared/types'
import { neighborTrack } from './queue'

function track(id: string): Track {
  return {
    id,
    title: id,
    path: `/music/${id}.mp3`,
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 100
  }
}

const list = [track('a'), track('b'), track('c')]
const ids = (t: Track | null): string | null => t?.id ?? null

describe('neighborTrack', () => {
  it('空列表没有上/下一首', () => {
    expect(neighborTrack([], 'a', 1)).toBeNull()
    expect(neighborTrack([], undefined, -1)).toBeNull()
  })

  it('取列表中间位置的相邻曲目', () => {
    expect(ids(neighborTrack(list, 'b', 1))).toBe('c')
    expect(ids(neighborTrack(list, 'b', -1))).toBe('a')
  })

  // 首尾相接，避免用户点到最后还要回头点第一首
  it('首尾相接：最后一首往后回到第一首，第一首往前到最后一首', () => {
    expect(ids(neighborTrack(list, 'c', 1))).toBe('a')
    expect(ids(neighborTrack(list, 'a', -1))).toBe('c')
  })

  it('单曲列表返回自己', () => {
    expect(ids(neighborTrack([track('only')], 'only', 1))).toBe('only')
    expect(ids(neighborTrack([track('only')], 'only', -1))).toBe('only')
  })

  it('未在播放时下一首从头部、上一首从尾部开始', () => {
    expect(ids(neighborTrack(list, undefined, 1))).toBe('a')
    expect(ids(neighborTrack(list, undefined, -1))).toBe('c')
  })

  // 曲目被删除后 current 仍指向旧 id，此时不能返回 null，否则按钮会失效
  it('当前曲目不在列表里时按未播放处理', () => {
    expect(ids(neighborTrack(list, 'gone', 1))).toBe('a')
    expect(ids(neighborTrack(list, 'gone', -1))).toBe('c')
  })
})
