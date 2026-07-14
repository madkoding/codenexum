import { LRUCache } from "lru-cache"
import { DatabaseSync } from "node:sqlite"
import type { DatabaseSync as Db } from "node:sqlite"

const pool = new LRUCache<string, Db>({
  max: 16,
  dispose(db) {
    try { db.close() } catch {}
  },
})

function applyPragmas(db: Db): void {
  // WAL is set by initSchema, but the per-project DB is opened by
  // the db-pool for analytics/dashboard queries (read-only style).
  // These PRAGMAs only run once per pooled connection.
  try { db.exec("PRAGMA journal_mode = WAL") } catch {}
  try { db.exec("PRAGMA synchronous = NORMAL") } catch {}
  // 64 MiB page cache per connection. Default is ~2 MiB.
  try { db.exec("PRAGMA cache_size = -65536") } catch {}
  // 256 MiB mmap. Trades disk for memory; the dashboard reads a lot
  // of chunks_fts rows and FTS5 benefits a lot from mmap.
  try { db.exec("PRAGMA mmap_size = 268435456") } catch {}
  try { db.exec("PRAGMA temp_store = MEMORY") } catch {}
  // Keep query planner stats fresh so the LEFT JOIN ... IS NULL in
  // getIndexHealth() picks the right plan.
  try { db.exec("ANALYZE") } catch {}
}

export function getDb(dbPath: string): Db {
  let db = pool.get(dbPath)
  if (!db) {
    db = new DatabaseSync(dbPath)
    applyPragmas(db)
    pool.set(dbPath, db)
  }
  return db
}

export function dropDb(dbPath: string): void {
  const db = pool.get(dbPath)
  if (db) {
    pool.delete(dbPath)
    try { db.close() } catch {}
  }
}

export function getPoolSize(): number {
  return pool.size
}

export function closeAll(): void {
  pool.clear()
}
