import { Database } from "bun:sqlite"
import { join, basename } from "path"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import { createHash } from "crypto"
import { charsToTokens } from "./tokens"

export interface ProjectInfo {
  id: string
  path: string
  name: string
  dbPath: string
  lastSeen: string
  createdAt: string
}

let registryDb: Database | null = null
let usageEventCallback: (() => void) | null = null

export function setOnUsageEvent(cb: (() => void) | null): void {
  usageEventCallback = cb
}

function registryPath(): string {
  const override = process.env.CONTEXT_MANAGER_REGISTRY_PATH
  if (override) return override
  const dir = join(process.env.HOME || "/tmp", ".cache/opencode")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, "context-manager-registry.sqlite")
}

export function getRegistry(): Database {
  if (registryDb) return registryDb
  try {
    registryDb = new Database(registryPath())
  } catch (e) {
    console.error("[context-manager] failed to open registry DB, retrying...", e)
    registryDb = new Database(registryPath())
  }
  registryDb.exec("PRAGMA journal_mode = WAL")
  ensureExitHook()
  registryDb.exec(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    db_path TEXT NOT NULL,
    last_seen TEXT,
    created_at TEXT
  )`)
  registryDb.exec(`CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    query TEXT,
    tokens_saved INTEGER DEFAULT 0,
    ts INTEGER NOT NULL
  )`)
  registryDb.exec("CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events(project_id)")
  registryDb.exec("CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts)")
  return registryDb
}

export function projectId(directory: string): string {
  return createHash("md5").update(directory).digest("hex").slice(0, 16)
}

export function projectDbPath(directory: string): string {
  const cacheDir = process.env.CONTEXT_MANAGER_CACHE_DIR || join(process.env.HOME || "/tmp", ".cache/opencode")
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  return join(cacheDir, `context-manager-${projectId(directory)}.sqlite`)
}

export function registerProject(directory: string): ProjectInfo {
  const db = getRegistry()
  const id = projectId(directory)
  const dbPath = projectDbPath(directory)
  const name = basename(directory)
  const now = new Date().toISOString()
  const row = (db as any).query("SELECT created_at FROM projects WHERE id = ?").get(id)
  if (row) {
    (db as any).run("UPDATE projects SET path = ?, name = ?, last_seen = ? WHERE id = ?", directory, name, now, id)
  } else {
    (db as any).run("INSERT INTO projects (id, path, name, db_path, last_seen, created_at) VALUES (?,?,?,?,?,?)", id, directory, name, dbPath, now, now)
  }
  return { id, path: directory, name, dbPath, lastSeen: now, createdAt: row?.created_at || now }
}

export function listProjects(): ProjectInfo[] {
  const db = getRegistry()
  const rows = (db as any).query("SELECT * FROM projects ORDER BY last_seen DESC").all() as any[]
  return rows.map(row => ({
    id: row.id, path: row.path, name: row.name,
    dbPath: row.db_path, lastSeen: row.last_seen, createdAt: row.created_at,
  }))
}

export function getProject(id: string): ProjectInfo | null {
  const db = getRegistry()
  const row = (db as any).query("SELECT * FROM projects WHERE id = ?").get(id) as any
  if (!row) return null
  return {
    id: row.id, path: row.path, name: row.name,
    dbPath: row.db_path, lastSeen: row.last_seen, createdAt: row.created_at,
  }
}

let _cachedProjects: ProjectInfo[] | null = null
let _cachedProjectsTs = 0
const PROJECT_CACHE_TTL = 2000

export function findProjectByPath(filePath: string): ProjectInfo | null {
  if (!_cachedProjects || Date.now() - _cachedProjectsTs > PROJECT_CACHE_TTL) {
    _cachedProjects = listProjects()
    _cachedProjectsTs = Date.now()
  }
  const projects = _cachedProjects
  let best: ProjectInfo | null = null
  let bestLen = 0
  for (const p of projects) {
    const sep = filePath.includes("\\") ? "\\" : "/"
    if (filePath.startsWith(p.path + sep) && p.path.length > bestLen) {
      best = p
      bestLen = p.path.length
    }
  }
  return best
}

export function recordUsageEvent(projectIdVal: string, sessionId: string | undefined, eventType: string, query?: string, tokensSaved?: number): void {
  const db = getRegistry()
  ;(db as any).run(
    "INSERT INTO usage_events (project_id, session_id, event_type, query, tokens_saved, ts) VALUES (?,?,?,?,?,?)",
    projectIdVal, sessionId || "", eventType, query || "", tokensSaved || 0, Date.now()
  )
  if (usageEventCallback) usageEventCallback()
}

export interface ProjectUsage {
  searchQueries: number
  nativeSearches: number
  snippetsUsed: number
  filesRead: number
  toolsIntercepted: number
  compressionSaved: number
  semanticCompressionSaved: number
  searchSaved: number
  compactions: number
  indexSubstitutions: number
  indexMissed: number
  indexSavedTokens: number
  cacheHits: number
  generativeCompressionSaved: number
  outputCompressionSaved: number
  recentSearches: { query: string; usedSnippet: boolean; ts: number }[]
}

const USAGE_WINDOW = 7 * 24 * 60 * 60 * 1000 // 7 days

export function getProjectUsage(projId: string): ProjectUsage {
  const db = getRegistry()
  const cutoff = Date.now() - USAGE_WINDOW
  const rows = (db as any).query("SELECT event_type, query, tokens_saved, ts FROM usage_events WHERE project_id = ? AND ts >= ? ORDER BY ts DESC").all(projId, cutoff) as { event_type: string; query: string; tokens_saved: number; ts: number }[]
  const usage: ProjectUsage = {
    searchQueries: 0, nativeSearches: 0, snippetsUsed: 0, filesRead: 0, toolsIntercepted: 0,
    compressionSaved: 0, semanticCompressionSaved: 0, searchSaved: 0, compactions: 0, indexSubstitutions: 0,
    indexMissed: 0, indexSavedTokens: 0, cacheHits: 0, generativeCompressionSaved: 0, outputCompressionSaved: 0,
    recentSearches: [],
  }
  for (const r of rows) {
    switch (r.event_type) {
      case "search": usage.searchQueries++; if (r.tokens_saved > 0) usage.snippetsUsed++; break
      case "native_search": usage.nativeSearches++; break
      case "read": usage.filesRead++; break
      case "intercept": usage.toolsIntercepted++; break
      case "compression": usage.toolsIntercepted++; usage.compressionSaved += r.tokens_saved; break
      case "semantic_compression": usage.toolsIntercepted++; usage.semanticCompressionSaved += r.tokens_saved; break
      case "compaction": usage.compactions++; break
      case "search_savings": usage.searchSaved += r.tokens_saved; break
      case "index_substitute": usage.indexSubstitutions++; usage.indexSavedTokens += r.tokens_saved; break
      case "index_missed": usage.indexMissed++; break
      case "cache_hit": usage.cacheHits++; break
      case "generative_compression": usage.generativeCompressionSaved += r.tokens_saved; break
      case "output_compression": usage.outputCompressionSaved += r.tokens_saved; break
    }
    if (r.event_type === "search" && r.query) {
      usage.recentSearches.push({ query: r.query, usedSnippet: r.tokens_saved > 0, ts: r.ts })
    }
  }
  usage.recentSearches = usage.recentSearches.slice(0, 20)
  return usage
}

export interface GlobalUsage {
  totalSearches: number
  totalReads: number
  totalIntercepts: number
  totalCompressionSaved: number
  totalSearchSaved: number
  totalIndexSavedTokens: number
  totalSemanticSaved: number
  totalCacheHits: number
  totalCompactions: number
  totalGenerativeSaved: number
  totalOutputCompressionSaved: number
  totalMeasuredTokens: number
}

export function getGlobalUsage(): GlobalUsage {
  const db = getRegistry()
  const row = (db as any).query(`
    SELECT
      SUM(CASE WHEN event_type = 'search' THEN 1 ELSE 0 END) as totalSearches,
      SUM(CASE WHEN event_type = 'read' THEN 1 ELSE 0 END) as totalReads,
      SUM(CASE WHEN event_type IN ('intercept','compression','semantic_compression') THEN 1 ELSE 0 END) as totalIntercepts,
      SUM(CASE WHEN event_type = 'compression' THEN tokens_saved ELSE 0 END) as totalCompressionSaved,
      SUM(CASE WHEN event_type = 'search_savings' THEN tokens_saved ELSE 0 END) as totalSearchSaved,
      SUM(CASE WHEN event_type = 'index_substitute' THEN tokens_saved ELSE 0 END) as totalIndexSavedTokens,
      SUM(CASE WHEN event_type = 'semantic_compression' THEN tokens_saved ELSE 0 END) as totalSemanticSaved,
      SUM(CASE WHEN event_type = 'cache_hit' THEN 1 ELSE 0 END) as totalCacheHits,
      SUM(CASE WHEN event_type = 'compaction' THEN 1 ELSE 0 END) as totalCompactions,
      SUM(CASE WHEN event_type = 'generative_compression' THEN tokens_saved ELSE 0 END) as totalGenerativeSaved,
      SUM(CASE WHEN event_type = 'output_compression' THEN tokens_saved ELSE 0 END) as totalOutputCompressionSaved
    FROM usage_events
  `).get() as any
  const compressionSaved = row?.totalCompressionSaved || 0
  const searchSavedChars = row?.totalSearchSaved || 0
  const indexSavedTokens = row?.totalIndexSavedTokens || 0
  const semanticSaved = row?.totalSemanticSaved || 0
  const generativeSaved = row?.totalGenerativeSaved || 0
  const outputCompressionSaved = row?.totalOutputCompressionSaved || 0
  return {
    totalSearches: row?.totalSearches || 0,
    totalReads: row?.totalReads || 0,
    totalIntercepts: row?.totalIntercepts || 0,
    totalCompressionSaved: compressionSaved,
    totalSearchSaved: searchSavedChars,
    totalIndexSavedTokens: indexSavedTokens,
    totalSemanticSaved: semanticSaved,
    totalCacheHits: row?.totalCacheHits || 0,
    totalCompactions: row?.totalCompactions || 0,
    totalGenerativeSaved: generativeSaved,
    totalOutputCompressionSaved: outputCompressionSaved,
    totalMeasuredTokens: compressionSaved + searchSavedChars + indexSavedTokens + semanticSaved + generativeSaved + outputCompressionSaved,
  }
}

export interface TimelineBucket {
  ts: number
  searches: number
  reads: number
  intercepts: number
  indexSubstitutions: number
  indexSavedTokens: number
  semanticSaved: number
  cacheHits: number
  compactions: number
  tokensSaved: number
}

export function getUsageTimeline(hours = 24): TimelineBucket[] {
  const db = getRegistry()
  const cutoff = Date.now() - hours * 3600 * 1000
  const rows = (db as any).query(`
    SELECT
      (ts / 900000) * 900000 as bucket,
      SUM(CASE WHEN event_type IN ('search','native_search') THEN 1 ELSE 0 END) as searches,
      SUM(CASE WHEN event_type = 'read' THEN 1 ELSE 0 END) as reads,
      SUM(CASE WHEN event_type IN ('intercept','compression','semantic_compression') THEN 1 ELSE 0 END) as intercepts,
      SUM(CASE WHEN event_type = 'index_substitute' THEN 1 ELSE 0 END) as indexSubstitutions,
      SUM(CASE WHEN event_type = 'index_substitute' THEN tokens_saved ELSE 0 END) as indexSavedTokens,
      SUM(CASE WHEN event_type = 'semantic_compression' THEN tokens_saved ELSE 0 END) as semanticSaved,
      SUM(CASE WHEN event_type = 'cache_hit' THEN 1 ELSE 0 END) as cacheHits,
      SUM(CASE WHEN event_type = 'compaction' THEN 1 ELSE 0 END) as compactions,
      SUM(CASE WHEN event_type IN ('index_substitute','semantic_compression','compression','search_savings') THEN tokens_saved ELSE 0 END) as tokensSaved
    FROM usage_events
    WHERE ts >= ?
    GROUP BY bucket
    ORDER BY bucket
  `).all(cutoff) as any[]
  return rows.map(r => ({
    ts: r.bucket,
    searches: r.searches || 0,
    reads: r.reads || 0,
    intercepts: r.intercepts || 0,
    indexSubstitutions: r.indexSubstitutions || 0,
    indexSavedTokens: r.indexSavedTokens || 0,
    semanticSaved: r.semanticSaved || 0,
    cacheHits: r.cacheHits || 0,
    compactions: r.compactions || 0,
    tokensSaved: r.tokensSaved || 0,
  }))
}

export interface ToolMiss {
  tool: string
  misses: number
  total: number
  rate: number
  potentialTokens: number
}

export function getMissesByTool(projId: string): ToolMiss[] {
  const db = getRegistry()
  const rows = (db as any).query(`
    SELECT query, tokens_saved
    FROM usage_events
    WHERE project_id = ? AND event_type = 'index_missed'
  `).all(projId) as { query: string; tokens_saved: number }[]
  const byTool = new Map<string, { misses: number; potentialTokens: number }>()
  for (const r of rows) {
    const tool = r.query.split("|")[0] || "unknown"
    const entry = byTool.get(tool) || { misses: 0, potentialTokens: 0 }
    entry.misses++
    entry.potentialTokens += r.tokens_saved || 0
    byTool.set(tool, entry)
  }
  const interceptRows = (db as any).query(`
    SELECT query, COUNT(*) as n
    FROM usage_events
    WHERE project_id = ? AND event_type IN ('intercept','compression','semantic_compression')
    GROUP BY query
  `).all(projId) as { query: string; n: number }[]
  const interceptByTool = new Map<string, number>()
  for (const r of interceptRows) {
    const tool = r.query.split(/\s+/)[0] || "unknown"
    interceptByTool.set(tool, (interceptByTool.get(tool) || 0) + r.n)
  }
  const out: ToolMiss[] = []
  for (const [tool, data] of byTool) {
    const intercepted = interceptByTool.get(tool) || 0
    const total = data.misses + intercepted
    out.push({ tool, misses: data.misses, total, rate: total > 0 ? data.misses / total : 0, potentialTokens: data.potentialTokens })
  }
  return out.sort((a, b) => b.misses - a.misses)
}

export interface TopMissedRead {
  file: string
  misses: number
  potentialTokens: number
}

export function getTopMissedReads(projId: string, limit = 10): TopMissedRead[] {
  const db = getRegistry()
  const rows = (db as any).query(`
    SELECT query, tokens_saved
    FROM usage_events
    WHERE project_id = ? AND event_type = 'index_missed'
  `).all(projId) as { query: string; tokens_saved: number }[]
  const byFile = new Map<string, { misses: number; potentialTokens: number }>()
  for (const r of rows) {
    const parts = r.query.split("|")
    const file = parts[1] || ""
    if (!file) continue
    const entry = byFile.get(file) || { misses: 0, potentialTokens: 0 }
    entry.misses++
    entry.potentialTokens += r.tokens_saved || 0
    byFile.set(file, entry)
  }
  return Array.from(byFile.entries())
    .map(([file, data]) => ({ file, misses: data.misses, potentialTokens: data.potentialTokens }))
    .sort((a, b) => b.misses - a.misses)
    .slice(0, limit)
}

export interface SavingsByMechanism {
  indexSubstitution: number
  semanticCompression: number
  compression: number
  searchSnippets: number
  generativeCompression: number
  outputCompression: number
}

export function getSavingsByMechanism(projId: string): SavingsByMechanism {
  const db = getRegistry()
  const row = (db as any).query(`
    SELECT
      SUM(CASE WHEN event_type = 'index_substitute' THEN tokens_saved ELSE 0 END) as indexSubstitution,
      SUM(CASE WHEN event_type = 'semantic_compression' THEN tokens_saved ELSE 0 END) as semanticCompression,
      SUM(CASE WHEN event_type = 'compression' THEN tokens_saved ELSE 0 END) as compression,
      SUM(CASE WHEN event_type = 'search_savings' THEN tokens_saved ELSE 0 END) as searchSnippets,
      SUM(CASE WHEN event_type = 'generative_compression' THEN tokens_saved ELSE 0 END) as generativeCompression,
      SUM(CASE WHEN event_type = 'output_compression' THEN tokens_saved ELSE 0 END) as outputCompression
    FROM usage_events
    WHERE project_id = ?
  `).get(projId) as any
  return {
    indexSubstitution: row?.indexSubstitution || 0,
    semanticCompression: row?.semanticCompression || 0,
    compression: row?.compression || 0,
    searchSnippets: row?.searchSnippets || 0,
    generativeCompression: row?.generativeCompression || 0,
    outputCompression: row?.outputCompression || 0,
  }
}

export function getToolTypeDistribution(): { tool: string; count: number }[] {
  const db = getRegistry()
  const rows = (db as any).query(`
    SELECT query as tool, COUNT(*) as count
    FROM usage_events
    WHERE event_type = 'intercept'
    GROUP BY query
    ORDER BY count DESC
  `).all() as { tool: string; count: number }[]
  // Extract the base command (first word) for grouping
  const grouped = new Map<string, number>()
  for (const r of rows) {
    const base = r.tool.split(/\s+/)[0] || r.tool
    grouped.set(base, (grouped.get(base) || 0) + r.count)
  }
  return Array.from(grouped.entries()).map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count)
}

export function deleteProject(id: string): boolean {
  const proj = getProject(id)
  if (!proj) return false

  const db = getRegistry()
  ;(db as any).run("DELETE FROM projects WHERE id = ?", id)
  ;(db as any).run("DELETE FROM usage_events WHERE project_id = ?", id)

  try {
    if (existsSync(proj.dbPath)) unlinkSync(proj.dbPath)
  } catch {}

  return true
}

export function closeRegistry(): void {
  try { registryDb?.close() } catch (e) {
    console.error("[context-manager] error closing registry DB", e)
  }
  registryDb = null
}

let _exitHookRegistered = false
function ensureExitHook(): void {
  if (_exitHookRegistered) return
  _exitHookRegistered = true
  process.on("exit", () => closeRegistry())
}

export interface RecentCompressionEvent {
  eventType: string
  tokensSaved: number
  ts: number
}

export function getRecentCompressionEvents(limit = 10): RecentCompressionEvent[] {
  const db = getRegistry()
  const rows = (db as any).query(
    "SELECT event_type, tokens_saved, ts FROM usage_events WHERE event_type IN ('generative_compression','output_compression') ORDER BY ts DESC LIMIT ?"
  ).all(limit) as { event_type: string; tokens_saved: number; ts: number }[]
  return rows.map(r => ({ eventType: r.event_type, tokensSaved: r.tokens_saved, ts: r.ts }))
}