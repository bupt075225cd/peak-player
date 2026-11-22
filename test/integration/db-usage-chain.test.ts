import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Album, Track } from '../../src/shared/types'
import {
  addTrackSeconds,
  addTracks,
  addUsage,
  createAlbum,
  deleteAlbum,
  deleteTrack,
  getRanking,
  getTrack,
  getWeeklyUsage,
  incrementCount,
  initDb,
  listAlbums,
  listTracks,
  localDate,
  renameAlbum,
  setTrackAlbum,
  setTrackDuration,
  updateTrack
} from '../../src/main/db'
import { createIpcHandlers, type IpcDeps, type IpcEvent } from '../../src/main/ipc'
import { ensureTrackDuration } from '../../src/main/track-duration'
import { FFMPEG } from '../helpers/ffmpeg'
import { makeTempDir, type TempDir } from '../helpers/tmp'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/peak-test-userdata',
    isPackaged: false,
    getAppPath: () => process.cwd()
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
}))

// 集成测试：真实 SQLite 文件 + 真实 db 模块 + 真实 track-duration 编排 + 真实 IPC handler，
// 只把「ffmpeg 探测」换成可计数桩，验证「改次数 → 补采时长 → 换算用时」的完整链路。
// 单测里这三个模块各自都对，接线错了照样一行数据都不会动。

const event: IpcEvent = { sender: { isDestroyed: () => false, send: () => {} } }

function track(overrides: Partial<Track> = {}): Track {
  const id = overrides.id ?? 't1'
  return {
    id,
    title: 'Song',
    // 默认路径按 id 派生：addTracks 按 path 去重，同路径会被判为同一首
    path: `/music/${id}.mp3`,
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 0,
    albumId: null,
    ...overrides
  }
}

// 与生产 createIpcDeps() 的接线保持一致（addUsage 同时记总量与单曲）
function buildHandlers(
  probe: (path: string) => Promise<number> = async () => 0,
  overrides: Partial<IpcDeps> = {}
) {
  const probeSpy = vi.fn(probe)
  const deps: IpcDeps = {
    pickAudioFiles: async () => null,
    isSupportedAudio: (p) => /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i.test(p),
    listTracks,
    addTracks,
    getTrack,
    deleteTrack,
    listAlbums,
    createAlbum,
    renameAlbum,
    deleteAlbum,
    setTrackAlbum,
    updateTrack,
    incrementCount,
    setTrackDuration,
    addUsage: (seconds, trackId) => {
      addUsage(seconds)
      if (trackId) addTrackSeconds(trackId, seconds)
    },
    getWeeklyUsage: (days) => getWeeklyUsage(days ?? 7),
    getRanking,
    ensureTrackDuration: (id) =>
      ensureTrackDuration(id, { getTrack, probeAudioDuration: probeSpy, setTrackDuration }),
    prepareVariant: async () => ({ path: '/cache/x.flac' }),
    loadLyrics: async () => ({ lines: [], offset: 0, source: 'none' }),
    newId: (() => {
      let n = 0
      return () => `gen-${++n}`
    })(),
    ...overrides
  }
  return { handlers: createIpcHandlers(deps), probeSpy }
}

function dayOffset(offset: number): string {
  const now = new Date()
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset))
}

describe('改次数 → 补采时长 → 换算用时（真实文件库）', () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = makeTempDir('dbchain-')
    initDb(tmp.file('peak.db'))
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it('duration 为 0 时先用探测结果补齐，再按「时长 × 次数」记账', async () => {
    addTracks([track({ id: 't1' })])
    const { handlers, probeSpy } = buildHandlers(async () => 12)

    await handlers['tracks:update']!(event, 't1', { playCount: 2 })

    expect(probeSpy).toHaveBeenCalledOnce()
    expect(probeSpy).toHaveBeenCalledWith('/music/t1.mp3')

    const saved = getTrack('t1')!
    expect(saved.playCount).toBe(2)
    expect(saved.duration).toBe(12)
    expect(saved.totalSeconds).toBe(24)

    const today = getWeeklyUsage(7).at(-1)!
    expect(today.date).toBe(localDate(new Date()))
    expect(today.seconds).toBe(24)
  })

  it('duration 已有值时不再探测 ffmpeg', async () => {
    addTracks([track({ id: 't2', duration: 30 })])
    const { handlers, probeSpy } = buildHandlers(async () => 99)

    await handlers['tracks:update']!(event, 't2', { playCount: 1 })

    expect(probeSpy).not.toHaveBeenCalled()
    expect(getTrack('t2')!.duration).toBe(30)
    expect(getTrack('t2')!.totalSeconds).toBe(30)
  })

  it('探测失败（ffmpeg 不可用）时次数照改，用时不变', async () => {
    addTracks([track({ id: 't3' })])
    const { handlers } = buildHandlers(async () => {
      throw new Error('spawn ffmpeg ENOENT')
    })

    await handlers['tracks:update']!(event, 't3', { playCount: 1 })

    expect(getTrack('t3')!.playCount).toBe(1)
    expect(getTrack('t3')!.totalSeconds).toBe(0)
    expect(getWeeklyUsage(7).at(-1)!.seconds).toBe(0)
  })

  it('次数调小时按最早日期逐天扣减，不产生负数', async () => {
    addTracks([track({ id: 't4', duration: 10 })])
    // 手工铺三天历史：每天 10 秒
    addUsage(10, dayOffset(2))
    addUsage(10, dayOffset(1))
    addUsage(10, dayOffset(0))

    const { handlers } = buildHandlers()

    // 0 → 3 次：+30 秒记到今天（今天 10 + 30 = 40）
    await handlers['tracks:update']!(event, 't4', { playCount: 3 })
    expect(getWeeklyUsage(7).at(-1)!.seconds).toBe(40)

    // 3 → 0 次：-30 秒，从最早日期开始扣（前两天的 10 秒各清零，今天扣 10）
    await handlers['tracks:update']!(event, 't4', { playCount: 0 })

    const week = getWeeklyUsage(7)
    expect(week.every((d) => d.seconds >= 0)).toBe(true)
    expect(week.at(-1)!.seconds).toBe(30)
    expect(week.reduce((sum, d) => sum + d.seconds, 0)).toBe(30)
    expect(getTrack('t4')!.totalSeconds).toBe(0)
    expect(getTrack('t4')!.playCount).toBe(0)
  })

  it('播放上报用时：总量与单曲同时累加', () => {
    addTracks([track({ id: 't5' })])
    const { handlers } = buildHandlers()

    handlers['usage:add']!(event, 15, 't5')

    expect(getTrack('t5')!.totalSeconds).toBe(15)
    expect(getWeeklyUsage(7).at(-1)!.seconds).toBe(15)
  })

  it('真实文件库上排行榜按对应字段排序，且过滤 0 值', () => {
    addTracks([
      track({ id: 'a', title: 'A', playCount: 5, totalSeconds: 10 }),
      track({ id: 'b', title: 'B', playCount: 1, totalSeconds: 300 }),
      track({ id: 'c', title: 'C', playCount: 0, totalSeconds: 0 })
    ])

    expect(getRanking('count').map((t) => t.id)).toEqual(['a', 'b'])
    expect(getRanking('duration').map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('导入过滤后写入真实文件库，列表标题按文件名生成', async () => {
    const { handlers } = buildHandlers(async () => 0, {
      pickAudioFiles: async () => ['/music/x.mp3', '/music/y.wma', '/music/z.flac']
    })

    await handlers['tracks:import']!(event)

    expect(listTracks().map((t) => t.title)).toEqual(['x', 'z'])
  })

  it('重复导入同一批文件不会产生重复行', async () => {
    const { handlers } = buildHandlers(async () => 0, {
      pickAudioFiles: async () => ['/music/x.mp3', '/music/z.flac']
    })

    await handlers['tracks:import']!(event)
    const firstIds = listTracks().map((t) => t.id)

    // 第二次导入会生成新的 UUID，去重必须落在 path 上
    await handlers['tracks:import']!(event)

    expect(listTracks()).toHaveLength(2)
    expect(listTracks().map((t) => t.id)).toEqual(firstIds)
  })
})

describe('createIpcDeps 生产接线', () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = makeTempDir('deps-')
    initDb(tmp.file('peak.db'))
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it('选文件：取消返回 null，确认返回路径列表', async () => {
    const { dialog } = await import('electron')
    const { createIpcDeps } = await import('../../src/main/ipc')
    const deps = createIpcDeps()
    const open = vi.mocked(dialog.showOpenDialog)

    open.mockResolvedValue({ canceled: true, filePaths: [] } as never)
    expect(await deps.pickAudioFiles()).toBeNull()
    expect(open).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ properties: ['openFile', 'multiSelections'] })
    )

    open.mockResolvedValue({ canceled: false, filePaths: ['/music/a.mp3'] } as never)
    expect(await deps.pickAudioFiles()).toEqual(['/music/a.mp3'])
  })

  it('addUsage 同时记总量与单曲，getWeeklyUsage 默认 7 天', async () => {
    const { createIpcDeps } = await import('../../src/main/ipc')
    addTracks([track({ id: 'd1' })])
    const deps = createIpcDeps()

    deps.addUsage(5, 'd1')

    expect(getTrack('d1')!.totalSeconds).toBe(5)
    expect(deps.getWeeklyUsage().length).toBe(7)
    expect(deps.getWeeklyUsage(3).length).toBe(3)
  })

  it('ensureTrackDuration 在生产接线下可用，newId 每次不同', async () => {
    const { createIpcDeps } = await import('../../src/main/ipc')
    const deps = createIpcDeps()
    addTracks([track({ id: 'd2', path: '/nonexistent/x.mp3' })])

    // 文件不存在时 ffmpeg 探测失败，不能影响改次数
    await expect(deps.ensureTrackDuration('d2')).resolves.toBe(0)

    expect(deps.newId()).not.toBe(deps.newId())
    expect(deps.isSupportedAudio('a.mp3')).toBe(true)
    expect(deps.isSupportedAudio('a.wma')).toBe(false)
  })
})

describe('真实 ffmpeg 探测时长', () => {
  const run = FFMPEG.available ? it : it.skip

  run('对 2 秒 WAV 探测出约 2 秒', async () => {
    const { probeAudioDuration } = await import('../../src/main/transcode')
    const { writeWav } = await import('../helpers/wav')
    const dir = makeTempDir('probe-')
    const file = dir.file('tone.wav')
    writeWav(file, 2)

    const previous = process.env['PEAK_FFMPEG']
    process.env['PEAK_FFMPEG'] = FFMPEG.path
    try {
      const seconds = await probeAudioDuration(file)
      expect(seconds).toBeGreaterThanOrEqual(1)
      expect(seconds).toBeLessThanOrEqual(3)
    } finally {
      if (previous === undefined) delete process.env['PEAK_FFMPEG']
      else process.env['PEAK_FFMPEG'] = previous
      dir.cleanup()
    }
  })
})

// 专辑走完整链路：IPC handler → 真实 db → 再经 handler 读回
describe('专辑链路（真实文件库）', () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = makeTempDir('albumchain-')
    initDb(tmp.file('peak.db'))
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it('创建 → 批量归入 → 重命名 → 删除后曲目回到未分类', async () => {
    addTracks([track({ id: 't1' }), track({ id: 't2' })])
    const { handlers } = buildHandlers()

    const created = (await handlers['albums:create']!(event, 'Jazz')) as Album[]
    expect(created).toHaveLength(1)
    const albumId = created[0].id

    const assigned = (await handlers['tracks:set-album']!(
      event,
      ['t1', 't2'],
      albumId
    )) as Track[]
    expect(assigned.every((t) => t.albumId === albumId)).toBe(true)

    const listed = (await handlers['albums:list']!(event)) as Album[]
    expect(listed[0].trackCount).toBe(2)

    const renamed = (await handlers['albums:rename']!(event, albumId, 'Soul')) as Album[]
    expect(renamed[0].name).toBe('Soul')

    await handlers['albums:delete']!(event, albumId)
    expect(getTrack('t1')?.albumId).toBeNull()
  })

  it('set-album 传 null 把曲目移回未分类', async () => {
    addTracks([track({ id: 't1' })])
    const { handlers } = buildHandlers()

    const created = (await handlers['albums:create']!(event, 'Jazz')) as Album[]
    await handlers['tracks:set-album']!(event, ['t1'], created[0].id)

    const back = (await handlers['tracks:set-album']!(event, ['t1'], null)) as Track[]
    expect(back[0].albumId).toBeNull()
  })
})
