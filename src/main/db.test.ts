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
  localDate,
  setPlayCount,
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
    duration: 0,
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

describe('setPlayCount 联动用时统计', () => {
  it('增加次数时按曲目时长记入当天用时', () => {
    addTracks([makeTrack({ id: '1', playCount: 2, totalSeconds: 60, duration: 30 })])
    setPlayCount('1', 4) // +2 次 × 30 秒
    expect(listTracks()[0].playCount).toBe(4)
    expect(listTracks()[0].totalSeconds).toBe(120)
    expect(getWeeklyUsage(7)[6].seconds).toBe(60)
  })

  it('减少次数时从最早的日期开始逐天扣减', () => {
    addTracks([makeTrack({ id: '1', playCount: 4, totalSeconds: 200, duration: 30 })])
    const d2 = localDate(new Date(Date.now() - 2 * 86400000))
    const d1 = localDate(new Date(Date.now() - 86400000))
    addUsage(50, d2)
    addUsage(40, d1)

    setPlayCount('1', 1) // -3 次 × 30 秒 = 90 秒：先扣最早那天 50，再扣昨天 40

    const weekly = getWeeklyUsage(7)
    expect(weekly[4].seconds).toBe(0)
    expect(weekly[5].seconds).toBe(0)
    expect(listTracks()[0].totalSeconds).toBe(110)
  })

  it('扣减不足时历史记录归零，不会出现负数', () => {
    addTracks([makeTrack({ id: '1', playCount: 4, totalSeconds: 30, duration: 30 })])
    addUsage(20, localDate(new Date(Date.now() - 86400000)))
    setPlayCount('1', 0) // -4 次 × 30 秒 = 120 秒，但历史只有 20
    expect(getWeeklyUsage(7)[5].seconds).toBe(0)
    expect(listTracks()[0].totalSeconds).toBe(0)
  })

  it('曲目时长未知时不调整用时', () => {
    addTracks([makeTrack({ id: '1', playCount: 1, duration: 0 })])
    setPlayCount('1', 5)
    expect(listTracks()[0].playCount).toBe(5)
    expect(getWeeklyUsage(7)[6].seconds).toBe(0)
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
