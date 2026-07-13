import { LRUCache } from "lru-cache"
import { DatabaseSync } from "node:sqlite"
import type { DatabaseSync as Db } from "node:sqlite"

const pool = new LRUCache<string, Db>({
  max: 16,
  dispose(db) {
    try { db.close() } catch {}
  },
})

export function getDb(dbPath: string): Db {
  let db = pool.get(dbPath)
  if (!db) {
    db = new DatabaseSync(dbPath)
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
