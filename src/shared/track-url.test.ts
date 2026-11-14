import { describe, expect, it } from 'vitest'
import { resolveTrackUrl } from './track-url'
import type { Track } from './types'

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: '1',
    title: 'test',
    path: '/music/a.mp3',
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    ...overrides
  }
}

describe('resolveTrackUrl', () => {
  it('本地音源返回 media 协议 URL', () => {
    const track = makeTrack({ path: '/home/user/music/song.mp3' })
    expect(resolveTrackUrl(track)).toBe(
      'media://play?path=' + encodeURIComponent('/home/user/music/song.mp3')
    )
  })

  it('本地路径中的特殊字符会被编码', () => {
    const track = makeTrack({ path: '/music/我的 歌.mp3' })
    expect(resolveTrackUrl(track)).toContain('%20')
  })

  it('远程音源直接返回 path（扩展预留）', () => {
    const track = makeTrack({ sourceType: 'remote', path: 'cos://bucket/key.mp3' })
    expect(resolveTrackUrl(track)).toBe('cos://bucket/key.mp3')
  })
})
