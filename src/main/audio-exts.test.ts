import { describe, expect, it } from 'vitest'
import { AUDIO_EXTS, isSupportedAudio } from './audio-exts'

describe('isSupportedAudio', () => {
  it('接受 Chromium 内置可解码的格式', () => {
    for (const ext of AUDIO_EXTS) {
      expect(isSupportedAudio(`/music/song${ext}`)).toBe(true)
    }
  })

  it('扩展名大小写不敏感', () => {
    expect(isSupportedAudio('/music/SONG.MP3')).toBe(true)
    expect(isSupportedAudio('/music/song.FlAc')).toBe(true)
  })

  // .wma 没有解码器，导入后表现为「能播但没声音」，必须挡在导入阶段
  it('拒绝 .wma 与其它不支持格式', () => {
    expect(isSupportedAudio('/music/song.wma')).toBe(false)
    expect(isSupportedAudio('/music/song.ape')).toBe(false)
    expect(isSupportedAudio('/music/song.txt')).toBe(false)
  })

  it('没有扩展名或传入目录时拒绝', () => {
    expect(isSupportedAudio('/music/song')).toBe(false)
    expect(isSupportedAudio('/music/')).toBe(false)
  })

  it('目录名里出现音频后缀不影响判断', () => {
    expect(isSupportedAudio('/music/mp3/song.wma')).toBe(false)
    expect(isSupportedAudio('/music/wma/song.mp3')).toBe(true)
  })
})
