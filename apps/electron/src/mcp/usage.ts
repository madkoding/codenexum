import { DatabaseSync } from "node:sqlite"
import { ensureProject } from "./auto-register.js"

export type EventType =
  | "search"
  | "index_substitute"
  | "semantic_compression"
  | "compression"
  | "search_savings"
  | "generative_compression"
  | "output_compression"
  | "cache_hit"
  | "file_read"
  | "analyze"
  | "turn_savings"

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    tokens_saved INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    meta TEXT,
    ts TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_usage_type ON usage_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts);
`

function ensureUsageSchema(db: DatabaseSync) {
  for (const stmt of SCHEMA.split(";").map(s => s.trim()).filter(Boolean)) {
    db.exec(stmt)
  }
}

export function logEvent(
  projectDir: string,
  type: EventType,
  opts: { tokensSaved?: number; tokensUsed?: number; meta?: Record<string, any> } = {}
): void {
  const dbPath = ensureProject(projectDir)
  const db = new DatabaseSync(dbPath)
  ensureUsageSchema(db)
  const ts = new Date().toISOString()
  db.prepare(
    "INSERT INTO usage_events (event_type, tokens_saved, tokens_used, meta, ts) VALUES (?, ?, ?, ?, ?)"
  ).run(
    type,
    opts.tokensSaved || 0,
    opts.tokensUsed || 0,
    opts.meta ? JSON.stringify(opts.meta) : null,
    ts
  )
  db.close()
}

export interface UsageSummary {
  searches: number
  searchQueries: number
  nativeSearches: number
  indexSubstitutions: number
  cacheHits: number
  filesRead: number
  snippetOnly: number
  compactions: number
  measuredSavings: number
  semanticCompressionSaved: number
  generativeCompressionSaved: number
  outputCompressionSaved: number
  efficiencyRatio: number
  indexedAt: string | null
  status: string
  missRate: number
  missesByTool: any
  recommendations: string[]
  avgTokensSavedPerSearch: number
  topMissedReads: any[]
  savingsByMechanism: {
    indexSubstitution: number
    semanticCompression: number
    compression: number
    searchSnippets: number
    generativeCompression: number
    outputCompression: number
  }
  recentEvents: { type: string; tokensSaved: number; tokensUsed: number; meta: any; ts: string }[]
}

export function getUsageSummary(projectDir: string): UsageSummary {
  const dbPath = ensureProject(projectDir)
  const db = new DatabaseSync(dbPath)
  ensureUsageSchema(db)

  const counts = db.prepare(`
    SELECT event_type, count(*) as c, COALESCE(SUM(tokens_saved), 0) as saved
    FROM usage_events
    GROUP BY event_type
  `).all() as { event_type: string; c: number; saved: number }[]

  const map: Record<string, { count: number; saved: number }> = {}
  for (const r of counts) map[r.event_type] = { count: r.c, saved: r.saved }

  const get = (t: string) => map[t] || { count: 0, saved: 0 }

  const search = get("search")
  const indexSub = get("index_substitute")
  const semComp = get("semantic_compression")
  const comp = get("compression")
  const searchSav = get("search_savings")
  const genComp = get("generative_compression")
  const outComp = get("output_compression")
  const cache = get("cache_hit")
  const fileRead = get("file_read")
  const analyze = get("analyze")
  const turnSav = get("turn_savings")

  const totalSearches = search.count
  const totalSavings =
    indexSub.saved + semComp.saved + comp.saved + searchSav.saved + genComp.saved + outComp.saved

  const totalOps = fileRead.count + search.count
  const intercepted = indexSub.count + searchSav.count
  const efficiency = totalOps > 0
    ? Math.min(1, intercepted / totalOps)
    : 0

  const recentRows = db.prepare(`
    SELECT event_type, tokens_saved, tokens_used, meta, ts
    FROM usage_events
    ORDER BY id DESC
    LIMIT 20
  `).all() as { event_type: string; tokens_saved: number; tokens_used: number; meta: string | null; ts: string }[]

  db.close()

  const recentEvents = recentRows.map(r => ({
    type: r.event_type,
    tokensSaved: r.tokens_saved,
    tokensUsed: r.tokens_used,
    meta: r.meta ? JSON.parse(r.meta) : null,
    ts: r.ts,
  }))

  return {
    searches: totalSearches,
    searchQueries: totalSearches,
    nativeSearches: Math.max(0, totalSearches - searchSav.count),
    indexSubstitutions: indexSub.count,
    cacheHits: cache.count,
    filesRead: fileRead.count,
    snippetOnly: searchSav.count,
    compactions: comp.count,
    measuredSavings: totalSavings,
    semanticCompressionSaved: semComp.saved,
    generativeCompressionSaved: genComp.saved,
    outputCompressionSaved: outComp.saved,
    efficiencyRatio: efficiency,
    indexedAt: new Date().toISOString(),
    status: totalSearches > 0 ? "active" : "indexed",
    missRate: 0,
    missesByTool: {},
    recommendations: totalSearches > 0 ? [] : ["Run searches with cm_search to track savings."],
    avgTokensSavedPerSearch: totalSearches > 0 ? Math.round(totalSavings / totalSearches) : 0,
    topMissedReads: [],
    savingsByMechanism: {
      indexSubstitution: indexSub.saved,
      semanticCompression: semComp.saved,
      compression: comp.saved,
      searchSnippets: searchSav.saved,
      generativeCompression: genComp.saved,
      outputCompression: outComp.saved,
    },
    recentEvents,
  }
}
