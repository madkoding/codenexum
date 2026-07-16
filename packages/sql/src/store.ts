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

// ponytail: using any for db to avoid better-sqlite3 CJS type gymnastics
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

function run(db: Db, sql: string, ...args: any[]): void {
  db.prepare(sql).run(...args)
}

function queryOne(db: Db, sql: string, ...args: any[]): any {
  return db.prepare(sql).get(...args)
}

function queryAll(db: Db, sql: string, ...args: any[]): any[] {
  return db.prepare(sql).all(...args)
}

const FTS_COLUMNS = ["name", "content", "id", "file", "type", "line", "lineEnd", "body", "lang"]

export function initSchema(db: Db): void {
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA cache_size = -32000")
  db.exec("PRAGMA temp_store = MEMORY")

  try {
    const existing = queryAll(db, "PRAGMA table_info(chunks_fts)") as { name: string }[]
    if (existing.length > 0) {
      const names = new Set(existing.map((c) => c.name))
      const missing = FTS_COLUMNS.filter((c) => !names.has(c))
      if (missing.length > 0) {
        db.exec("DROP TABLE chunks_fts")
      }
    }
  } catch {}

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

  // ponytail: auxiliary denormalized index for O(1) file membership checks.
  // chunks_fts.file is UNINDEXED (FTS5 can't index that column), so any
  // "file in chunks_fts?" subquery degrades to a full virtual table scan.
  // Mirror the distinct file list into files_indexed to make those checks
  // O(log n) via the primary key.
  db.exec("CREATE TABLE IF NOT EXISTS files_indexed (file TEXT PRIMARY KEY)")
  db.exec(`CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,
    tokens_saved INTEGER,
    tokens_used INTEGER,
    meta TEXT,
    ts INTEGER
  )`)
  db.exec("CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts)")
  db.exec("CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type)")

  try { db.exec("ANALYZE") } catch {}
}

const MAX_CONTENT = 200

function truncate(s: string, max = MAX_CONTENT): string {
  return s.length <= max ? s : s.slice(0, max) + "…"
}

export function dbInsertChunks(db: Db, chunks: Chunk[]): void {
  const seen = new Set<string>()
  const seenFiles = new Set<string>()
  db.exec("BEGIN")
  try {
    for (const c of chunks) {
      const key = `${c.file}\u0000${c.name}\u0000${c.type}\u0000${c.line}`
      if (seen.has(key)) continue
      seen.add(key)
      run(
        db,
        "INSERT INTO chunks_fts (name, content, id, file, type, line, lineEnd, body, lang) VALUES (?,?,?,?,?,?,?,?,?)",
        c.name, truncate(c.content), c.id, c.file, c.type, c.line, c.lineEnd, c.body, c.lang,
      )
      seenFiles.add(c.file)
    }
    if (seenFiles.size > 0) {
      const stmt = db.prepare("INSERT OR IGNORE INTO files_indexed (file) VALUES (?)")
      for (const f of seenFiles) stmt.run(f)
    }
    db.exec("COMMIT")
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }
}

export function dbGetFileHash(db: Db, file: string): string | null {
  const row = queryOne(db, "SELECT hash FROM file_hashes WHERE file = ?", file) as { hash: string } | null
  return row?.hash ?? null
}

export function dbSetFileHash(db: Db, file: string, hash: string): void {
  run(db, "INSERT OR REPLACE INTO file_hashes (file, hash) VALUES (?, ?)", file, hash)
}

export function dbGetMeta(db: Db, key: string): string | null {
  const row = queryOne(db, "SELECT value FROM meta WHERE key = ?", key) as { value: string } | null
  return row?.value ?? null
}

export function dbSetMeta(db: Db, key: string, value: string): void {
  run(db, "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value)
}

export function dbGetSchemaVersion(db: Db): number {
  try {
    const value = dbGetMeta(db, "schema_version")
    if (!value) return 0
    const n = parseInt(value, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function dbSetSchemaVersion(db: Db, version: number): void {
  dbSetMeta(db, "schema_version", String(version))
}

export function dbChunkCount(db: Db): number {
  const row = queryOne(db, "SELECT count(*) as n FROM chunks_fts") as { n: number }
  return row.n
}

export function dbFileCount(db: Db): number {
  const row = queryOne(db, "SELECT count(*) as n FROM files_indexed") as { n: number }
  return row.n
}

const MAX_FTS_TERMS = 30

export function buildFtsQuery(query: string): string {
  const parts = query.toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length >= 2)
  const seen = new Set<string>()
  const terms: string[] = []
  for (const t of parts) {
    if (seen.has(t)) continue
    seen.add(t)
    const safe = t.replace(/"/g, "'")
    terms.push(`"${safe}"*`)
    if (terms.length >= MAX_FTS_TERMS) break
  }
  if (terms.length === 0) return ""
  const looksLikePath = query.includes("/") || /\.[a-z0-9]{1,5}$/i.test(query.trim())
  const joiner = looksLikePath ? " OR " : " AND "
  return terms.join(joiner)
}

export function dbSearch(db: Db, query: string, n: number): SearchResult[] {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []
  const primary = queryAll(db, `
    SELECT name, content, body, file, type, line, lineEnd, lang, bm25(chunks_fts) as score
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `, ftsQuery, n) as SearchResult[]
  if (primary.length > 0) return primary
  const fallback = dbSearchFallback(db, query, n)
  return fallback
}

export function dbRawSearch(db: Db, query: string, n: number): SearchResult[] {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []
  const primary = queryAll(db, `
    SELECT name, content, body, file, type, line, lineEnd, lang, bm25(chunks_fts) as score
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    LIMIT ?
  `, ftsQuery, n) as SearchResult[]
  if (primary.length > 0) return primary
  const fallback = dbSearchFallback(db, query, n)
  return fallback
}

function dbSearchFallback(db: Db, query: string, n: number): SearchResult[] {
  const tokens = new Set<string>()
  for (const piece of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (piece.length >= 2) tokens.add(piece)
  }
  const parts = query.toLowerCase().split(/[^a-z0-9]+/).filter(p => p.length >= 2)
  for (const p of parts) {
    const sub = p.split(/_+/).filter(s => s.length >= 2)
    for (const s of sub) tokens.add(s)
  }
  const terms = Array.from(tokens).slice(0, MAX_FTS_TERMS)
  if (terms.length === 0) return []
  const conds: string[] = []
  const params: string[] = []
  for (const t of terms) {
    const like = `%${t.replace(/[%_]/g, (m) => `\\${m}`)}%`
    conds.push("(LOWER(name) LIKE ? OR LOWER(content) LIKE ? OR LOWER(body) LIKE ?)")
    params.push(like, like, like)
  }
  const where = conds.join(" OR ")
  params.push(String(n))
  return queryAll(db, `
    SELECT name, content, body, file, type, line, lineEnd, lang, 0 as score
    FROM chunks_fts
    WHERE ${where}
    LIMIT ?
  `, ...params) as SearchResult[]
}

export function dbClear(db: Db): void {
  db.exec("DELETE FROM chunks_fts")
  db.exec("DELETE FROM file_hashes")
  db.exec("DELETE FROM meta")
  db.exec("DELETE FROM edges")
  db.exec("DELETE FROM files_indexed")
}

export function dbDeleteChunksForFile(db: Db, file: string): void {
  run(db, "DELETE FROM chunks_fts WHERE file = ?", file)
}

export function dbRefreshFilesIndexed(db: Db): void {
  run(db, "DELETE FROM files_indexed WHERE file NOT IN (SELECT DISTINCT file FROM chunks_fts)")
}

export function dbDeleteFileHash(db: Db, file: string): void {
  run(db, "DELETE FROM file_hashes WHERE file = ?", file)
}

export function dbDeleteFile(db: Db, file: string): void {
  db.exec("BEGIN")
  try {
    run(db, "DELETE FROM chunks_fts WHERE file = ?", file)
    run(db, "DELETE FROM file_hashes WHERE file = ?", file)
    run(db, "DELETE FROM files_indexed WHERE file = ?", file)
    db.exec("COMMIT")
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }
}

export function dbInsertEdges(db: Db, edges: Edge[]): void {
  db.exec("BEGIN")
  try {
    for (const e of edges) {
      run(
        db,
        "INSERT INTO edges (source_file, source_symbol, target_file, target_symbol, kind) VALUES (?,?,?,?,?)",
        e.sourceFile, e.sourceSymbol, e.targetFile, e.targetSymbol, e.kind,
      )
    }
    db.exec("COMMIT")
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }
}

export function dbDeleteEdgesForFile(db: Db, file: string): void {
  run(db, "DELETE FROM edges WHERE source_file = ?", file)
}

export function dbFindRelated(
  db: Db,
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
  db: Db,
  files: string[],
): { file: string; dependent: string; kind: string; symbol: string }[] {
  if (files.length === 0) return []
  const placeholders = files.map(() => "?").join(",")
  const rows = queryAll(db, `SELECT target_file, source_file, source_symbol, kind FROM edges WHERE target_file IN (${placeholders})`, ...files) as { target_file: string; source_file: string; source_symbol: string; kind: string }[]
  return rows.map(r => ({ file: r.target_file, dependent: r.source_file, kind: r.kind, symbol: r.source_symbol }))
}

export function dbEdgeCount(db: Db): number {
  const row = queryOne(db, "SELECT count(*) as n FROM edges") as { n: number }
  return row.n
}

export function dbGetChunksForFile(db: Db, file: string): SearchResult[] {
  return queryAll(
    db,
    "SELECT name, content, body, file, type, line, lineEnd, lang, bm25(chunks_fts) as score FROM chunks_fts WHERE file = ? ORDER BY line",
    file,
  ) as SearchResult[]
}

export function dbFindFilesByPattern(db: Db, pattern: string): string[] {
  let like = pattern.toLowerCase()
  like = like.replace(/%/g, "\\%").replace(/_/g, "\\_")
  like = like.replace(/\*\*/g, "%")
  like = like.replace(/\*/g, "%")
  like = like.replace(/\?/g, "_")
  const rows = queryAll(db, "SELECT DISTINCT file FROM chunks_fts WHERE file LIKE ? ESCAPE '\\'", like) as { file: string }[]
  return rows.map(r => r.file)
}

export function dbStatsByLang(db: Db): { ext: string; n: number }[] {
  const rows = queryAll(db, "SELECT file, count(*) as n FROM chunks_fts GROUP BY file") as { file: string; n: number }[]
  const byLang: Record<string, number> = {}
  for (const r of rows) {
    const ext = "." + r.file.split(".").pop()
    byLang[ext] = (byLang[ext] || 0) + r.n
  }
  return Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([ext, n]) => ({ ext, n }))
}

export function dbTopFiles(db: Db, limit = 10): { file: string; n: number }[] {
  const rows = queryAll(
    db,
    "SELECT file, count(*) as n FROM chunks_fts GROUP BY file ORDER BY n DESC LIMIT ?",
    limit,
  ) as { file: string; n: number }[]
  return rows
}

export function dbFindLoadedFiles(db: Db, limit = 10): { file: string; n: number }[] {
  const rows = queryAll(
    db,
    "SELECT target_file, count(DISTINCT source_file) as n FROM edges GROUP BY target_file ORDER BY n DESC LIMIT ?",
    limit,
  ) as { target_file: string; n: number }[]
  return rows.map(({ target_file, n }) => ({ file: target_file, n }))
}
