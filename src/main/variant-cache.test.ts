import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CACHE_MAX_AGE_MS,
  CACHE_MAX_BYTES,
  ensureVariantCacheDir,
  pickFilesToDelete,
  pruneCacheDir,
  variantCacheDirFor,
  variantFileName
} from './variant-cache'

const MB = 1024 * 1024
const DAY = 24 * 3600 * 1000

describe('variantFileName', () => {
  const stat = { size: 4801767, mtimeMs: 1700000000000 }

  it('同一文件同一倍速生成稳定文件名', () => {
    const a = variantFileName('/music/a.mp3', stat, 1.25)
    expect(a).toBe(variantFileName('/music/a.mp3', stat, 1.25))
    expect(a).toMatch(/^[0-9a-f]{16}-1\.25x\.flac$/)
  })

  it('倍速、路径、大小、mtime 任一变化都会换 key', () => {
    const base = variantFileName('/music/a.mp3', stat, 1.25)
    expect(variantFileName('/music/a.mp3', stat, 0.8)).not.toBe(base)
    expect(variantFileName('/music/b.mp3', stat, 1.25)).not.toBe(base)
    expect(variantFileName('/music/a.mp3', { ...stat, size: 1 }, 1.25)).not.toBe(base)
    expect(variantFileName('/music/a.mp3', { ...stat, mtimeMs: 1 }, 1.25)).not.toBe(base)
  })

  it('文件名里保留倍速后缀，便于人工排查', () => {
    expect(variantFileName('/a.mp3', stat, 0.7)).toContain('-0.7x.flac')
    expect(variantFileName('/a.mp3', stat, 1.5)).toContain('-1.5x.flac')
  })
})

describe('pickFilesToDelete', () => {
  const now = 1_700_000_000_000
  const entry = (name: string, mtimeMs: number, size = 10 * MB) => ({
    path: `/cache/${name}`,
    size,
    mtimeMs
  })

  it('过期文件全部删除（不论总量）', () => {
    const files = [entry('old', now - CACHE_MAX_AGE_MS - 1), entry('fresh', now)]
    expect(pickFilesToDelete(files, now)).toEqual(['/cache/old'])
  })

  it('未超上限且未过期时什么都不删', () => {
    expect(pickFilesToDelete([entry('a', now), entry('b', now)], now)).toEqual([])
  })

  it('超过总量上限时按 mtime 从旧到新删', () => {
    // 4 个各 1GB（上限 2GB），必须删掉最旧的 2 个
    const each = CACHE_MAX_BYTES / 2
    const files = [
      entry('newest', now, each),
      entry('oldest', now - 3 * DAY, each),
      entry('older', now - 2 * DAY, each),
      entry('old', now - DAY, each)
    ]
    expect(pickFilesToDelete(files, now)).toEqual(['/cache/oldest', '/cache/older'])
  })

  it('删够就停，不会清空整个缓存', () => {
    // 4 个 100 字节，上限 250：删 2 个后剩 200，保留 c/d
    const files = [
      entry('a', now - 4 * DAY, 100),
      entry('b', now - 3 * DAY, 100),
      entry('c', now - 2 * DAY, 100),
      entry('d', now - DAY, 100)
    ]
    expect(pickFilesToDelete(files, now, CACHE_MAX_AGE_MS, 250)).toEqual(['/cache/a', '/cache/b'])
  })

  it('恰好等于上限时不删除', () => {
    const files = [entry('a', now, 100), entry('b', now, 100)]
    expect(pickFilesToDelete(files, now, CACHE_MAX_AGE_MS, 200)).toEqual([])
  })
})

describe('pruneCacheDir', () => {
  const dirs: string[] = []

  function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'peak-player-cache-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('删除过期文件，保留新鲜文件', () => {
    const dir = makeDir()
    const now = Date.now()
    const old = join(dir, 'old.flac')
    const fresh = join(dir, 'fresh.flac')
    writeFileSync(old, 'x')
    writeFileSync(fresh, 'y')
    const oldTime = (now - CACHE_MAX_AGE_MS - DAY) / 1000
    utimesSync(old, oldTime, oldTime)

    pruneCacheDir(dir, now)

    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('目录不存在时静默返回，不抛错', () => {
    expect(() => pruneCacheDir(join(tmpdir(), 'peak-player-not-exist-xyz'))).not.toThrow()
  })

  it('忽略子目录，只处理文件', () => {
    const dir = makeDir()
    const sub = join(dir, 'sub')
    mkdirSync(sub)
    pruneCacheDir(dir, Date.now() + CACHE_MAX_AGE_MS * 3)
    expect(existsSync(sub)).toBe(true)
  })
})

describe('缓存目录路径', () => {
  it('统一放在 userData/variants 下', () => {
    expect(variantCacheDirFor('/home/u/.config/peak-player')).toBe(
      join('/home/u/.config/peak-player', 'variants')
    )
  })

  it('ensureVariantCacheDir 会创建目录', () => {
    const base = mkdtempSync(join(tmpdir(), 'peak-player-userdata-'))
    try {
      const dir = ensureVariantCacheDir(base)
      expect(dir).toBe(join(base, 'variants'))
      // 再调用一次不应报错（已存在）
      expect(ensureVariantCacheDir(base)).toBe(dir)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
