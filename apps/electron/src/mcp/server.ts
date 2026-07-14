import { createServer, IncomingMessage, ServerResponse } from "http"
import { getProjectStats, getProjectAggregate, getCompressionStatus, getDashboardState, getGlobalAnalytics } from "./stats.js"
import { ensureProject, updateProjectStats } from "./auto-register.js"
import { getRegistryPath, getProjectDbPath } from "./db-paths.js"
import { existsSync, rmSync } from "fs"
import { DatabaseSync } from "node:sqlite"
import { getDb, dropDb } from "./db-pool.js"
import { indexProject, startWatching, stopWatching } from "./indexer.js"
import { autoDiscoverAndIndex } from "./auto-discover.js"
import { initSchema, dbSetSchemaVersion, SCHEMA_VERSION, dbInsertChunks, dbInsertEdges, dbSetFileHash, dbSetMeta, dbSearch, dbFindRelated, dbFindImpacted, dbGetMeta, dbGetChunksForFile } from "@codenexum/sql"
import { parseSymbolRef, charsToTokens, formatSearchResults } from "@codenexum/core"
import { logEvent } from "./usage.js"
import { rawCacheGet, rawCacheSet } from "./cache.js"
import { compressToolOutput, compressToolOutputSemantic, isCompressible } from "./compress.js"
import { getSettings, updateSettings } from "./settings.js"

const PORT = parseInt(process.env.CODENEXUM_MCP_PORT || "7770", 10)
const MCP_PROTOCOL_VERSION = "2024-11-05"
const SERVER_INFO = { name: "codenexum", version: "0.99.0" }

const TOOLS = [
  { name: "cm_projects_list", description: "List all registered projects", inputSchema: { type: "object", properties: {} } },
  { name: "cm_projects_get", description: "Get a project by id", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "cm_projects_delete", description: "Delete a project", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "cm_projects_update", description: "Update a project's name", inputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] } },
  { name: "cm_settings_get", description: "Get current feature settings", inputSchema: { type: "object", properties: {} } },
  { name: "cm_settings_set", description: "Update feature settings", inputSchema: { type: "object", properties: { settings: { type: "object" } }, required: ["settings"] } },
  { name: "cm_stats", description: "Show index statistics for a project", inputSchema: { type: "object", properties: { path: { type: "string" }, projectDir: { type: "string" } } } },
  { name: "cm_aggregate", description: "Aggregate stats by type/language", inputSchema: { type: "object", properties: { path: { type: "string" }, projectDir: { type: "string" } } } },
  { name: "cm_compression", description: "Show compression status", inputSchema: { type: "object", properties: {} } },
  { name: "cm_dashboard", description: "Get dashboard state", inputSchema: { type: "object", properties: {} } },
  { name: "cm_analytics", description: "Get global analytics: activity timeline, top queries, recent activity, index health, hot files", inputSchema: { type: "object", properties: {} } },
  { name: "cm_analyze", description: "Index/analyze a project path", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "cm_search", description: "Search indexed code by keyword. Requires path to the project directory.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Project directory path" }, projectDir: { type: "string", description: "Alias for path" }, query: { type: "string" }, n: { type: "number" } }, required: ["path"] } },
  { name: "cm_related", description: "Find related symbols for a file:symbol reference. Requires path to the project directory.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Project directory path" }, projectDir: { type: "string", description: "Alias for path" }, symbol: { type: "string", description: "Symbol reference like file.ts:name" }, n: { type: "number" } }, required: ["path", "symbol"] } },
  { name: "cm_impact", description: "Find files that depend on the given files. Requires path to the project directory.", inputSchema: { type: "object", properties: { path: { type: "string", description: "Project directory path" }, projectDir: { type: "string", description: "Alias for path" }, files: { type: "array", items: { type: "string" } } }, required: ["path", "files"] } },
  { name: "cm_log_event", description: "Log a usage event", inputSchema: { type: "object", properties: { projectDir: { type: "string" }, eventType: { type: "string" }, tokensSaved: { type: "number" }, tokensUsed: { type: "number" }, meta: { type: "object" } }, required: ["projectDir", "eventType"] } },
  { name: "cm_read_snippet", description: "Get indexed snippet for a file instead of full read", inputSchema: { type: "object", properties: { path: { type: "string" }, filePath: { type: "string" }, offset: { type: "number" }, limit: { type: "number" }, maxBodyLines: { type: "number", description: "Max lines per chunk body (default 15)" } }, required: ["path"] } },
  { name: "cm_search_snippet", description: "Search and return compact snippet for direct injection (replaces grep)", inputSchema: { type: "object", properties: { path: { type: "string" }, query: { type: "string" }, fileFilter: { type: "string" } }, required: ["path", "query"] } },
  { name: "cm_cache_get", description: "Get a cached tool output", inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  { name: "cm_cache_put", description: "Cache a tool output", inputSchema: { type: "object", properties: { key: { type: "string" }, output: { type: "string" }, fileHash: { type: "string" } }, required: ["key", "output"] } },
  { name: "cm_compress_output", description: "Compress a tool output for the LLM. Tries semantic compression first (e.g. test summaries), falls back to line-truncation. Set semantic:false to skip semantic.", inputSchema: { type: "object", properties: { toolID: { type: "string" }, output: { type: "string" }, semantic: { type: "boolean", description: "If true (default), tries semantic compression first." } }, required: ["toolID", "output"] } },
]

type SseClient = { id: string; res: ServerResponse }
const sseClients = new Map<string, SseClient>()

function json(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

const CACHE_TTL_MS = 5000
const _cache = new Map<string, { ts: number; data: any }>()

function cacheGet<T>(key: string): T | undefined {
  const e = _cache.get(key)
  if (!e) return undefined
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    _cache.delete(key)
    return undefined
  }
  return e.data as T
}

function cacheSet(key: string, data: any): void {
  _cache.set(key, { ts: Date.now(), data })
}

function cacheInvalidate(prefix?: string): void {
  if (!prefix) { _cache.clear(); return }
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k)
  }
}

function error(res: ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status)
}

const MAX_BODY_BYTES = 8 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        req.destroy()
        reject(Object.assign(new Error("body too large"), { statusCode: 413 }))
      }
    })
    req.on("end", () => {
      try { resolve(JSON.parse(body)) } catch { reject(new Error("invalid JSON")) }
    })
    req.on("error", reject)
  })
}

function getProjects() {
  const cached = cacheGet<any[]>("projects")
  if (cached) return cached
  const regPath = getRegistryPath()
  if (!existsSync(regPath)) return []
  const db = new DatabaseSync(regPath)
  const rows = db.prepare("SELECT id, path, name, dbPath, lastSeen, chunks, files FROM projects ORDER BY lastSeen DESC").all() as any[]
  const active: any[] = []
  const dead: string[] = []
  for (const p of rows) {
    if (p.path === "/tmp" || p.path.startsWith("/tmp/") || !existsSync(p.path)) {
      dead.push(p.id)
      continue
    }
    const chunks = p.chunks || 0
    const files = p.files || 0
    active.push({ id: p.id, path: p.path, name: p.name, dbPath: p.dbPath, lastSeen: p.lastSeen, chunks, files })
  }
  if (dead.length) {
    for (const id of dead) {
      db.prepare("DELETE FROM projects WHERE id = ?").run(id)
    }
    console.log(`[codenexum] Cleaned ${dead.length} stale/tmp project(s): ${dead.join(", ")}`)
  }
  db.close()
  cacheSet("projects", active)
  return active
}

function getProjectDb(projectDir?: string): string | null {
  if (!projectDir) return null
  return ensureProject(projectDir)
}

function resolvePath(args: any): string | null {
  const p = args?.path || args?.projectDir
  return p && typeof p === "string" && p.length > 0 ? p : null
}

type RelatedItem =
  | { kind: string; file: string; symbol: string; direction: "out" | "in" }
  | { file: string; dependent: string; kind: string; symbol: string }

function compressRelatedImpacted(items: RelatedItem[], kind: "related" | "impact"): string {
  if (items.length === 0) return ""

  const byFile = new Map<string, { kind: string; symbol: string; dir?: string }[]>()
  for (const r of items) {
    const file = kind === "related" ? r.file : (r as any).dependent
    const sym = r.symbol
    const k = r.kind
    const list = byFile.get(file) || []
    const seen = list.some(x => x.symbol === sym && x.kind === k)
    if (!seen) list.push({ kind: k, symbol: sym, dir: kind === "related" ? (r as any).direction : undefined })
    byFile.set(file, list)
  }

  const lines: string[] = []
  for (const [file, entries] of byFile) {
    const unique = entries.map(e => e.dir ? `${e.kind}->${e.symbol} (${e.dir})` : `${e.kind}->${e.symbol}`).join(", ")
    lines.push(`${file}: ${unique}`)
  }

  if (lines.length > 50) {
    const omitted = lines.length - 50
    return lines.slice(0, 50).join("\n") + `\n[... ${omitted} more files with refs]`
  }
  return lines.join("\n")
}

async function handleToolCall(req: IncomingMessage, res: ServerResponse) {
  let body: any
  try { body = await readBody(req) } catch (e: any) { return error(res, e.message || "invalid JSON body", e.statusCode || 400) }
  const { tool, args } = body
  if (!tool) return error(res, "missing tool name")
  try {
    const out = await executeToolCall(tool, args)
    if (out.error) return error(res, out.error, out.status ?? 400)
    return json(res, { result: out.result })
  } catch (e: any) {
    return error(res, e.message || "internal error", 500)
  }
}

async function executeToolCall(tool: string, args: any): Promise<Record<string, any>> {
  try {
    switch (tool) {
      case "cm_projects_list":
        return { result: getProjects() }

      case "cm_projects_get": {
        const projects = getProjects()
        const p = projects.find((p: any) => p.id === args?.id)
        if (!p) return { error: "project not found" }
        return { result: p }
      }

      case "cm_projects_delete": {
        const regPath = getRegistryPath()
        if (existsSync(regPath)) {
          const reg = new DatabaseSync(regPath)
          const proj = reg.prepare("SELECT path, dbPath FROM projects WHERE id = ?").get(args?.id) as any
          reg.prepare("DELETE FROM projects WHERE id = ?").run(args?.id)
          try { reg.prepare("DELETE FROM usage_events WHERE project_id = ?").run(args?.id) } catch {}
          reg.close()
          if (proj?.path) stopWatching(proj.path)
          if (proj?.dbPath && existsSync(proj.dbPath)) {
            dropDb(proj.dbPath)
            try { rmSync(proj.dbPath) } catch {}
          }
        }
        cacheInvalidate()
        return { result: { ok: true } }
      }

      case "cm_projects_update": {
        const id = args?.id
        const name = (args?.name || "").trim()
        if (!id || !name) return { error: "id and name are required" }
        const regPath = getRegistryPath()
        if (!existsSync(regPath)) return { error: "registry not found" }
        const reg = new DatabaseSync(regPath)
        const r = reg.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id)
        reg.close()
        if (r.changes === 0) return { error: "project not found" }
        cacheInvalidate()
        return { result: { ok: true, project: { id, name } } }
      }

      case "cm_settings_get": {
        return { result: getSettings() }
      }

      case "cm_settings_set": {
        const patch = args?.settings
        if (!patch || typeof patch !== "object") return { error: "settings object required" }
        const next = updateSettings(patch)
        sseBroadcast("settings", next)
        return { result: next }
      }

      case "cm_stats": {
        const projectDir = resolvePath(args)
        if (!projectDir) {
          const projects = getProjects()
          if (projects.length === 0) return { result: { chunks: 0, files: 0, edges: 0, lastIndexed: null } }
          return { result: getProjectStats(projects[0].path) }
        }
        return { result: getProjectStats(projectDir) }
      }

      case "cm_aggregate": {
        const projectDir = resolvePath(args)
        const cacheKey = `aggregate:${projectDir || "default"}`
        const cached = cacheGet<any>(cacheKey)
        if (cached) return { result: cached }
        let result: any
        if (!projectDir) {
          const projects = getProjects()
          if (projects.length === 0) result = { byType: {}, byLang: {}, topFiles: [] }
          else result = getProjectAggregate(projects[0].path)
        } else {
          result = getProjectAggregate(projectDir)
        }
        cacheSet(cacheKey, result)
        return { result }
      }

      case "cm_compression": {
        const cached = cacheGet<any>("compression")
        if (cached) return { result: cached }
        const result = getCompressionStatus()
        cacheSet("compression", result)
        return { result }
      }

      case "cm_dashboard": {
        const cached = cacheGet<any>("dashboard")
        if (cached) return { result: cached }
        const result = getDashboardState()
        cacheSet("dashboard", result)
        return { result }
      }

      case "cm_analytics": {
        const cached = cacheGet<any>("analytics")
        if (cached) return { result: cached }
        const result = getGlobalAnalytics()
        cacheSet("analytics", result)
        return { result }
      }

      case "cm_analyze": {
        const path = resolvePath(args)
        if (!path) return { error: "missing path" }
        const dbPath = ensureProject(path)
        const db = getDb(dbPath)
        initSchema(db)
        const start = Date.now()
        let files = 0, chunks: any[] = [], fileHashes: Record<string, string> = {}, edges: any[] = [], capped = false
        try {
          const r = indexProject(path)
          files = r.files; chunks = r.chunks; fileHashes = r.fileHashes; edges = r.edges; capped = r.capped
        } catch (e: any) {
          return { error: `indexer failed: ${e.message}` }
        }
        for (const fp of Object.keys(fileHashes)) dbSetFileHash(db, fp, fileHashes[fp])
        if (chunks.length) dbInsertChunks(db, chunks)
        if (edges.length) dbInsertEdges(db, edges)
        dbSetMeta(db, "lastIndexed", new Date().toISOString())
        dbSetMeta(db, "projectRoot", path)
        dbSetSchemaVersion(db, SCHEMA_VERSION)
        const totalChunks = (db.prepare("SELECT count(*) as c FROM chunks_fts").get() as any).c
        const totalFiles = (db.prepare("SELECT count(*) as c FROM file_hashes").get() as any).c
        updateProjectStats(path, totalChunks, totalFiles)
        startWatching(path, db)
        cacheInvalidate()
        return { result: { ok: true, path, chunks: totalChunks, files: totalFiles, addedChunks: chunks.length, addedFiles: Object.keys(fileHashes).length, elapsedMs: Date.now() - start, capped } }
      }

      case "cm_search": {
        const projectDir = resolvePath(args)
        if (!projectDir) return { error: "missing path" }
        const dbPath = ensureProject(projectDir)
        const db = getDb(dbPath)
        const results = dbSearch(db, args?.query || "", args?.n || 10)
        logEvent(projectDir, "search", { meta: { query: args?.query, hits: results.length } })
        return { result: results }
      }
      case "cm_related": {
        const projectDir = resolvePath(args)
        if (!projectDir) return { error: "missing path" }
        const symbol = args?.symbol
        if (!symbol) return { error: "missing symbol" }
        const dbPath = ensureProject(projectDir)
        const db = getDb(dbPath)
        const projectRoot = dbGetMeta(db, "projectRoot") || projectDir
        const parsed = parseSymbolRef(symbol, projectRoot)
        if (!parsed) return { error: `Could not parse symbol reference: ${symbol}. Use format: file.ts:symbolName` }
        const related = dbFindRelated(db, parsed.file, parsed.name)
        const compressed = compressRelatedImpacted(related, "related")
        return { result: compressed }
      }
      case "cm_impact": {
        const projectDir = resolvePath(args)
        if (!projectDir) return { error: "missing path" }
        const files = args?.files || []
        if (!files.length) return { error: "missing files" }
        const dbPath = ensureProject(projectDir)
        const db = getDb(dbPath)
        const projectRoot = dbGetMeta(db, "projectRoot") || projectDir
        const absFiles = files.map((f: string) => f.startsWith("/") ? f : `${projectRoot}/${f}`)
        const impacted = dbFindImpacted(db, absFiles)
        const compressed = compressRelatedImpacted(impacted, "impact")
        return { result: compressed }
      }

      case "cm_log_event": {
        const projectDir = resolvePath(args)
        if (!projectDir) return { error: "missing projectDir" }
        logEvent(projectDir, args?.eventType || "search", { tokensSaved: args?.tokensSaved || 0, tokensUsed: args?.tokensUsed || 0, meta: args?.meta })
        sseBroadcast("usage", { type: args?.eventType, projectDir, tokensSaved: args?.tokensSaved || 0 })
        cacheInvalidate("analytics")
        cacheInvalidate("dashboard")
        return { result: true }
      }
      case "cm_read_snippet": {
        const projectDir = resolvePath(args)
        if (!projectDir) return { error: "missing path" }
        const filePath = args?.filePath || args?.path || ""
        if (!filePath) return { error: "missing filePath" }
        const dbPath = ensureProject(projectDir)
        const db = getDb(dbPath)
        try { initSchema(db) } catch {}
        const projectRoot = (() => { try { return dbGetMeta(db, "projectRoot") } catch { return null } })() || projectDir
        const absPath = filePath.startsWith("/") ? filePath : `${projectRoot}/${filePath}`
        let chunks: any[]
        try { chunks = dbGetChunksForFile(db, absPath) } catch { chunks = [] }
        if (chunks.length === 0) return { result: null, reason: "not indexed" }
        const offset = args?.offset || 0, limit = args?.limit || 0
        let filtered = chunks
        if (offset || limit) {
          const start = Math.max(1, offset || 1)
          const end = limit ? start + limit - 1 : Number.MAX_SAFE_INTEGER
          filtered = chunks.filter(c => c.lineEnd >= start && c.line <= end)
        }
        const output: string[] = []
        const showAll = filtered.length <= 5
        const toShow = showAll ? filtered : filtered.slice(0, 5)
        const settings = getSettings()
        const capEnabled = settings.capBodyLines
        const maxBodyLines = args?.maxBodyLines || 15
        for (const c of toShow) {
          const relPath = absPath.startsWith(projectRoot) ? absPath.slice(projectRoot.length + 1) : absPath
          const range = c.lineEnd > c.line ? `${c.line}-${c.lineEnd}` : `${c.line}`
          output.push(`${c.type} ${c.name} @ ${relPath}:${range}`)
          if (c.body && capEnabled) {
            const bodyLines = c.body.split("\n")
            if (bodyLines.length > maxBodyLines) {
              const kept = bodyLines.slice(0, maxBodyLines)
              const omitted = bodyLines.length - maxBodyLines
              output.push(kept.join("\n") + `\n[... ${omitted} more lines]`)
            } else {
              output.push(c.body)
            }
          }
        }
        if (!showAll) output.push(`[${filtered.length - 5} more chunks omitted. Use offset/limit to see more.]`)
        return { result: output.join("\n") }
      }
      case "cm_search_snippet": {
        const projectDir = resolvePath(args)
        if (!projectDir) return { error: "missing path" }
        const query = args?.query
        if (!query) return { error: "missing query" }
        const dbPath = ensureProject(projectDir)
        const db = getDb(dbPath)
        try { initSchema(db) } catch {}
        const projectRoot = (() => { try { return dbGetMeta(db, "projectRoot") } catch { return null } })() || projectDir
        let results: any[]
        try { results = dbSearch(db, query, 10) } catch { results = [] }
        if (args?.fileFilter) results = results.filter(r => r.file.startsWith(args.fileFilter))
        if (results.length === 0) return { result: null }
        const formatted = formatSearchResults(results, projectRoot, { compact: true, snippetLines: 8 })
        const output = [`// index search: "${query}"`, formatted].join("\n")
        logEvent(projectDir, "search_savings", { tokensSaved: Math.max(0, charsToTokens(query.length * 10)) })
        return { result: output }
      }
      case "cm_cache_get": {
        const entry = rawCacheGet(args?.key || "")
        if (entry) {
          const pDir = resolvePath(args)
          if (pDir) logEvent(pDir, "cache_hit", { tokensSaved: Math.max(0, charsToTokens(entry.output.length)), meta: { key: args?.key } })
        }
        return { result: entry || null }
      }
      case "cm_cache_put": {
        rawCacheSet(args?.key || "", args?.output || "", args?.fileHash)
        return { result: true }
      }
      case "cm_compress_output": {
        const toolID = args?.toolID || ""
        const output = args?.output || ""
        if (!isCompressible(toolID)) return { result: output }
        const settings = getSettings()
        const useSemantic = args?.semantic !== false && settings.semanticCompression
        const compressOpts = {
          ansi: settings.ansiStrip,
          dedupe: settings.dedupeRuns,
          stack: settings.stackTrim,
        }
        const result = useSemantic
          ? compressToolOutputSemantic(toolID, output, compressOpts)
          : compressToolOutput(toolID, output, compressOpts)
        const pDir = resolvePath(args)
        if (pDir && result.tokensSaved > 0) {
          logEvent(pDir, "compression", { tokensSaved: result.tokensSaved, meta: { toolID, method: result.method, semantic: useSemantic } })
        }
        return { result: result.output, tokensSaved: result.tokensSaved }
      }

      default:
        return { error: `unknown tool: ${tool}` }
    }
  } catch (e: any) {
    return { error: e.message || "internal error" }
  }
}

function sseWrite(res: ServerResponse, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function sseBroadcast(event: string, data: any) {
  for (const client of sseClients.values()) {
    try { sseWrite(client.res, event, data) } catch {}
  }
}

async function handleJsonRpc(req: IncomingMessage, res: ServerResponse, url: URL) {
  let body: any
  try { body = await readBody(req) } catch { return { error: "invalid JSON body" } }
  const { id, method, params } = body
  const reply = (result: any) => {
    const msg = { jsonrpc: "2.0", id, result }
    if (url.searchParams.get("sse") === "1" && sseClients.size > 0) {
      const last = Array.from(sseClients.values()).pop()!
      sseWrite(last.res, "message", msg)
      res.writeHead(202, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ accepted: true }))
    } else {
      json(res, msg)
    }
  }
  const fail = (code: number, message: string) => {
    const msg = { jsonrpc: "2.0", id, error: { code, message } }
    if (url.searchParams.get("sse") === "1" && sseClients.size > 0) {
      const last = Array.from(sseClients.values()).pop()!
      sseWrite(last.res, "message", msg)
      res.writeHead(202, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ accepted: true }))
    } else {
      json(res, msg, 200)
    }
  }

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      })
    case "notifications/initialized":
      return json(res, { ok: true })
    case "ping":
      return reply({})
    case "tools/list":
      return reply({ tools: TOOLS })
    case "tools/call": {
      const toolName = params?.name
      const args = params?.arguments || {}
      if (!toolName) return fail(-32602, "missing tool name")
      const out = await executeToolCall(toolName, args)
      if (out.error) return fail(-32000, out.error)
      return reply({ content: [{ type: "text", text: typeof out.result === "string" ? out.result : JSON.stringify(out.result) }] })
    }
    default:
      return fail(-32601, `method not found: ${method}`)
  }
}

function handleSse(req: IncomingMessage, res: ServerResponse, url: URL) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "null",
  })
  res.write("\n")
  const clientId = Math.random().toString(36).slice(2)
  const msgPath = `/messages?sessionId=${clientId}`
  sseWrite(res, "endpoint", { url: msgPath })
  sseClients.set(clientId, { id: clientId, res })
  req.on("close", () => { sseClients.delete(clientId) })
  const ka = setInterval(() => { try { res.write(": keepalive\n\n") } catch { clearInterval(ka) } }, 15000)
  req.on("close", () => clearInterval(ka))
}

export function startMcpServer(port?: number) {
  const p = port || PORT
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "null")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (req.method === "OPTIONS") return res.writeHead(204).end()

    const url = new URL(req.url || "/", `http://127.0.0.1:${p}`)

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, { status: "ok", port: p })
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return json(res, getSettings())
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "null",
      })
      const clientId = `dashboard-${Date.now()}`
      const client: SseClient = { id: clientId, res }
      sseClients.set(clientId, client)
      res.on("close", () => sseClients.delete(clientId))
      sseWrite(res, "connected", { status: "ok" })
      return
    }
    if (req.method === "GET" && url.pathname === "/sse") {
      return handleSse(req, res, url)
    }
    if (req.method === "GET" && url.pathname === "/") {
      return handleSse(req, res, url)
    }
    if (req.method === "POST" && url.pathname === "/tools/call") {
      return handleToolCall(req, res)
    }
    if (req.method === "POST" && (url.pathname === "/messages" || url.pathname === "/mcp")) {
      return handleJsonRpc(req, res, url)
    }
    if (req.method === "POST") {
      return handleJsonRpc(req, res, url)
    }
    return error(res, "not found", 404)
  })
  return new Promise<{ close: () => void; port: number }>((resolve) => {
    server.on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[codenexum MCP] Port ${p} in use, trying ${p + 1}...`)
        server.listen(p + 1, "127.0.0.1", () => {
          const ap = (server.address() as any)?.port || p + 1
          console.log(`[codenexum MCP] Server listening on http://127.0.0.1:${ap}`)
          resolve({ close: () => server.close(), port: ap })
          autoDiscoverAndIndex().catch((e) => console.warn(`[codenexum] auto-discover crashed: ${e.message}`))
        })
      } else {
        console.error(`[codenexum MCP] Server error:`, err)
        resolve({ close: () => server.close(), port: p })
      }
    })
    server.listen(p, "127.0.0.1", () => {
      const ap = (server.address() as any)?.port || p
      console.log(`[codenexum MCP] Server listening on http://127.0.0.1:${ap}`)
      resolve({ close: () => server.close(), port: ap })
      autoDiscoverAndIndex().catch((e) => console.warn(`[codenexum] auto-discover crashed: ${e.message}`))
    })
  })
}
