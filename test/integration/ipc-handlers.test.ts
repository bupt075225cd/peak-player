import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../../src/shared/types'
import { createIpcHandlers, registerIpc, type IpcDeps, type IpcEvent } from '../../src/main/ipc'

// ipc.ts 顶层 import electron，node 环境下没有真实实现，这里给最小桩。
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/peak-test-userdata',
    isPackaged: false,
    getAppPath: () => process.cwd()
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  BrowserWindow: class {},
  Tray: class {},
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createEmpty: () => ({}), createFromPath: () => ({ isEmpty: () => true }) }
}))

function makeDeps(overrides: Partial<IpcDeps> = {}): IpcDeps {
  let seq = 0
  return {
    pickAudioFiles: async () => null,
    isSupportedAudio: (p) => /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i.test(p),
    listTracks: () => [],
    addTracks: () => 0,
    getTrack: () => undefined,
    deleteTrack: () => {},
    updateTrack: () => {},
    incrementCount: () => 0,
    setTrackDuration: () => {},
    addUsage: () => {},
    getWeeklyUsage: () => [],
    getRanking: () => [],
    ensureTrackDuration: async () => 0,
    prepareVariant: async () => ({ path: '/cache/a.flac' }),
    loadLyrics: async () => ({ lines: [], offset: 0, source: 'none' }),
    newId: () => `id-${++seq}`,
    ...overrides
  }
}

const event: IpcEvent = { sender: { isDestroyed: () => false, send: () => {} } }

describe('IPC 通道集合', () => {
  it('与 preload 暴露的调用通道一一对应', () => {
    const handlers = createIpcHandlers(makeDeps())
    expect(Object.keys(handlers).sort()).toEqual(
      [
        'audio:variant',
        'lyrics:get',
        'stats:ranking',
        'tracks:delete',
        'tracks:duration',
        'tracks:import',
        'tracks:increment',
        'tracks:list',
        'tracks:update',
        'usage:add',
        'usage:weekly'
      ].sort()
    )
  })

  it('registerIpc 把每个 handler 注册到 ipcMain', async () => {
    const { ipcMain } = await import('electron')
    vi.mocked(ipcMain.handle).mockClear()

    registerIpc(makeDeps())

    expect(vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]).sort()).toEqual(
      Object.keys(createIpcHandlers(makeDeps())).sort()
    )
  })
})

describe('tracks:import', () => {
  it('过滤不支持的扩展名并按文件名生成标题', async () => {
    const added: Track[] = []
    const handlers = createIpcHandlers(
      makeDeps({
        pickAudioFiles: async () => [
          '/music/第一首.mp3',
          '/music/未支持.wma',
          '/music/第二首.FLAC',
          '/music/readme.txt'
        ],
        addTracks: (tracks) => {
          added.push(...tracks)
          return tracks.length
        },
        listTracks: () => []
      })
    )

    await handlers['tracks:import']!(event)

    expect(added.map((t) => t.title)).toEqual(['第一首', '第二首'])
    expect(added.map((t) => t.path)).toEqual(['/music/第一首.mp3', '/music/第二首.FLAC'])
    expect(added.every((t) => t.id.startsWith('id-'))).toBe(true)
    expect(added.every((t) => t.sourceType === 'local' && t.playCount === 0)).toBe(true)
  })

  it('用户取消时返回现有列表，且不写库', async () => {
    const addTracks = vi.fn(() => 0)
    const existing = [{ id: 'a', title: 'A' }]
    const handlers = createIpcHandlers(
      makeDeps({
        pickAudioFiles: async () => null,
        addTracks,
        listTracks: () => existing as never
      })
    )

    const result = await handlers['tracks:import']!(event)

    expect(addTracks).not.toHaveBeenCalled()
    expect(result).toBe(existing)
  })
})

describe('tracks:update 改次数前的时长补采', () => {
  it('patch 带 playCount 时先补采时长，再写库（顺序有依赖）', async () => {
    const order: string[] = []
    const handlers = createIpcHandlers(
      makeDeps({
        ensureTrackDuration: async () => {
          order.push('ensure')
          return 12
        },
        updateTrack: () => {
          order.push('update')
        }
      })
    )

    await handlers['tracks:update']!(event, 'id-1', { playCount: 3 })

    expect(order).toEqual(['ensure', 'update'])
  })

  it('patch 不含 playCount 时不触发 ffmpeg 探测', async () => {
    const ensureTrackDuration = vi.fn(async () => 0)
    const handlers = createIpcHandlers(makeDeps({ ensureTrackDuration }))

    await handlers['tracks:update']!(event, 'id-1', {})

    expect(ensureTrackDuration).not.toHaveBeenCalled()
  })
})

describe('其余通道透传', () => {
  it('tracks:increment 返回最新次数', () => {
    const handlers = createIpcHandlers(makeDeps({ incrementCount: (_id, d) => 7 + d }))
    expect(handlers['tracks:increment']!(event, 'id-1', 1)).toBe(8)
  })

  it('tracks:duration 写入曲目时长', () => {
    const setTrackDuration = vi.fn()
    const handlers = createIpcHandlers(makeDeps({ setTrackDuration }))

    handlers['tracks:duration']!(event, 'id-1', 95.4)

    expect(setTrackDuration).toHaveBeenCalledWith('id-1', 95.4)
  })

  it('usage:add 在无 trackId 时只记总用时', () => {
    const addUsage = vi.fn()
    const handlers = createIpcHandlers(makeDeps({ addUsage }))

    handlers['usage:add']!(event, 30, null)

    expect(addUsage).toHaveBeenCalledWith(30, null)
  })

  it('usage:weekly 默认取 7 天', () => {
    const getWeeklyUsage = vi.fn(() => [])
    const handlers = createIpcHandlers(makeDeps({ getWeeklyUsage }))

    handlers['usage:weekly']!(event)

    expect(getWeeklyUsage).toHaveBeenCalledWith(undefined)
  })

  it('stats:ranking 透传排序维度', () => {
    const getRanking = vi.fn(() => [])
    const handlers = createIpcHandlers(makeDeps({ getRanking }))

    handlers['stats:ranking']!(event, 'duration')

    expect(getRanking).toHaveBeenCalledWith('duration')
  })

  it('lyrics:get 透传歌曲路径并返回歌词文档', async () => {
    const doc = { lines: [{ time: 1, text: '第一句' }], offset: 0, source: 'sidecar' as const }
    const loadLyrics = vi.fn(async () => doc)
    const handlers = createIpcHandlers(makeDeps({ loadLyrics }))

    await expect(handlers['lyrics:get']!(event, '/music/a.mp3')).resolves.toBe(doc)
    expect(loadLyrics).toHaveBeenCalledWith('/music/a.mp3')
  })
})

describe('audio:variant 进度回传', () => {
  it('把转码进度推给发起请求的 sender', async () => {
    const sent: { channel: string; payload: unknown }[] = []
    const handlers = createIpcHandlers(
      makeDeps({
        prepareVariant: async (_path, _rate, onProgress) => {
          onProgress(0.25)
          onProgress(1)
          return { path: '/cache/a.flac' }
        }
      })
    )

    const result = await handlers['audio:variant']!(
      { sender: { isDestroyed: () => false, send: (channel, payload) => sent.push({ channel, payload }) } },
      '/music/a.mp3',
      1.25
    )

    expect(result).toEqual({ path: '/cache/a.flac' })
    expect(sent).toEqual([
      { channel: 'audio:variant-progress', payload: { trackPath: '/music/a.mp3', rate: 1.25, ratio: 0.25 } },
      { channel: 'audio:variant-progress', payload: { trackPath: '/music/a.mp3', rate: 1.25, ratio: 1 } }
    ])
  })

  it('渲染进程已销毁时不再发送进度', async () => {
    const send = vi.fn()
    const handlers = createIpcHandlers(
      makeDeps({
        prepareVariant: async (_path, _rate, onProgress) => {
          onProgress(0.5)
          return { error: 'ffmpeg 失败' }
        }
      })
    )

    const result = await handlers['audio:variant']!(
      { sender: { isDestroyed: () => true, send } },
      '/music/a.mp3',
      1.5
    )

    expect(send).not.toHaveBeenCalled()
    expect(result).toEqual({ error: 'ffmpeg 失败' })
  })
})

describe('注册幂等性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('同一通道不会被重复注册到不同实现', () => {
    const handlers = createIpcHandlers(makeDeps())
    expect(new Set(Object.keys(handlers)).size).toBe(Object.keys(handlers).length)
  })
})
