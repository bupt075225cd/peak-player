import { describe, expect, it } from 'vitest'
import type { Track } from '../shared/types'
import { createSource, LocalSource, RemoteSource } from './source'

describe('LocalSource', () => {
  it('resolvePlayableUrl 返回 media 协议 URL', async () => {
    const s = new LocalSource('/home/u/a.mp3')
    await expect(s.resolvePlayableUrl()).resolves.toBe(
      'media://play?path=' + encodeURIComponent('/home/u/a.mp3')
    )
  })

  it('sourceType 为 local', () => {
    expect(new LocalSource('/a.mp3').sourceType).toBe('local')
  })
})

describe('RemoteSource', () => {
  it('未实现时 resolvePlayableUrl 抛错', async () => {
    const s = new RemoteSource('key.mp3')
    await expect(s.resolvePlayableUrl()).rejects.toThrow('not implemented')
  })

  it('sourceType 为 remote', () => {
    expect(new RemoteSource('key').sourceType).toBe('remote')
  })
})

describe('createSource', () => {
  it('local track 返回 LocalSource', () => {
    const t: Track = {
      id: '1',
      title: 'a',
      path: '/a.mp3',
      sourceType: 'local',
      playCount: 0,
      totalSeconds: 0,
      duration: 0,
      albumId: null
    }
    expect(createSource(t)).toBeInstanceOf(LocalSource)
  })

  it('remote track 返回 RemoteSource', () => {
    const t: Track = {
      id: '1',
      title: 'a',
      path: 'key',
      sourceType: 'remote',
      playCount: 0,
      totalSeconds: 0,
      duration: 0,
      albumId: null
    }
    expect(createSource(t)).toBeInstanceOf(RemoteSource)
  })
})
