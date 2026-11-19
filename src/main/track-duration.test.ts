import { describe, expect, it, vi } from 'vitest'
import type { Track } from '../shared/types'
import { ensureTrackDuration } from './track-duration'

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    title: 'song',
    path: '/music/song.mp3',
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 0,
    ...overrides
  }
}

function setup(track: Track | undefined, probeResult: number | Error = 200) {
  const getTrack = vi.fn(() => track)
  const save = vi.fn()
  const probe = vi.fn(async () => {
    if (probeResult instanceof Error) throw probeResult
    return probeResult
  })
  const deps = { getTrack, probeAudioDuration: probe, setTrackDuration: save }
  return { deps, getTrack, probe, save }
}

describe('ensureTrackDuration', () => {
  it('时长未知时探测并写库', async () => {
    const { deps, probe, save } = setup(makeTrack({ duration: 0 }), 200.4)
    await expect(ensureTrackDuration('t1', deps)).resolves.toBe(200.4)
    expect(probe).toHaveBeenCalledWith('/music/song.mp3')
    expect(save).toHaveBeenCalledWith('t1', 200.4)
  })

  it('已有时长时不重复探测', async () => {
    const { deps, probe, save } = setup(makeTrack({ duration: 180 }))
    await expect(ensureTrackDuration('t1', deps)).resolves.toBe(0)
    expect(probe).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('曲目不存在时不做任何事', async () => {
    const { deps, probe, save } = setup(undefined)
    await expect(ensureTrackDuration('missing', deps)).resolves.toBe(0)
    expect(probe).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('探测结果为 0 时不写库', async () => {
    const { deps, save } = setup(makeTrack(), 0)
    await expect(ensureTrackDuration('t1', deps)).resolves.toBe(0)
    expect(save).not.toHaveBeenCalled()
  })

  // 关键：探测失败不能连带「改次数」一起失败
  it('探测抛错时静默返回 0，不抛给调用方', async () => {
    const { deps, save } = setup(makeTrack(), new Error('ffmpeg 不可用'))
    await expect(ensureTrackDuration('t1', deps)).resolves.toBe(0)
    expect(save).not.toHaveBeenCalled()
  })

  it('探测返回 NaN/负值时忽略', async () => {
    const nan = setup(makeTrack(), Number.NaN)
    await expect(ensureTrackDuration('t1', nan.deps)).resolves.toBe(0)
    expect(nan.save).not.toHaveBeenCalled()

    const negative = setup(makeTrack(), -10)
    await expect(ensureTrackDuration('t1', negative.deps)).resolves.toBe(0)
    expect(negative.save).not.toHaveBeenCalled()
  })
})
