import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import type { DailyUsage, RankingBy, Track } from '../shared/types'

let db: Database.Database | undefined

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// dbPath 可注入：生产用 userData，测试用 ':memory:' 或临时文件
export function initDb(dbPath?: string): void {
  db?.close()
  const p = dbPath ?? join(app.getPath('userData'), 'peak-player.db')
  db = new Database(p)
  if (p !== ':memory:') db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      path          TEXT NOT NULL,
      source_type   TEXT NOT NULL DEFAULT 'local',
      play_count    INTEGER NOT NULL DEFAULT 0,
      total_seconds INTEGER NOT NULL DEFAULT 0,
      duration      INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_usage (
      date    TEXT PRIMARY KEY,
      seconds INTEGER NOT NULL DEFAULT 0
    );
  `)

  // 轻量迁移：老库补 duration 列（播放时采集，用于改次数时联动用时统计）
  const columns = db.prepare('PRAGMA table_info(tracks)').all() as { name: string }[]
  if (!columns.some((c) => c.name === 'duration')) {
    db.exec('ALTER TABLE tracks ADD COLUMN duration INTEGER NOT NULL DEFAULT 0')
  }
}

function getDb(): Database.Database {
  if (!db) initDb()
  return db!
}

// ---- 歌曲 ----
export function addTracks(items: Track[]): number {
  const d = getDb()
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO tracks (id, title, path, source_type, play_count, total_seconds, duration)
    VALUES (@id, @title, @path, @sourceType, @playCount, @totalSeconds, @duration)
  `)
  const tx = d.transaction((rows: Track[]) => {
    let n = 0
    for (const r of rows) n += stmt.run({ ...r, duration: r.duration ?? 0 }).changes
    return n
  })
  return tx(items)
}

export function listTracks(): Track[] {
  return getDb()
    .prepare(`
      SELECT id, title, path, source_type AS sourceType,
             play_count AS playCount, total_seconds AS totalSeconds, duration
      FROM tracks ORDER BY title ASC
    `)
    .all() as Track[]
}

export function getTrack(id: string): Track | undefined {
  return getDb()
    .prepare(`
      SELECT id, title, path, source_type AS sourceType,
             play_count AS playCount, total_seconds AS totalSeconds, duration
      FROM tracks WHERE id = ?
    `)
    .get(id) as Track | undefined
}

export function updateTrack(id: string, patch: Partial<Pick<Track, 'playCount'>>): void {
  if (patch.playCount === undefined) return
  setPlayCount(id, patch.playCount)
}

// 改次数并联动用时统计：
// 增加的次数按曲目时长记到今天；减少的次数从最早的日期开始逐天扣减
export function setPlayCount(id: string, count: number): void {
  const d = getDb()
  const row = d
    .prepare('SELECT play_count, total_seconds, duration FROM tracks WHERE id = ?')
    .get(id) as { play_count: number; total_seconds: number; duration: number } | undefined
  if (!row) return

  const next = Math.max(0, Math.floor(count))
  const deltaSeconds = (next - row.play_count) * row.duration

  const tx = d.transaction(() => {
    d.prepare('UPDATE tracks SET play_count = ? WHERE id = ?').run(next, id)
    if (deltaSeconds === 0) return

    if (deltaSeconds > 0) {
      d.prepare('UPDATE tracks SET total_seconds = total_seconds + ? WHERE id = ?').run(
        deltaSeconds,
        id
      )
      addUsage(deltaSeconds)
      return
    }

    // 减少：单曲总时长不低于 0，每日用时从最早日期开始扣
    const need = -deltaSeconds
    d.prepare('UPDATE tracks SET total_seconds = ? WHERE id = ?').run(
      Math.max(0, row.total_seconds - need),
      id
    )
    deductUsageOldestFirst(need)
  })
  tx()
}

// 播放时采集曲目真实时长（秒）
export function setTrackDuration(id: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  getDb()
    .prepare('UPDATE tracks SET duration = ? WHERE id = ?')
    .run(Math.round(seconds), id)
}

// 返回自增后的最新次数，供渲染进程直接同步 UI
export function incrementCount(id: string, delta: number): number {
  const row = getDb()
    .prepare('UPDATE tracks SET play_count = play_count + ? WHERE id = ? RETURNING play_count')
    .get(delta, id) as { play_count: number } | undefined
  return row?.play_count ?? 0
}

export function addTrackSeconds(id: string, seconds: number): void {
  getDb().prepare('UPDATE tracks SET total_seconds = total_seconds + ? WHERE id = ?').run(seconds, id)
}

// ---- 用时 ----
export function addUsage(seconds: number, date = localDate(new Date())): void {
  const today = date
  getDb()
    .prepare(`
      INSERT INTO daily_usage (date, seconds) VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET seconds = seconds + excluded.seconds
    `)
    .run(today, seconds)
}

// 从最早的日期开始逐天扣减，某天扣到 0 就删掉该天记录
export function deductUsageOldestFirst(seconds: number): number {
  if (seconds <= 0) return 0
  const d = getDb()
  const rows = d
    .prepare('SELECT date, seconds FROM daily_usage ORDER BY date ASC')
    .all() as { date: string; seconds: number }[]
  const update = d.prepare('UPDATE daily_usage SET seconds = ? WHERE date = ?')
  const remove = d.prepare('DELETE FROM daily_usage WHERE date = ?')

  let remaining = seconds
  for (const row of rows) {
    if (remaining <= 0) break
    const take = Math.min(row.seconds, remaining)
    const left = row.seconds - take
    if (left > 0) update.run(left, row.date)
    else remove.run(row.date)
    remaining -= take
  }
  // 返回未扣完的余量（历史记录不足时）
  return remaining
}

// 返回补齐的近 N 天数据（缺失的日期补 0），供柱形图直接使用
export function getWeeklyUsage(days = 7): DailyUsage[] {
  const d = getDb()
  const stmt = d.prepare('SELECT seconds FROM daily_usage WHERE date = ?')
  const result: DailyUsage[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const date = localDate(dt)
    const row = stmt.get(date) as { seconds: number } | undefined
    result.push({ date, seconds: row?.seconds ?? 0 })
  }
  return result
}

// ---- 排行榜 ----
export function getRanking(by: RankingBy): Track[] {
  const order = by === 'count' ? 'play_count' : 'total_seconds'
  return getDb()
    .prepare(`
      SELECT id, title, path, source_type AS sourceType,
             play_count AS playCount, total_seconds AS totalSeconds, duration
      FROM tracks
      WHERE ${order} > 0
      ORDER BY ${order} DESC
      LIMIT 100
    `)
    .all() as Track[]
}
