import { beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '../shared/types'
import {
  addTracks,
  addTrackSeconds,
  addUsage,
  getRanking,
  getWeeklyUsage,
  incrementCount,
  initDb,
  listTracks,
  updateTrack
} from './db'

function makeTrack(overrides: Partial<Track>): Track {
  return {
    id: '1',
    title: 'song',
    path: '/music/song.mp3',
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    ...overrides
  }
}

beforeEach(() => {
  initDb(':memory:')
})

describe('addTracks / listTracks', () => {
  it('添加并列出歌曲', () => {
    addTracks([makeTrack({ id: '1', title: 'A' }), makeTrack({ id: '2', title: 'B' })])
    expect(listTracks()).toHaveLength(2)
  })

  it('重复 id 不会重复添加（INSERT OR IGNORE）', () => {
    addTracks([makeTrack({ id: '1', title: 'A' })])
    const n = addTracks([makeTrack({ id: '1', title: 'A' })])
    expect(n).toBe(0)
    expect(listTracks()).toHaveLength(1)
  })

  it('按标题升序排列', () => {
    addTracks([makeTrack({ id: '2', title: 'Zebra' }), makeTrack({ id: '1', title: 'Apple' })])
    expect(listTracks().map((t) => t.title)).toEqual(['Apple', 'Zebra'])
  })
})

describe('updateTrack / incrementCount', () => {
  it('手动修改播放次数', () => {
    addTracks([makeTrack({ id: '1', playCount: 5 })])
    updateTrack('1', { playCount: 100 })
    expect(listTracks()[0].playCount).toBe(100)
  })

  it('incrementCount 累加次数', () => {
    addTracks([makeTrack({ id: '1', playCount: 3 })])
    incrementCount('1', 1)
    incrementCount('1', 2)
    expect(listTracks()[0].playCount).toBe(6)
  })

  it('incrementCount 返回自增后的最新次数', () => {
    addTracks([makeTrack({ id: '1', playCount: 3 })])
    expect(incrementCount('1', 1)).toBe(4)
    expect(incrementCount('1', 2)).toBe(6)
  })
})

describe('addUsage / getWeeklyUsage', () => {
  it('补齐近 7 天数据，缺失日期为 0', () => {
    addUsage(60) // 今天 +60 秒
    const weekly = getWeeklyUsage(7)
    expect(weekly).toHaveLength(7)
    expect(weekly[6].seconds).toBe(60) // 最后一天（今天）
    expect(weekly.slice(0, 6).every((d) => d.seconds === 0)).toBe(true)
  })

  it('同一天多次累加', () => {
    addUsage(30)
    addUsage(40)
    const weekly = getWeeklyUsage(7)
    expect(weekly[6].seconds).toBe(70)
  })

  it('日期格式为 YYYY-MM-DD', () => {
    const weekly = getWeeklyUsage(7)
    expect(weekly).toHaveLength(7)
    expect(weekly.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true)
  })
})

describe('getRanking', () => {
  it('按播放次数降序排序', () => {
    addTracks([
      makeTrack({ id: '1', title: 'A', playCount: 10 }),
      makeTrack({ id: '2', title: 'B', playCount: 50 }),
      makeTrack({ id: '3', title: 'C', playCount: 30 })
    ])
    expect(getRanking('count').map((t) => t.title)).toEqual(['B', 'C', 'A'])
  })

  it('按时长降序排序', () => {
    addTracks([
      makeTrack({ id: '1', title: 'A', totalSeconds: 100 }),
      makeTrack({ id: '2', title: 'B', totalSeconds: 500 })
    ])
    expect(getRanking('duration').map((t) => t.title)).toEqual(['B', 'A'])
  })

  it('只返回排序字段大于 0 的歌曲', () => {
    addTracks([
      makeTrack({ id: '1', title: 'A', playCount: 0, totalSeconds: 0 }),
      makeTrack({ id: '2', title: 'B', playCount: 10 })
    ])
    expect(getRanking('count')).toHaveLength(1)
  })
})

describe('addTrackSeconds', () => {
  it('累计收听时长', () => {
    addTracks([makeTrack({ id: '1' })])
    addTrackSeconds('1', 30)
    addTrackSeconds('1', 20)
    expect(listTracks()[0].totalSeconds).toBe(50)
  })
})
