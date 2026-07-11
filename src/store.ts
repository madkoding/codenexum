import type { Database } from "bun:sqlite"
import type { Chunk } from "./types"
import type { Edge } from "./edges"

export const SCHEMA_VERSION = 3

export interface SearchResult {
  name: string
  content: string
  body: string
  file: string
  type: string
  line: number
  lineEnd: number
  lang: string
  score: number
}

// Bun's sqlite types are strict about parameter binding. We cast the db handle
// for run/query calls because the runtime API accepts positional arguments,
// while the generated types only accept template-literal style bindings.
/* eslint-disable @typescript-eslint/no-explicit-any */
function run(db: Database, sql: string, ...args: any[]): void {
  ;(db as any).run(sql, ...args)
}

function queryOne(db: Database, sql: string, ...args: any[]): any {
  return (db as any).query(sql).get(...args)
}

function queryAll(db: Database, sql: string, ...args: any[]): any[] {
  return (db as any).query(sql).all(...args)
}

export function initSchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    name, content,
    id UNINDEXED, file UNINDEXED, type UNINDEXED, line UNINDEXED, lineEnd UNINDEXED, body UNINDEXED, lang UNINDEXED,
    tokenize='trigram'
  )`)
  db.exec("CREATE TABLE IF NOT EXISTS file_hashes (file TEXT PRIMARY KEY, hash TEXT)")
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
  db.exec(`CREATE TABLE IF NOT EXISTS edges (
    source_file TEXT,
    source_symbol TEXT,
    target_file TEXT,
    target_symbol TEXT,
    kind TEXT
  )`)
  db.exec("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_file, target_symbol)")
  db.exec("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_file, source_symbol)")
}

const MAX_CONTENT = 200

function truncate(s: string, max = MAX_CONTENT): string {
  return s.length <= max ? s : s.slice(0, max) + "…"
}

export function dbInsertChunks(db: Database, chunks: Chunk[]): void {
  const seen = new Set<string>()
  const tx = db.transaction(() => {
    for (const c of chunks) {
      const key = `${c.file}\u0000${c.name}\u0000${c.type}`
      if (seen.has(key)) continue
      seen.add(key)
      run(
        db,
        "INSERT INTO chunks_fts (name, content, id, file, type, line, lineEnd, body, lang) VALUES (?,?,?,?,?,?,?,?,?)",
        c.name, truncate(c.content), c.id, c.file, c.type, c.line, c.lineEnd, c.body, c.lang,
      )
    }
  })
  tx()
}

export function dbDeleteFile(db: Database, file: string): void {
  run(db, "DELETE FROM chunks_fts WHERE file = ?", file)
  run(db, "DELETE FROM file_hashes WHERE file = ?", file)
}

export function dbGetFileHash(db: Database, file: string): string | null {
  const row = queryOne(db, "SELECT hash FROM file_hashes WHERE file = ?", file) as { hash: string } | null
  return row?.hash ?? null
}

export function dbSetFileHash(db: Database, file: string, hash: string): void {
  run(db, "INSERT OR REPLACE INTO file_hashes (file, hash) VALUES (?, ?)", file, hash)
}

export function dbGetMeta(db: Database, key: string): string | null {
  const row = queryOne(db, "SELECT value FROM meta WHERE key = ?", key) as { value: string } | null
  return row?.value ?? null
}

export function dbSetMeta(db: Database, key: string, value: string): void {
  run(db, "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value)
}

export function dbGetSchemaVersion(db: Database): number {
  try {
    const value = dbGetMeta(db, "schema_version")
    if (!value) return 0
    const n = parseInt(value, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function dbSetSchemaVersion(db: Database, version: number): void {
  dbSetMeta(db, "schema_version", String(version))
}

export function dbChunkCount(db: Database): number {
  const row = queryOne(db, "SELECT count(*) as n FROM chunks_fts") as { n: number }
  return row.n
}

export function dbFileCount(db: Database): number {
  const row = queryOne(db, "SELECT count(DISTINCT file) as n FROM chunks_fts") as { n: number }
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
  return queryAll(db, `
    SELECT name, content, body, file, type, line, lineEnd, lang, bm25(chunks_fts) as score
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `, ftsQuery, n) as SearchResult[]
}

export function dbRawSearch(db: Database, query: string, n: number): SearchResult[] {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []
  return queryAll(db, `
    SELECT name, content, body, file, type, line, lineEnd, lang, bm25(chunks_fts) as score
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    LIMIT ?
  `, ftsQuery, n) as SearchResult[]
}

export function dbClear(db: Database): void {
  db.exec("DELETE FROM chunks_fts")
  db.exec("DELETE FROM file_hashes")
  db.exec("DELETE FROM meta")
  db.exec("DELETE FROM edges")
}

export function dbInsertEdges(db: Database, edges: Edge[]): void {
  if (edges.length === 0) return
  const tx = db.transaction(() => {
    for (const e of edges) {
      run(
        db,
        "INSERT INTO edges (source_file, source_symbol, target_file, target_symbol, kind) VALUES (?,?,?,?,?)",
        e.sourceFile, e.sourceSymbol, e.targetFile, e.targetSymbol, e.kind,
      )
    }
  })
  tx()
}

export function dbDeleteEdgesForFile(db: Database, file: string): void {
  run(db, "DELETE FROM edges WHERE source_file = ?", file)
}

export function dbFindRelated(
  db: Database,
  file: string,
  symbol: string,
): { kind: string; file: string; symbol: string; direction: "out" | "in" }[] {
  const out = queryAll(db, "SELECT target_file, target_symbol, kind FROM edges WHERE source_file = ? AND source_symbol = ?", file, symbol) as { target_file: string; target_symbol: string; kind: string }[]
  const inc = queryAll(db, "SELECT source_file, source_symbol, kind FROM edges WHERE target_file = ? AND target_symbol = ?", file, symbol) as { source_file: string; source_symbol: string; kind: string }[]
  const results: { kind: string; file: string; symbol: string; direction: "out" | "in" }[] = []
  for (const r of out) {
    results.push({ kind: r.kind, file: r.target_file, symbol: r.target_symbol, direction: "out" })
  }
  for (const r of inc) {
    results.push({ kind: r.kind, file: r.source_file, symbol: r.source_symbol, direction: "in" })
  }
  return results
}

export function dbFindImpacted(
  db: Database,
  files: string[],
): { file: string; dependent: string; kind: string; symbol: string }[] {
  const results: { file: string; dependent: string; kind: string; symbol: string }[] = []
  for (const f of files) {
    const rows = queryAll(db, "SELECT source_file, source_symbol, kind FROM edges WHERE target_file = ?", f) as { source_file: string; source_symbol: string; kind: string }[]
    for (const r of rows) {
      results.push({ file: f, dependent: r.source_file, kind: r.kind, symbol: r.source_symbol })
    }
  }
  return results
}

export function dbEdgeCount(db: Database): number {
  const row = queryOne(db, "SELECT count(*) as n FROM edges") as { n: number }
  return row.n
}

export function dbStatsByLang(db: Database): { ext: string; n: number }[] {
  const rows = queryAll(db, "SELECT file, count(*) as n FROM chunks_fts GROUP BY file") as { file: string; n: number }[]
  const byLang: Record<string, number> = {}
  for (const r of rows) {
    const ext = "." + r.file.split(".").pop()
    byLang[ext] = (byLang[ext] || 0) + r.n
  }
  return Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([ext, n]) => ({ ext, n }))
}

export function dbTopFiles(db: Database, limit = 10): { file: string; n: number }[] {
  const rows = queryAll(
    db,
    "SELECT file, count(*) as n FROM chunks_fts GROUP BY file ORDER BY n DESC LIMIT ?",
    limit,
  ) as { file: string; n: number }[]
  return rows
}
