import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// 变速产物缓存：命名规则与清理策略都是纯逻辑，
// 目录由调用方传入（transcode.ts 负责取 app.getPath('userData')）。

// 缓存上限：超过后按最久未使用优先删除
export const CACHE_MAX_BYTES = 2 * 1024 ** 3
export const CACHE_MAX_AGE_MS = 14 * 24 * 3600 * 1000

export interface CacheEntry {
  path: string
  size: number
  mtimeMs: number
}

export function variantCacheDirFor(userDataDir: string): string {
  return join(userDataDir, 'variants')
}

export function ensureVariantCacheDir(userDataDir: string): string {
  const dir = variantCacheDirFor(userDataDir)
  mkdirSync(dir, { recursive: true })
  return dir
}

// 缓存 key 包含源文件大小与 mtime，源文件被替换后会自动重新生成
export function variantFileName(
  input: string,
  stat: { size: number; mtimeMs: number },
  rate: number
): string {
  const key = createHash('sha1')
    .update(`${input}|${stat.size}|${stat.mtimeMs}|${rate}`)
    .digest('hex')
    .slice(0, 16)
  return `${key}-${rate}x.flac`
}

// 先删过期文件，再按「最久未使用」删到总量上限内，返回要删除的路径
export function pickFilesToDelete(
  files: CacheEntry[],
  now: number,
  maxAgeMs = CACHE_MAX_AGE_MS,
  maxBytes = CACHE_MAX_BYTES
): string[] {
  const expired: string[] = []
  const alive: CacheEntry[] = []
  for (const file of files) {
    if (now - file.mtimeMs > maxAgeMs) expired.push(file.path)
    else alive.push(file)
  }

  let total = alive.reduce((sum, file) => sum + file.size, 0)
  const overflow: string[] = []
  if (total > maxBytes) {
    for (const file of [...alive].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxBytes) break
      overflow.push(file.path)
      total -= file.size
    }
  }

  return [...expired, ...overflow]
}

// 目录不可用时静默跳过：缓存清理失败不能影响启动
export function pruneCacheDir(
  dir: string,
  now = Date.now(),
  maxAgeMs = CACHE_MAX_AGE_MS,
  maxBytes = CACHE_MAX_BYTES
): void {
  let files: CacheEntry[]
  try {
    files = []
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      try {
        const info = statSync(path)
        if (!info.isFile()) continue
        files.push({ path, size: info.size, mtimeMs: info.mtimeMs })
      } catch {
        // 单个文件异常不影响整体清理
      }
    }
  } catch {
    return
  }

  for (const target of pickFilesToDelete(files, now, maxAgeMs, maxBytes)) {
    try {
      unlinkSync(target)
    } catch {
      // 忽略删除失败
    }
  }
}
