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
      total_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_usage (
      date    TEXT PRIMARY KEY,
      seconds INTEGER NOT NULL DEFAULT 0
    );
  `)
}

function getDb(): Database.Database {
  if (!db) initDb()
  return db!
}

// ---- 歌曲 ----
export function addTracks(items: Track[]): number {
  const d = getDb()
  const stmt = d.prepare(`
    INSERT OR IGNORE INTO tracks (id, title, path, source_type, play_count, total_seconds)
    VALUES (@id, @title, @path, @sourceType, @playCount, @totalSeconds)
  `)
  const tx = d.transaction((rows: Track[]) => {
    let n = 0
    for (const r of rows) n += stmt.run(r).changes
    return n
  })
  return tx(items)
}

export function listTracks(): Track[] {
  return getDb()
    .prepare(`
      SELECT id, title, path, source_type AS sourceType,
             play_count AS playCount, total_seconds AS totalSeconds
      FROM tracks ORDER BY title ASC
    `)
    .all() as Track[]
}

export function updateTrack(id: string, patch: Partial<Pick<Track, 'playCount'>>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.playCount !== undefined) {
    fields.push('play_count = ?')
    values.push(patch.playCount)
  }
  if (fields.length === 0) return
  values.push(id)
  getDb()
    .prepare(`UPDATE tracks SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values)
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
export function addUsage(seconds: number): void {
  const today = localDate(new Date())
  getDb()
    .prepare(`
      INSERT INTO daily_usage (date, seconds) VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET seconds = seconds + excluded.seconds
    `)
    .run(today, seconds)
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
             play_count AS playCount, total_seconds AS totalSeconds
      FROM tracks
      WHERE ${order} > 0
      ORDER BY ${order} DESC
      LIMIT 100
    `)
    .all() as Track[]
}
