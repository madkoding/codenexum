import type { Database } from "bun:sqlite"
import type { Chunk } from "./types"

export interface SearchResult {
  name: string
  content: string
  file: string
  type: string
  line: number
  score: number
}

export function initSchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    name, content, id UNINDEXED, file UNINDEXED, type UNINDEXED, line UNINDEXED,
    tokenize='trigram'
  )`)
  db.exec("CREATE TABLE IF NOT EXISTS file_hashes (file TEXT PRIMARY KEY, hash TEXT)")
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
}

export function dbInsertChunks(db: Database, chunks: Chunk[]): void {
  const tx = db.transaction(() => {
    for (const c of chunks) {
      db.run("INSERT INTO chunks_fts (name, content, id, file, type, line) VALUES (?,?,?,?,?,?)",
        c.name, c.content, c.id, c.file, c.type, c.line)
    }
  })
  tx()
}

export function dbDeleteFile(db: Database, file: string): void {
  db.run("DELETE FROM chunks_fts WHERE file = ?", file)
  db.run("DELETE FROM file_hashes WHERE file = ?", file)
}

export function dbGetFileHash(db: Database, file: string): string | null {
  const row = db.query("SELECT hash FROM file_hashes WHERE file = ?").get(file) as { hash: string } | null
  return row?.hash ?? null
}

export function dbSetFileHash(db: Database, file: string, hash: string): void {
  db.run("INSERT OR REPLACE INTO file_hashes (file, hash) VALUES (?, ?)", file, hash)
}

export function dbGetMeta(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null
  return row?.value ?? null
}

export function dbSetMeta(db: Database, key: string, value: string): void {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value)
}

export function dbChunkCount(db: Database): number {
  const row = db.query("SELECT count(*) as n FROM chunks_fts").get() as { n: number }
  return row.n
}

export function dbFileCount(db: Database): number {
  const row = db.query("SELECT count(DISTINCT file) as n FROM chunks_fts").get() as { n: number }
  return row.n
}

export function buildFtsQuery(query: string): string {
  return query.toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length >= 2)
    .map(t => `"${t}"`)
    .join(" OR ")
}

export function dbSearch(db: Database, query: string, n: number): SearchResult[] {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []
  return db.query(`
    SELECT name, content, file, type, line, bm25(chunks_fts) as score
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `).all(ftsQuery, n) as SearchResult[]
}

export function dbClear(db: Database): void {
  db.exec("DELETE FROM chunks_fts")
  db.exec("DELETE FROM file_hashes")
  db.exec("DELETE FROM meta")
}

export function dbStatsByLang(db: Database): { ext: string; n: number }[] {
  const rows = db.query("SELECT file, count(*) as n FROM chunks_fts GROUP BY file").all() as { file: string; n: number }[]
  const byLang: Record<string, number> = {}
  for (const r of rows) {
    const ext = "." + r.file.split(".").pop()
    byLang[ext] = (byLang[ext] || 0) + r.n
  }
  return Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([ext, n]) => ({ ext, n }))
}