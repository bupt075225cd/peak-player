// @vitest-environment happy-dom
// 队列接线测试：真实 PlayerEngine + happy-dom 的 Audio 元素，
// 只验证「上/下一首取哪一首」，解码与设备输出不在这里覆盖。
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../../shared/types'
import { useLibraryStore } from '../stores/library'
import { autoNext, nextTrack, playerState, prevTrack } from './player'

// player 单例在模块求值时就读取 window.api，必须先装好桩再加载它
vi.hoisted(() => {
  ;(globalThis as unknown as { api: unknown }).api = {
    onVariantProgress: () => () => {},
    prepareVariant: async () => ({ error: 'no ffmpeg' }),
    setTrackDuration: () => {},
    incrementCount: async () => 1,
    addUsage: () => {}
  }
})

function track(id: string, albumId: string | null = null): Track {
  return {
    id,
    title: id,
    path: `/music/${id}.mp3`,
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 100,
    albumId
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  playerState.current = null
  playerState.loopMode = 'single'
})

describe('播放队列', () => {
  it('下一首 / 上一首按列表顺序切换', async () => {
    const library = useLibraryStore()
    library.tracks = [track('1'), track('2'), track('3')]
    playerState.current = library.tracks[0]

    await nextTrack()
    expect(playerState.current?.id).toBe('2')

    await prevTrack()
    expect(playerState.current?.id).toBe('1')
  })

  // 队列跟随筛选：筛到某张专辑后，切歌只在该专辑内走，不会串到别的专辑
  it('切歌只在当前筛选结果内进行', async () => {
    const library = useLibraryStore()
    library.tracks = [track('1', 'a1'), track('2', 'a2'), track('3', 'a1')]
    library.albumFilter = 'a1'
    playerState.current = library.tracks[0]

    await nextTrack()
    expect(playerState.current?.id).toBe('3')

    // 手动点按钮首尾相接，回到该专辑的第一首
    await nextTrack()
    expect(playerState.current?.id).toBe('1')
  })

  it('顺序模式在末尾停下，列表循环才回绕', async () => {
    const library = useLibraryStore()
    library.tracks = [track('1'), track('2')]
    playerState.current = library.tracks[1]

    playerState.loopMode = 'none'
    await autoNext()
    expect(playerState.current?.id).toBe('2')

    playerState.loopMode = 'all'
    await autoNext()
    expect(playerState.current?.id).toBe('1')
  })

  it('空列表时切歌不报错也不改状态', async () => {
    await nextTrack()
    await prevTrack()
    await autoNext()

    expect(playerState.current).toBeNull()
  })
})
