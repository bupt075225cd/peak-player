import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createIpcHandlers, type IpcDeps } from './ipc'

// 契约测试：main 与 preload 之间的通道名只靠字符串约定，
// 漏注册一侧不会编译报错，只会在运行时静默 reject
// （audio:variant 就曾这样：preload 在调用，main 从未 handle）。
//
// 通道表来自 createIpcHandlers() 的真实返回值（而非正则扫源码），
// 这样重构注册方式也不会让测试空跑。

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/peak-contract', isPackaged: false, getAppPath: () => process.cwd() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}))

const ROOT = process.cwd()
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')
const extract = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].map((matched) => matched[1])

const PRELOAD = read('src/preload/index.ts')
const MAIN_FILES = [
  'src/main/index.ts',
  'src/main/ipc.ts',
  'src/main/tray.ts',
  'src/main/window.ts',
  'src/main/transcode.ts'
]

function stubDeps(): IpcDeps {
  return {
    pickAudioFiles: async () => null,
    isSupportedAudio: () => true,
    listTracks: () => [],
    addTracks: () => 0,
    getTrack: () => undefined,
    updateTrack: () => {},
    incrementCount: () => 0,
    setTrackDuration: () => {},
    addUsage: () => {},
    getWeeklyUsage: () => [],
    getRanking: () => [],
    ensureTrackDuration: async () => 0,
    prepareVariant: async () => ({ path: '/cache/a.flac' }),
    newId: () => 'id'
  }
}

describe('IPC 通道契约', () => {
  const invoked = extract(PRELOAD, /ipcRenderer\.invoke\(\s*'([^']+)'/g)
  const listened = extract(PRELOAD, /ipcRenderer\.on\(\s*'([^']+)'/g)
  const handled = Object.keys(createIpcHandlers(stubDeps()))

  it('能解析到通道（防止正则失效后测试空跑）', () => {
    expect(invoked.length).toBeGreaterThan(0)
    expect(handled.length).toBeGreaterThan(0)
    expect(listened.length).toBeGreaterThan(0)
  })

  it('preload 调用的每个通道都在主进程注册了 handler', () => {
    const missing = invoked.filter((channel) => !handled.includes(channel))
    expect(missing).toEqual([])
  })

  it('主进程注册的 handler 都有 preload 侧调用方（避免死通道）', () => {
    const unused = handled.filter((channel) => !invoked.includes(channel))
    expect(unused).toEqual([])
  })

  it('preload 监听的事件通道都有主进程发送方', () => {
    const mainSource = MAIN_FILES.map(read).join('\n')
    const missing = listened.filter((channel) => !mainSource.includes(`send('${channel}'`))
    expect(missing).toEqual([])
  })

  it('通道名不重复注册', () => {
    expect(new Set(handled).size).toBe(handled.length)
  })
})
