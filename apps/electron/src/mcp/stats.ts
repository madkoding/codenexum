import { DatabaseSync } from "node:sqlite"
import { existsSync } from "fs"
import { ensureProject } from "./auto-register.js"
import { getRegistryPath } from "./db-paths.js"
import { getUsageSummary } from "./usage.js"
import { getSemanticCompressionSaved } from "./compress.js"
import type { CountRow, SumRow, MetaRow, DbPathRow, PathRow, ProjectListRow, ProjectRow } from "@codenexum/sql"

function getDbPathForProject(projectDir: string): string | null {
  ensureProject(projectDir)
  const reg = new DatabaseSync(getRegistryPath())
  const row = reg.prepare("SELECT dbPath FROM projects WHERE path = ?").get(projectDir) as DbPathRow | undefined
  reg.close()
  return row?.dbPath || null
}

function getDefaultDbPath(): string | null {
  const reg = new DatabaseSync(getRegistryPath())
  const row = reg.prepare("SELECT dbPath FROM projects ORDER BY lastSeen DESC LIMIT 1").get() as DbPathRow | undefined
  reg.close()
  return row?.dbPath || null
}

export function getProjectStats(projectDir?: string) {
  let dbPath: string | null = null
  if (projectDir) dbPath = getDbPathForProject(projectDir)
  if (!dbPath) dbPath = getDefaultDbPath()
  if (!dbPath || !existsSync(dbPath)) return emptyStats()
  const db = new DatabaseSync(dbPath)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  const tableNames = new Set(tables.map(t => t.name))
  if (!tableNames.has("chunks_fts") || !tableNames.has("file_hashes")) { db.close(); return emptyStats() }
  const chunks = (db.prepare("SELECT count(*) as c FROM chunks_fts").get() as CountRow | undefined)?.c ?? 0
  const files = (db.prepare("SELECT count(*) as c FROM file_hashes").get() as CountRow | undefined)?.c ?? 0
  const edges = (db.prepare("SELECT count(*) as c FROM edges").get() as CountRow | undefined)?.c ?? 0
  const lastIndexed = (db.prepare("SELECT value FROM meta WHERE key = 'lastIndexed'").get() as MetaRow | undefined)?.value || null
  const topFiles = (db.prepare("SELECT file, count(*) as c FROM chunks_fts GROUP BY file ORDER BY c DESC LIMIT 10").all() as { file: string; c: number }[]).map(f => ({ path: f.file, count: f.c }))
  const languages = (db.prepare("SELECT lang, count(*) as c FROM chunks_fts GROUP BY lang ORDER BY c DESC").all() as { lang: string; c: number }[]).map(l => ({ name: l.lang, count: l.c }))
  db.close()
  const usageProjectDir = resolveDirFromDbPath(dbPath) || projectDir || ""
  const usage = usageProjectDir ? getUsageSummary(usageProjectDir) : emptyUsage()
  return {
    chunks, files, edges, lastIndexed,
    hotFiles: topFiles.slice(0, 5),
    topFiles,
    languages,
    ...usage,
  }
}

function emptyStats() {
  return {
    chunks: 0, files: 0, edges: 0, lastIndexed: null,
    hotFiles: [], topFiles: [], languages: [],
    ...emptyUsage(),
  }
}

function emptyUsage() {
  return {
    searches: 0, searchQueries: 0, nativeSearches: 0, indexSubstitutions: 0,
    cacheHits: 0, filesRead: 0, snippetOnly: 0, compactions: 0,
    measuredSavings: 0, semanticCompressionSaved: 0, generativeCompressionSaved: 0,
    outputCompressionSaved: 0,
    efficiencyRatio: 0,
    indexedAt: null, status: "empty",
    missRate: 0, missesByTool: {},
    recommendations: [], avgTokensSavedPerSearch: 0, topMissedReads: [],
    savingsByMechanism: {
      indexSubstitution: 0, semanticCompression: 0, compression: 0,
      searchSnippets: 0, generativeCompression: 0, outputCompression: 0,
    },
    recentEvents: [],
  }
}

function resolveDirFromDbPath(dbPath: string): string | null {
  const reg = new DatabaseSync(getRegistryPath())
  const row = reg.prepare("SELECT path FROM projects WHERE dbPath = ?").get(dbPath) as PathRow | undefined
  reg.close()
  return row?.path || null
}

export function getProjectAggregate(projectDir?: string) {
  let dbPath: string | null = null
  if (projectDir) dbPath = getDbPathForProject(projectDir)
  if (!dbPath) dbPath = getDefaultDbPath()
  if (!dbPath || !existsSync(dbPath)) return { byType: {}, byLang: {}, topFiles: [] }
  const db = new DatabaseSync(dbPath)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  if (!tables.some(t => t.name === "chunks_fts")) { db.close(); return { byType: {}, byLang: {}, topFiles: [] } }
  const byType: Record<string, number> = {}
  const types = db.prepare("SELECT type, count(*) as c FROM chunks_fts GROUP BY type").all() as { type: string; c: number }[]
  for (const t of types) byType[t.type] = t.c
  const byLang: Record<string, number> = {}
  const langs = db.prepare("SELECT lang, count(*) as c FROM chunks_fts GROUP BY lang").all() as { lang: string; c: number }[]
  for (const l of langs) byLang[l.lang] = l.c
  const topFiles = (db.prepare("SELECT file, count(*) as c FROM chunks_fts GROUP BY file ORDER BY c DESC LIMIT 10").all() as { file: string; c: number }[]).map(f => ({ path: f.file, count: f.c }))
  db.close()
  return { byType, byLang, topFiles }
}

export function getCompressionStatus() {
  const semanticSaved = getSemanticCompressionSaved()
  return {
    active: true,
    semanticSaved,
    selfTest: "ok",
    modes: ["semantic", "structural"],
  }
}

export function getDashboardState() {
  const regPath = getRegistryPath()
  if (!existsSync(regPath)) return { projects: [], global: { totalChunks: 0, totalFiles: 0 }, compression: getCompressionStatus() }
  const db = new DatabaseSync(regPath)
  const projects = (db.prepare("SELECT id, path, name, dbPath, lastSeen FROM projects ORDER BY lastSeen DESC").all() as unknown as ProjectRow[]).map(p => ({
    id: p.id, path: p.path, name: p.name, dbPath: p.dbPath, lastSeen: p.lastSeen,
  }))
  db.close()
  let totalChunks = 0, totalFiles = 0, totalSavedTokens = 0, totalEvents = 0
  for (const p of projects) {
    if (existsSync(p.dbPath)) {
      try {
        const pdb = new DatabaseSync(p.dbPath)
        const tables = pdb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
        const tableSet = new Set(tables.map(t => t.name))
        if (tableSet.has("chunks_fts")) {
          totalChunks += (pdb.prepare("SELECT count(*) as c FROM chunks_fts").get() as CountRow | undefined)?.c ?? 0
        }
        if (tableSet.has("file_hashes")) {
          totalFiles += (pdb.prepare("SELECT count(*) as c FROM file_hashes").get() as CountRow | undefined)?.c ?? 0
        }
        if (tableSet.has("usage_events")) {
          const r = pdb.prepare("SELECT COALESCE(SUM(tokens_saved), 0) as s, COUNT(*) as c FROM usage_events").get() as SumRow | undefined
          totalSavedTokens += r?.s || 0
          totalEvents += r?.c || 0
        }
        pdb.close()
      } catch {}
    }
  }
  return {
    projects,
    global: { totalChunks, totalFiles, totalSavedTokens, totalEvents },
    compression: getCompressionStatus(),
  }
}

interface ActivityBucket { hour: string; count: number; saved: number }
interface CumulativePoint { ts: string; total: number }
interface TopQuery { query: string; count: number; saved: number }
interface RecentActivity { type: string; target: string; tokensSaved: number; ts: string; project: string }
interface IndexHealthRow { id: string; name: string; path: string; lastIndexed: string | null; chunks: number; files: number; zeroChunkFiles: number }
interface HotFileRow { path: string; count: number; project: string; chunks: number }

function listRegisteredProjects(): { id: string; name: string; path: string; dbPath: string }[] {
  const regPath = getRegistryPath()
  if (!existsSync(regPath)) return []
  const reg = new DatabaseSync(regPath)
  const rows = reg.prepare("SELECT id, name, path, dbPath FROM projects ORDER BY lastSeen DESC").all() as unknown as ProjectListRow[]
  reg.close()
  return rows
}

export function getGlobalAnalytics() {
  const projects = listRegisteredProjects()
  const activityBuckets = new Map<string, ActivityBucket>()
  const allEvents: { ts: string; type: string; tokensSaved: number; meta: any; project: string }[] = []
  const queryCounts = new Map<string, { count: number; saved: number }>()
  const indexHealth: IndexHealthRow[] = []
  const hotFilesMap = new Map<string, HotFileRow>()

  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.now() - (23 - i) * 60 * 60 * 1000)
    const iso = d.toISOString()
    const hour = iso.slice(0, 13)
    activityBuckets.set(hour, { hour, count: 0, saved: 0 })
  }

  for (const proj of projects) {
    if (!existsSync(proj.dbPath)) continue
    let db: DatabaseSync
    try {
      db = new DatabaseSync(proj.dbPath)
    } catch { continue }

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const tableSet = new Set(tables.map(t => t.name))
    if (!tableSet.has("usage_events")) { db.close(); continue }

    try {
      const events = db.prepare(`
        SELECT event_type, tokens_saved, meta, ts
        FROM usage_events
        WHERE ts > datetime('now', '-1 day')
      `).all() as { event_type: string; tokens_saved: number; meta: string | null; ts: string }[]

      for (const e of events) {
        const hour = e.ts.slice(0, 13).replace(" ", "T")
        const b = activityBuckets.get(hour)
        if (b) { b.count += 1; b.saved += e.tokens_saved || 0 }

        let meta: any = null
        try { meta = e.meta ? JSON.parse(e.meta) : null } catch {}
        allEvents.push({ ts: e.ts, type: e.event_type, tokensSaved: e.tokens_saved || 0, meta, project: proj.name })

        if (e.event_type === "search" && meta?.query) {
          const q = String(meta.query)
          const cur = queryCounts.get(q) || { count: 0, saved: 0 }
          cur.count += 1
          queryCounts.set(q, cur)
        }
        if (e.event_type === "search_savings" && meta?.query) {
          const q = String(meta.query)
          const cur = queryCounts.get(q) || { count: 0, saved: 0 }
          cur.saved += e.tokens_saved || 0
          queryCounts.set(q, cur)
        }
        if (e.event_type === "index_substitute" && meta?.query) {
          const q = String(meta.query)
          const cur = queryCounts.get(q) || { count: 0, saved: 0 }
          cur.count += 1
          cur.saved += e.tokens_saved || 0
          queryCounts.set(q, cur)
        }
      }
    } catch {}

    if (tableSet.has("chunks_fts")) {
      try {
        const lastIndexed = (db.prepare("SELECT value FROM meta WHERE key = 'lastIndexed'").get() as MetaRow | undefined)?.value || null
        const c = (db.prepare("SELECT count(*) as c FROM chunks_fts").get() as CountRow | undefined)?.c ?? 0
        const f = (db.prepare("SELECT count(*) as c FROM file_hashes").get() as CountRow | undefined)?.c ?? 0
        let zeroChunkFiles = 0
        try {
          // Use files_indexed (PK on file) for O(log n) membership check.
          // chunks_fts.file is UNINDEXED in FTS5, so a subquery on chunks_fts
          // degrades to a full virtual-table scan (was 17s on 178k chunks).
          if (tableSet.has("files_indexed")) {
            zeroChunkFiles = (db.prepare(`
              SELECT count(*) as c FROM file_hashes fh
              LEFT JOIN files_indexed fi ON fi.file = fh.file
              WHERE fi.file IS NULL
            `).get() as CountRow | undefined)?.c ?? 0
          } else {
            zeroChunkFiles = (db.prepare(`
              SELECT count(*) as c FROM file_hashes fh
              LEFT JOIN (
                SELECT DISTINCT file FROM chunks_fts
              ) cf ON cf.file = fh.file
              WHERE cf.file IS NULL
            `).get() as CountRow | undefined)?.c ?? 0
          }
        } catch {}
        indexHealth.push({ id: proj.id, name: proj.name, path: proj.path, lastIndexed, chunks: c, files: f, zeroChunkFiles })

        try {
          const top = db.prepare(`
            SELECT file, count(*) as c FROM chunks_fts
            GROUP BY file ORDER BY c DESC LIMIT 5
          `).all() as { file: string; c: number }[]
          for (const t of top) {
            const key = t.file
            const cur = hotFilesMap.get(key)
            if (!cur || t.c > cur.count) {
              hotFilesMap.set(key, { path: t.file, count: t.c, project: proj.name, chunks: t.c })
            }
          }
        } catch {}
      } catch {}
    }

    db.close()
  }

  const activityTimeline = Array.from(activityBuckets.values())

  allEvents.sort((a, b) => a.ts.localeCompare(b.ts))
  let runningTotal = 0
  const cumulativeSavings: CumulativePoint[] = []
  const dayStart = Date.now() - 24 * 60 * 60 * 1000
  for (const e of allEvents) {
    if (e.tokensSaved > 0) {
      runningTotal += e.tokensSaved
      const tsMs = new Date(e.ts + "Z").getTime()
      if (tsMs >= dayStart) cumulativeSavings.push({ ts: e.ts, total: runningTotal })
    }
  }
  if (cumulativeSavings.length === 0) cumulativeSavings.push({ ts: new Date().toISOString(), total: 0 })

  const topQueries: TopQuery[] = Array.from(queryCounts.entries())
    .map(([query, v]) => ({ query, count: v.count, saved: v.saved }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const recentActivity: RecentActivity[] = allEvents
    .slice()
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 20)
    .map((e) => ({
      type: e.type,
      target: e.meta?.path || e.meta?.query || e.meta?.key || e.meta?.toolID || e.meta?.symbol || "—",
      tokensSaved: e.tokensSaved,
      ts: e.ts,
      project: e.project,
    }))

  const hotFiles = Array.from(hotFilesMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const eventsByType = new Map<string, { count: number; saved: number }>()
  for (const e of allEvents) {
    const cur = eventsByType.get(e.type) || { count: 0, saved: 0 }
    cur.count += 1
    cur.saved += e.tokensSaved || 0
    eventsByType.set(e.type, cur)
  }
  const globalTotals = {
    totalEvents: allEvents.length,
    totalSavedTokens: allEvents.reduce((s, e) => s + (e.tokensSaved || 0), 0),
    indexSubstitutions: eventsByType.get("index_substitute")?.count || 0,
    indexSubstitutionSaved: eventsByType.get("index_substitute")?.saved || 0,
    searchSubstitutions: (eventsByType.get("search")?.count || 0) + (eventsByType.get("search_savings")?.count || 0),
    compressedOutputs: eventsByType.get("compression")?.count || 0,
    compressionSaved: eventsByType.get("compression")?.saved || 0,
    fileReads: eventsByType.get("file_read")?.count || 0,
    turnSavings: eventsByType.get("turn_savings")?.saved || 0,
    indexHealthCount: indexHealth.length,
  }

  return { activityTimeline, cumulativeSavings, topQueries, recentActivity, indexHealth, hotFiles, globalTotals }
}
