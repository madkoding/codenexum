import type { Database } from "bun:sqlite"
import { Database as SqliteDatabase } from "bun:sqlite"
import { dbChunkCount, dbFileCount, dbGetMeta, dbStatsByLang, dbTopFiles, dbFindLoadedFiles, dbEdgeCount, initSchema } from "./store"
import { getUsage, measuredSavings, getGlobalUsage } from "./budget"
import { getCompactionCount } from "./compact"
import { getRecentIndexEvents } from "./indexer"
import {
  listProjects, getProject, getProjectUsage, getUsageTimeline, getToolTypeDistribution,
  getMissesByTool, getTopMissedReads, getSavingsByMechanism, setOnUsageEvent, deleteProject, type ProjectInfo,
} from "./registry"
import { getFillRatio } from "./budget"
import { existsSync } from "fs"
import { join } from "path"

export const DEFAULT_DASHBOARD_PORT = parseInt(process.env.CONTEXT_MANAGER_DASHBOARD_PORT || "3567", 10)

export interface DashboardState {
  port: number
  url: string
  ready: boolean
  error?: string
}

let server: ReturnType<typeof Bun.serve> | null = null
let state: DashboardState = { port: 0, url: "", ready: false }
const projectDbs = new Map<string, Database>()

// WS subscription management
interface WsClient {
  channels: Set<string>
  projectId?: string
}
const wsClients = new Map<any, WsClient>()

function notifyChanged() {
  for (const [ws] of wsClients) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "data_changed" }))
    }
  }
}

export function getDashboardState(): DashboardState {
  return { ...state }
}

export function stopDashboard(): void {
  try { server?.stop(true) } catch {}
  server = null
  state = { port: 0, url: "", ready: false }
  wsClients.clear()
}

export function registerProjectDb(projId: string, db: Database): void {
  projectDbs.set(projId, db)
}

function ensureProjectDb(projId: string): Database | null {
  const existing = projectDbs.get(projId)
  if (existing) return existing
  const proj = getProject(projId)
  if (!proj) return null
  if (!existsSync(proj.dbPath)) return null
  try {
    const db = new SqliteDatabase(proj.dbPath)
    initSchema(db)
    projectDbs.set(projId, db)
    return db
  } catch (e) {
    console.error("[context-manager dashboard] failed to open project DB:", proj.dbPath, e)
    return null
  }
}

export async function startDashboard(_db?: Database, _sessionID?: string, _projId?: string): Promise<DashboardState> {
  if (server) return state

  setOnUsageEvent(notifyChanged)

  try {
    server = Bun.serve({
      port: DEFAULT_DASHBOARD_PORT,
      hostname: "127.0.0.1",
      fetch(req, srv) { return handleRequest(req, srv) },
      websocket: {
        open(ws) { wsClients.set(ws, { channels: new Set() }) },
        message(ws, msg) { handleWsMessage(ws, msg) },
        close(ws) { wsClients.delete(ws) },
      },
    })
    const port = server.port || 0
    state = { port, url: `http://127.0.0.1:${port}`, ready: true }
    return state
  } catch {
    try {
      server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, srv) { return handleRequest(req, srv) },
        websocket: {
          open(ws) { wsClients.set(ws, { channels: new Set() }) },
          message(ws, msg) { handleWsMessage(ws, msg) },
          close(ws) { wsClients.delete(ws) },
        },
      })
      const port = server.port || 0
      state = { port, url: `http://127.0.0.1:${port}`, ready: true }
      return state
    } catch (e) {
      state = { port: DEFAULT_DASHBOARD_PORT, url: "", ready: false, error: String(e) }
      return state
    }
  }
}

// ── HTTP routing (kept for compat / Vite proxy) ──

function handleRequest(req: Request, srv: any): Response {
  try {
    const url = new URL(req.url)
    if (!isLocalhost(url.hostname)) return new Response("Forbidden: localhost only", { status: 403 })

  // WebSocket upgrade
  if (url.pathname === "/api/ws") {
      srv.upgrade(req)
      return new Response(null, { status: 101 })
    }

    const path = url.pathname
    if (path === "/api/health") return json({ ok: true })
    if (path === "/api/projects") return json(projectsApi())
    if (path === "/api/aggregate") return json(aggregateApi())

    const projDeleteMatch = path.match(/^\/api\/project\/([a-f0-9]+)$/)
    if (projDeleteMatch && req.method === "DELETE") {
      const projId = projDeleteMatch[1]
      const existing = projectDbs.get(projId)
      if (existing) { try { existing.close() } catch {}; projectDbs.delete(projId) }
      if (!deleteProject(projId)) return json({ error: "project not found" }, 404)
      notifyChanged()
      return json({ ok: true })
    }

    const projMatch = path.match(/^\/api\/project\/([a-f0-9]+)\/stats$/)
    if (projMatch) {
      const db = ensureProjectDb(projMatch[1])
      if (!db) return json({ error: "project not found" }, 404)
      return json(statsApi(db, projMatch[1]))
    }

    // Static file serving for dashboard SPA
    const distDir = join(import.meta.dir, "..", "dashboard", "dist")
    if (existsSync(distDir)) {
      const filePath = join(distDir, path === "/" ? "index.html" : path.slice(1))
      if (existsSync(filePath)) {
        const ext = filePath.split(".").pop() || ""
        const mime: Record<string, string> = {
          html: "text/html", js: "application/javascript", css: "text/css",
          json: "application/json", png: "image/png", jpg: "image/jpeg",
          svg: "image/svg+xml", ico: "image/x-icon", map: "application/json",
        }
        const body = Bun.file(filePath)
        return new Response(body, { headers: { "Content-Type": mime[ext] || "application/octet-stream" } })
      }
      // SPA fallback: serve index.html for unknown routes
      const indexFile = join(distDir, "index.html")
      if (existsSync(indexFile)) {
        const body = Bun.file(indexFile)
        return new Response(body, { headers: { "Content-Type": "text/html" } })
      }
    } else {
      console.warn("[context-manager dashboard] dashboard/dist/ not found — run 'bun run dashboard:build'")
    }

    return new Response("Not found", { status: 404 })
  } catch (e) {
    console.error("[context-manager dashboard] request failed:", req.url, e)
    return json({ error: "Internal server error", detail: String(e) }, 500)
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]"
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

// ── WebSocket message handling ──

function handleWsMessage(ws: any, msg: any) {
  try {
    const data = JSON.parse(msg.toString())
    const client = wsClients.get(ws)
    if (!client) return

    if (data.type === "subscribe") {
      client.channels.add(data.channel)
      if (data.projectId) client.projectId = data.projectId
      // Send initial data_changed so client does first fetch
      ws.send(JSON.stringify({ type: "data_changed" }))
    } else if (data.type === "unsubscribe") {
      client.channels.delete(data.channel)
    }
  } catch (e) {
    console.error("[context-manager dashboard] WebSocket message error:", e)
  }
}

// ── API builders (same data, no HTML) ──

function projectsApi() {
  const projects = listProjects()
  return projects.map(p => {
    const db = ensureProjectDb(p.id)
    const chunks = db ? dbChunkCount(db) : 0
    const usage = getProjectUsage(p.id)
    const sessionUsage = {
      compressionSaved: usage.compressionSaved,
      semanticCompressionSaved: usage.semanticCompressionSaved,
      searchSaved: usage.searchSaved,
      indexSavedTokens: usage.indexSavedTokens,
      generativeCompressionSaved: usage.generativeCompressionSaved,
      outputCompressionSaved: usage.outputCompressionSaved,
      searchQueries: usage.searchQueries,
      snippetsUsed: usage.snippetsUsed,
      filesRead: usage.filesRead,
      toolsIntercepted: usage.toolsIntercepted,
    }
    const efficiencyDenominator = usage.searchQueries + usage.filesRead + usage.toolsIntercepted + usage.cacheHits
    const efficiency = efficiencyDenominator > 0 ? (usage.indexSubstitutions + usage.cacheHits + usage.toolsIntercepted) / efficiencyDenominator : 0
    return {
      id: p.id, name: p.name, path: p.path, chunks,
      lastSeen: p.lastSeen, createdAt: p.createdAt,
      searches: usage.searchQueries, filesRead: usage.filesRead,
      toolsIntercepted: usage.toolsIntercepted, compressionSaved: usage.compressionSaved,
      efficiency,
      measuredSavings: measuredSavings(sessionUsage as any),
    }
  })
}

function aggregateApi() {
  const global = getGlobalUsage()
  const timeline = getUsageTimeline(24)
  const toolDist = getToolTypeDistribution()
  const projects = listProjects()
  const perProject = projects.map(p => {
    const usage = getProjectUsage(p.id)
    const sessionUsage = {
      compressionSaved: usage.compressionSaved,
      semanticCompressionSaved: usage.semanticCompressionSaved,
      searchSaved: usage.searchSaved,
      searchQueries: usage.searchQueries,
      snippetsUsed: usage.snippetsUsed,
      filesRead: usage.filesRead,
      toolsIntercepted: usage.toolsIntercepted,
      indexSubstitutions: usage.indexSubstitutions,
      indexMissed: usage.indexMissed,
      indexSavedTokens: usage.indexSavedTokens,
      cacheHits: usage.cacheHits,
      generativeCompressionSaved: usage.generativeCompressionSaved,
      outputCompressionSaved: usage.outputCompressionSaved,
    }
    const savingsByMechanism = getSavingsByMechanism(p.id)
    const efficiencyDenominator = usage.searchQueries + usage.nativeSearches + usage.filesRead + usage.indexSubstitutions + usage.cacheHits
    const efficiency = efficiencyDenominator > 0 ? (usage.indexSubstitutions + usage.cacheHits + usage.toolsIntercepted) / efficiencyDenominator : 0
    return {
      id: p.id,
      name: p.name,
      searches: usage.searchQueries,
      reads: usage.filesRead,
      indexSubstitutions: usage.indexSubstitutions,
      indexSavedTokens: usage.indexSavedTokens,
      semanticSaved: usage.semanticCompressionSaved,
      cacheHits: usage.cacheHits,
      generativeSaved: usage.generativeCompressionSaved,
      outputCompressionSaved: usage.outputCompressionSaved,
      efficiency,
      measuredSavings: measuredSavings(sessionUsage as any),
      savingsByMechanism,
    }
  })
  const globalSavingsByMechanism = {
    indexSubstitution: perProject.reduce((s, p) => s + p.savingsByMechanism.indexSubstitution, 0),
    semanticCompression: perProject.reduce((s, p) => s + p.savingsByMechanism.semanticCompression, 0),
    compression: perProject.reduce((s, p) => s + p.savingsByMechanism.compression, 0),
    searchSnippets: perProject.reduce((s, p) => s + p.savingsByMechanism.searchSnippets, 0),
    generativeCompression: perProject.reduce((s, p) => s + p.savingsByMechanism.generativeCompression, 0),
    outputCompression: perProject.reduce((s, p) => s + p.savingsByMechanism.outputCompression, 0),
  }
  const globalEfficiencyDenominator = global.totalSearches + global.totalReads + global.totalIntercepts + global.totalCacheHits
  const globalEfficiency = globalEfficiencyDenominator > 0 ? (global.totalIntercepts + global.totalCacheHits) / globalEfficiencyDenominator : 0
  return {
    ...global,
    timeline,
    toolDistribution: toolDist,
    perProject,
    savingsByMechanismGlobal: globalSavingsByMechanism,
    globalEfficiency,
  }
}

function statsApi(db: Database, projId: string) {
  const usage = getProjectUsage(projId)
  const sessionUsage = {
    compressionSaved: usage.compressionSaved,
    semanticCompressionSaved: usage.semanticCompressionSaved,
    searchSaved: usage.searchSaved,
    searchQueries: usage.searchQueries,
    snippetsUsed: usage.snippetsUsed,
    filesRead: usage.filesRead,
    toolsIntercepted: usage.toolsIntercepted,
    indexSubstitutions: usage.indexSubstitutions,
    indexMissed: usage.indexMissed,
    indexSavedTokens: usage.indexSavedTokens,
    cacheHits: usage.cacheHits,
    generativeCompressionSaved: usage.generativeCompressionSaved,
    outputCompressionSaved: usage.outputCompressionSaved,
  }
  const savingsByMechanism = getSavingsByMechanism(projId)
  const measured = measuredSavings(sessionUsage as any)
  const efficiencyDenominator = usage.searchQueries + usage.nativeSearches + usage.filesRead + usage.indexSubstitutions + usage.cacheHits
  const efficiency = efficiencyDenominator > 0 ? (usage.indexSubstitutions + usage.cacheHits + usage.toolsIntercepted) / efficiencyDenominator : 0
  const missRate = (usage.filesRead + usage.nativeSearches) > 0 ? usage.indexMissed / (usage.filesRead + usage.nativeSearches + usage.indexSubstitutions + usage.indexMissed) : 0
  const avgSavedPerSearch = usage.searchQueries > 0 ? measured / usage.searchQueries : 0
  const recommendations: string[] = []
  if (missRate > 0.25) recommendations.push("High miss rate: many native tools were not substituted. Check if files are indexed or enable CONTEXT_MANAGER_INTERCEPT_MODE=substitute.")
  if (usage.indexMissed > 0 && getTopMissedReads(projId, 1).length > 0) {
    const top = getTopMissedReads(projId, 1)[0]
    recommendations.push(`Top missed read: ${top.file} was read natively ${top.misses} time(s). Potential savings: ~${top.potentialTokens.toLocaleString()} tokens.`)
  }
  if (getFillRatio(undefined) > 0.8) recommendations.push("Context fill is high; old tool outputs are being compacted. Consider narrowing queries.")
  if (usage.nativeSearches > usage.searchQueries) recommendations.push(`The AI still uses native searches more than context_search (${usage.nativeSearches} vs ${usage.searchQueries}). Add a rule to the system prompt emphasizing that context_search replaces grep/rg/find/read, it's faster and uses fewer tokens. Every native search costs ~${((usage.indexMissed || 0) > 0 ? Math.round(usage.indexSavedTokens / Math.max(usage.indexSubstitutions, 1)) : 50).toLocaleString()} extra tokens.`)

  return {
    status: dbChunkCount(db) > 0 ? "ready" : "empty",
    chunks: dbChunkCount(db),
    files: dbFileCount(db),
    edges: dbEdgeCount(db),
    languages: dbStatsByLang(db),
    projectRoot: dbGetMeta(db, "projectRoot") || "",
    indexedAt: dbGetMeta(db, "indexedAt") || null,
    searches: usage.searchQueries,
    nativeSearches: usage.nativeSearches,
    snippetOnly: usage.snippetsUsed,
    filesRead: usage.filesRead,
    compactions: getCompactionCount() + usage.compactions,
    toolsIntercepted: usage.toolsIntercepted,
    compressionSaved: usage.compressionSaved,
    semanticCompressionSaved: usage.semanticCompressionSaved,
    searchSaved: usage.searchSaved,
    indexSubstitutions: usage.indexSubstitutions,
    indexMissed: usage.indexMissed,
    indexSavedTokens: usage.indexSavedTokens,
    cacheHits: usage.cacheHits,
    generativeCompressionSaved: usage.generativeCompressionSaved,
    outputCompressionSaved: usage.outputCompressionSaved,
    measuredSavings: measured,
    efficiencyRatio: efficiency,
    missRate,
    avgTokensSavedPerSearch: avgSavedPerSearch,
    contextFill: getFillRatio(undefined),
    savingsByMechanism,
    missesByTool: getMissesByTool(projId),
    topMissedReads: getTopMissedReads(projId, 10),
    recommendations,
    hotFiles: dbFindLoadedFiles(db, 10),
    topFiles: dbTopFiles(db, 10),
    recentSearches: usage.recentSearches,
    recentEvents: getRecentIndexEvents(),
  }
}