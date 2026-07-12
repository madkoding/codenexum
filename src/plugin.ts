import { tool, type Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { join, isAbsolute, relative, extname } from "path"
import { existsSync, mkdirSync, unlinkSync, copyFileSync, readFileSync, statSync } from "fs"
import {
  initSchema, dbInsertChunks, dbDeleteFile, dbSetFileHash, dbSetMeta,
  dbGetMeta, dbGetFileHash, dbChunkCount, dbFileCount, dbClear, dbStatsByLang, dbTopFiles,
  dbGetSchemaVersion, dbSetSchemaVersion, SCHEMA_VERSION, dbInsertEdges,
  dbFindRelated, dbFindImpacted, dbEdgeCount,
} from "./store"
import { search } from "./search"
import { formatSearchResults } from "./format"
import { indexProject, updateFile, debouncedUpdateFile, getMaxFiles, type LogFn } from "./indexer"
import { parseSymbolRef } from "./resolve"
import { buildSystemPrompt } from "./prompt"
import { compressToolOutput, isCompressible, getSemanticCompressionSaved } from "./compress"
import { tryDecompressGenerativeOutput, getGenerativeCompressionOptions, getCompressOutputOptions, shouldCompressOutputMessage, compressMessage, compressGenerativeOutput, wrapCompressedOutput } from "./generative-compress"
import { recordTokens, getFillRatio, clearSession, recordSearch, recordNativeSearch, recordFileRead, measuredSavings, getUsage, recordCompaction, recordCompression, recordSemanticCompression, recordCacheHit, recordToolIntercept, setProjectContext, recordSearchSavings, recordIndexSubstitution, recordIndexMiss, recordGenerativeCompression, recordOutputCompression } from "./budget"
import { compactMessages, getCompactionCount } from "./compact"
import { startDashboard, stopDashboard, getDashboardState, registerProjectDb } from "./dashboard"
import { registerProject, getProject, getRecentCompressionEvents, projectId as getProjId } from "./registry"
import { getTokenizer } from "./tokens"
import { detectInterceptCandidate, tryInterceptOutput, type InterceptCandidate } from "./intercept"
import { ToolOutputCache } from "./cache"
import { ConversationContext } from "./context"

const ContextManagerPlugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = (level, message, extra) =>
    client?.app?.log({ body: { service: "opencode-context-manager-plugin", level: level as any, message, extra } }).catch(() => {})

  const HOME = process.env.HOME || "/tmp"
  const dbDir = join(HOME, ".cache/opencode")

  const isServeMode = process.argv.includes("serve")

  // Multi-project state
  const projects = new Map<string, { db: Database; projId: string; ready: boolean }>()
  const sessionDir = new Map<string, string>() // sessionID → directory
  const accessOrder: string[] = []
  const MAX_PROJECTS = 8

  // Primary (first) project — used as default in TUI mode
  let db: Database | null = null
  let ready = false
  let projId: string = ""
  const state = { get db() { return db }, get ready() { return ready }, get projId() { return projId } }

  // Worker helper for off-thread indexing
  async function indexInWorker(root: string, maxFiles: number): Promise<ReturnType<typeof indexProject> | null> {
    try {
      const worker = new Worker(new URL("../plugins/worker-indexer.ts", import.meta.url))
      const p = new Promise<any>((resolve, reject) => {
        worker.onmessage = (e) => { resolve(e.data); worker.terminate() }
        worker.onerror = (e) => { reject(e); worker.terminate() }
      })
      worker.postMessage({ root, maxFiles })
      const result = await p
      if (!result.ok) { log("warn", "worker index failed", { error: result.error }); return null }
      return result
    } catch (e) {
      log("warn", "worker index failed, falling back to sync", { error: String(e) })
      return indexProject(root, maxFiles)
    }
  }

  // Helpers for project resolution
  function touchLRU(dir: string) {
    const idx = accessOrder.indexOf(dir)
    if (idx > 0) { accessOrder.splice(idx, 1); accessOrder.unshift(dir) }
    else if (idx === -1) { accessOrder.unshift(dir); if (accessOrder.length > MAX_PROJECTS) { const evicted = accessOrder.pop()!; const p = projects.get(evicted); if (p) { try { p.db.close() } catch {}; projects.delete(evicted) } } }
  }

  function projectForDir(dir: string): { db: Database; projId: string; ready: boolean } | null {
    const p = projects.get(dir)
    if (p) touchLRU(dir)
    return p ?? null
  }

  function projectForSession(sid: string | undefined | null): { db: Database; projId: string; ready: boolean } | null {
    if (!sid) return null
    const dir = sessionDir.get(sid)
    return dir ? projectForDir(dir) : null
  }

  function projectFromCtx(ctx: { sessionID?: string; directory?: string }): { db: Database; projId: string; ready: boolean } | null {
    return projectForSession(ctx.sessionID) || projectForDir(ctx.directory || "") || null
  }

  // Resolve tokenizer eagerly so the first real call is fast.  If
  // gpt-tokenizer isn't installed we silently fall back to the heuristic.
  const tokenizer = getTokenizer()
  log("info", "plugin initialized", { directory, tokenizer: tokenizer.mode, mode: isServeMode ? "serve" : "tui" })

  function readFileSyncSafe(p: string): string { try { return readFileSync(p, "utf8") } catch { return "" } }

  async function ensureProject(dir: string, doIndex = true, logFn = log): Promise<{ db: Database; projId: string; ready: boolean }> {
    const existing = projects.get(dir)
    if (existing) return existing

    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

    const projInfo = registerProject(dir)
    const newDb = new Database(projInfo.dbPath)
    initSchema(newDb)

    const currentSchemaVersion = dbGetSchemaVersion(newDb)
    if (currentSchemaVersion < SCHEMA_VERSION) {
      logFn("info", "schema version mismatch; clearing index for reindex", { current: currentSchemaVersion, target: SCHEMA_VERSION })
      dbClear(newDb)
      dbSetSchemaVersion(newDb, SCHEMA_VERSION)
      logFn("info", "index schema updated; reindexing project")
    }

    registerProjectDb(projInfo.id, newDb)

    const skillDstDir = join(HOME, ".config/opencode/skills/context-manager")
    const skillDst = join(skillDstDir, "SKILL.md")
    const skillSrc = join(import.meta.dir, "..", "skills", "context-manager", "SKILL.md")
    if (existsSync(skillSrc)) {
      try {
        if (!existsSync(skillDstDir)) mkdirSync(skillDstDir, { recursive: true })
        if (!existsSync(skillDst) || readFileSync(skillSrc, "utf8") !== readFileSyncSafe(skillDst)) {
          copyFileSync(skillSrc, skillDst)
          logFn("info", "skill installed/updated", { file: skillDst })
        }
      } catch (e) {
        logFn("warn", "skill auto-install failed", { error: String(e) })
      }
    }

    const entry = { db: newDb, projId: projInfo.id, ready: true }
    projects.set(dir, entry)
    touchLRU(dir)

    // Defer indexing so the TUI can finish booting.
    if (doIndex) {
      setTimeout(async () => {
        if (entry.db !== projects.get(dir)?.db) return
        const maxFiles = getMaxFiles()
        log("info", "auto-indexing project (background)", { directory: dir, maxFiles })
        const result = await indexInWorker(dir, maxFiles)
        if (!result) { log("warn", "auto-index returned no results"); return }
        const { files: nfiles, chunks, fileHashes, edges, capped } = result
        if (chunks.length === 0) {
          log("warn", "no code files found in this directory")
        } else if (capped) {
          log("warn", "index capped", { files: nfiles, chunks: chunks.length })
        } else {
          log("info", "index ready", { files: nfiles, chunks: chunks.length })
        }
        dbClear(entry.db)
        dbInsertChunks(entry.db, chunks)
        dbInsertEdges(entry.db, edges || [])
        for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(entry.db, fp, h)
        dbSetMeta(entry.db, "projectRoot", dir)
        dbSetMeta(entry.db, "indexedAt", new Date().toISOString())
        entry.ready = true
      }, 100)
    }

    return entry
  }

  async function ensureIndexed(ps: { db: Database; projId: string }, root: string): Promise<void> {
    if (dbChunkCount(ps.db) > 0) return
    log("info", "on-demand indexing", { directory: root })
    const result = await indexInWorker(root, getMaxFiles())
    if (!result) return
    const { chunks, fileHashes, edges } = result
    dbClear(ps.db)
    dbInsertChunks(ps.db, chunks)
    dbInsertEdges(ps.db, edges)
    for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(ps.db, fp, h)
    dbSetMeta(ps.db, "projectRoot", root)
    dbSetMeta(ps.db, "indexedAt", new Date().toISOString())
  }

  setImmediate(() => {
    (async () => {
      try {
        // In TUI mode, auto-index the primary project on startup.
        // In serve mode, skip — index on session.created instead.
        if (!isServeMode) {
          setProjectContext(directory)
          const primary = await ensureProject(directory, false, log)
          db = primary.db
          projId = primary.projId
          registerProject(directory)
          ready = primary.ready
        } else {
          ready = true
        }

      // Start dashboard (multiplexer serves all projects)
      if (process.env.CONTEXT_MANAGER_DASHBOARD_AUTO_START !== "0") {
        setTimeout(async () => {
          if (!db && projects.size === 0) return
          try {
            const dash = await startDashboard(db || undefined, undefined, projId || undefined)
            if (dash.ready) {
              log("info", "dashboard running", { url: dash.url, project: isServeMode ? "serve (multi-project)" : registerProject(directory).name })
            } else {
              log("warn", "dashboard failed to start", { error: dash.error })
            }
          } catch (e) {
            log("warn", "dashboard start error", { error: String(e) })
          }
        }, 200)
      }

    } catch (e) {
      log("error", "plugin init failed", { error: String(e) })
      ready = true
    }
    })()
  })

  // Map callID → { resolvedPath, cmd, interceptCandidate } for use in tool.execute.after
  const toolCalls = new Map<string, { resolvedPath: string; cmd: string; candidate?: InterceptCandidate }>()
  const editedFilesThisSession = new Set<string>()
  const toolOutputCache = new ToolOutputCache()
  const conversationContext = new ConversationContext()

  return {
    tool: {
      context_analyze: tool({
        description: "Re-index the project. Walks code files, extracts symbols, stores in SQLite. Runs automatically on first load.",
        args: {
          path: tool.schema.string().optional().describe("Project path. Default: current session directory."),
        },
        async execute(args, c) {
          const root = args.path ? (isAbsolute(args.path) ? args.path : join(c.directory, args.path)) : c.directory
          let ps = projectForDir(root)
          if (!ps) ps = await ensureProject(root, false, log)
          if (!ps?.db) return "Plugin still initializing. Try again in a second."
          const sid = c.sessionID
          const { files, chunks, fileHashes, edges, capped } = indexProject(root)
          dbClear(ps.db)
          dbInsertChunks(ps.db, chunks)
          dbInsertEdges(ps.db, edges)
          for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(ps.db, fp, h)
          dbSetMeta(ps.db, "projectRoot", root)
          dbSetMeta(ps.db, "indexedAt", new Date().toISOString())
          recordSearch(sid, `context_analyze ${root}`, true)
          log("info", "indexed project", { files, chunks: chunks.length, edges: edges.length, root, capped })
          if (capped) {
            log("warn", "index capped", { files, chunks: chunks.length })
          } else {
            log("info", "index ready", { files, chunks: chunks.length })
          }
          const fns = chunks.filter(x => x.type === "function").length
          const cls = chunks.filter(x => x.type === "class").length
          const ifs = chunks.filter(x => x.type === "interface").length
          const types = chunks.filter(x => x.type === "type").length
          const enums = chunks.filter(x => x.type === "enum").length
          const imp = chunks.filter(x => x.type === "import").length
          const exp = chunks.filter(x => x.type === "export").length
          const dec = chunks.filter(x => x.type === "decorator").length
          const sel = chunks.filter(x => x.type === "selector").length
          const cmp = chunks.filter(x => x.type === "component").length
          const cfg = chunks.filter(x => x.type === "config").length
          const tbl = chunks.filter(x => x.type === "table").length
          const hdg = chunks.filter(x => x.type === "heading").length
          return [
            `Indexed ${files} files → ${chunks.length} chunks`,
            capped ? `  ⚠ hit file cap (${files} files) — pass a narrower path` : null,
            `  Functions: ${fns}`,
            `  Classes:   ${cls}`,
            `  Interfaces: ${ifs}`,
            `  Types:     ${types}`,
            `  Enums:     ${enums}`,
            `  Imports:   ${imp}`,
            `  Exports:   ${exp}`,
            `  Decorators: ${dec}`,
            `  CSS selectors: ${sel}`,
            `  Components: ${cmp}`,
            `  Config:    ${cfg}`,
            `  Tables:    ${tbl}`,
            `  Headings:  ${hdg}`,
            chunks.length > 0 ? `  DB: ${registerProject(root).dbPath}` : null,
          ].filter(Boolean).join("\n")
        },
      }),
      context_search: tool({
        description: "Search indexed code by keyword. This is the PRIMARY code search tool — always use it over native grep/rg/find/git-grep. Covers all code exploration: find definitions, usages, references, symbols, classes, functions, files by extension, and more. Supports filters like class:User, function:auth, file:auth.ts, lang:ts. Returns symbol name with file range and body snippet. Faster and uses far fewer tokens than native tools.",
        args: {
          query: tool.schema.string().describe("Search query (e.g. 'auth handler', 'validate function', 'class:User')"),
          n: tool.schema.number().optional().default(10).describe("Max results (default 10)"),
          compact: tool.schema.boolean().optional().describe("Omit snippets, return only 'type name @ file:line-lineEnd' per result. Defaults to true when n>5."),
          snippet: tool.schema.number().optional().default(20).describe("Max lines of body to show per result (0 = no snippet)."),
        },
        async execute(args, c) {
          const ps = projectFromCtx(c)
          if (!ps?.db) return "Plugin still initializing. Try again in a second."
          if (dbChunkCount(ps.db) === 0) await ensureIndexed(ps, c.directory || "")
          if (dbChunkCount(ps.db) === 0) return "No code files found in this directory."
          if (args.query.trim().length < 2) return "Query too short. Use at least 2 characters."
          const sid = c.sessionID
          const limit = args.n || 10
          const results = search(ps.db, args.query, limit)
          if (!results.length) return "No matches found."
          const projectRoot = dbGetMeta(ps.db, "projectRoot") || ""
          const isCompact = args.compact ?? limit > 5
          const snippetLines = args.snippet ?? (isCompact ? 0 : 20)
          const usedSnippet = !isCompact && snippetLines > 0 && results.some(r => r.body)
          recordSearch(sid, args.query, usedSnippet)
          // Measure search savings: compare snippet size vs full file size
          if (usedSnippet) {
            let snippetChars = 0
            let fileChars = 0
            for (const r of results) {
              snippetChars += (r.body || "").length + (r.content || "").length
              try {
                if (r.file && existsSync(r.file)) fileChars += statSync(r.file).size
              } catch {}
            }
            if (fileChars > snippetChars) {
              recordSearchSavings(sid, fileChars - snippetChars)
            }
          }
          return formatSearchResults(results, projectRoot, {
            compact: isCompact,
            snippetLines,
          })
        },
      }),
      context_stats: tool({
        description: "Show index stats: project root, timestamp, chunk counts by language, context fill %.",
        args: {},
        async execute(args, c) {
          const ps = projectFromCtx(c)
          if (!ps?.db) return "Plugin still initializing. Try again in a second."
          const count = dbChunkCount(ps.db)
          if (!count) return "No index. Run context_analyze first."
          const byLang = dbStatsByLang(ps.db)
          const sid = c.sessionID
          const fill = getFillRatio(sid)
          const usage = getUsage(sid)
          const lines = [
            `Project: ${dbGetMeta(ps.db, "projectRoot")}`,
            `Indexed: ${dbGetMeta(ps.db, "indexedAt")}`,
            `Total:   ${count} chunks`,
          ]
          for (const { ext, n } of byLang)
            lines.push(`  ${ext}: ${n}`)
          lines.push(`Files:   ${dbFileCount(ps.db)}`)
          const writeCompress = process.env.CONTEXT_MANAGER_COMPRESS_WRITES === "1"
          const outputCompress = process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT === "1"
          const interceptMode = process.env.CONTEXT_MANAGER_INTERCEPT_MODE || "substitute"
          lines.push(`Compression: writes=${writeCompress ? "on" : "off"} output=${outputCompress ? "on" : "off"} intercept=${interceptMode}`)
          const measured = measuredSavings(usage)
          const denom = (usage.searchQueries || 0) + (usage.nativeSearches || 0) + (usage.filesRead || 0) + (usage.indexSubstitutions || 0) + (usage.cacheHits || 0)
          const efficiency = denom > 0 ? (((usage.indexSubstitutions || 0) + (usage.cacheHits || 0) + (usage.toolsIntercepted || 0)) / denom) : 0
          lines.push(`Context fill: ${(fill * 100).toFixed(0)}%`)
          lines.push(`Efficiency ratio: ${(efficiency * 100).toFixed(0)}%`)
          lines.push(`Searches this session: ${usage.searchQueries || 0}`)
          lines.push(`Snippet-only answers: ${usage.snippetsUsed || 0}`)
          lines.push(`Files read via search: ${usage.filesRead || 0}`)
          lines.push(`Index substitutions: ${usage.indexSubstitutions || 0}`)
          lines.push(`Index misses: ${usage.indexMissed || 0}`)
          lines.push(`Cache hits: ${usage.cacheHits || 0}`)
          lines.push(`Compactions: ${(usage.compactions || 0) + getCompactionCount()}`)
          lines.push(`Tokens saved by compression: ~${(usage.compressionSaved || 0).toLocaleString()}`)
          lines.push(`Tokens saved by semantic compression: ~${(usage.semanticCompressionSaved || 0).toLocaleString()}`)
          lines.push(`Tokens saved by search snippets: ~${(usage.searchSaved || 0).toLocaleString()}`)
          lines.push(`Tokens saved by index substitution: ~${(usage.indexSavedTokens || 0).toLocaleString()}`)
          lines.push(`Tokens saved by generative compression: ~${(usage.generativeCompressionSaved || 0).toLocaleString()}`)
          lines.push(`Tokens saved by output compression: ~${(usage.outputCompressionSaved || 0).toLocaleString()}`)
          lines.push(`Total tokens saved: ~${measured.toLocaleString()} (compression + semantic + search + index + generative + output)`)
          lines.push(`Avg tokens saved per search: ~${(usage.searchQueries || 0) > 0 ? Math.round(measured / (usage.searchQueries || 1)).toLocaleString() : "0"}`)
          return lines.join("\n")
        },
      }),
      context_related: tool({
        description: "Show symbols related to a given file:symbol — callers, callees, imports, extends, implements. Useful for tracing a change.",
        args: {
          symbol: tool.schema.string().describe("Symbol to trace, e.g. 'src/auth.ts:authenticate' or just 'authenticate' (best-effort match)."),
          n: tool.schema.number().optional().default(10).describe("Max related symbols to return."),
        },
        async execute(args, c) {
          const ps = projectFromCtx(c)
          if (!ps?.db) return "Plugin still initializing. Try again in a second."
          if (dbChunkCount(ps.db) === 0) await ensureIndexed(ps, c.directory || "")
          if (dbChunkCount(ps.db) === 0) return "No code files found in this directory."
          const projectRoot = dbGetMeta(ps.db, "projectRoot") || ""
          const parsed = parseSymbolRef(args.symbol, projectRoot)
          if (!parsed) return "Could not parse symbol reference. Use format: file.ts:symbolName."
          const related = dbFindRelated(ps.db, parsed.file, parsed.name)
          if (!related.length) return `No relations found for ${parsed.name}.`
          const limit = args.n || 10
          return related.slice(0, limit).map(r => {
            const rel = relative(projectRoot, r.file) || r.file
            const arrow = r.direction === "out" ? "→" : "←"
            return `${r.kind} ${arrow} ${r.symbol} @ ${rel}`
          }).join("\n")
        },
      }),
      context_impact: tool({
        description: "Given one or more files, find files/symbols that depend on them. Useful before editing to know what could break.",
        args: {
          files: tool.schema.array(tool.schema.string()).describe("File paths (absolute or relative to project root)."),
          n: tool.schema.number().optional().default(10).describe("Max impacted files to return."),
        },
        async execute(args, c) {
          const ps = projectFromCtx(c)
          if (!ps?.db) return "Plugin still initializing. Try again in a second."
          if (dbChunkCount(ps.db) === 0) await ensureIndexed(ps, c.directory || "")
          if (dbChunkCount(ps.db) === 0) return "No code files found in this directory."
          const projectRoot = dbGetMeta(ps.db, "projectRoot") || c.directory
          const files = args.files.map(f => isAbsolute(f) ? f : join(projectRoot, f))
          const impacted = dbFindImpacted(ps.db, files)
          if (!impacted.length) return "No dependent files found for the given files."
          const limit = args.n || 10
          const projectRootMeta = dbGetMeta(ps.db, "projectRoot") || ""
          const grouped: Record<string, string[]> = {}
          for (const r of impacted.slice(0, limit)) {
            const dep = relative(projectRootMeta, r.dependent) || r.dependent
            ;(grouped[dep] ||= []).push(`${r.kind} ${r.symbol}`)
          }
          return Object.entries(grouped).map(([file, symbols]) => {
            return `${file}\n  ${symbols.join("\n  ")}`
          }).join("\n\n")
        },
      }),
      context_clear: tool({
        description: "Delete the local code index.",
        args: {},
        async execute(args, c) {
          const ps = projectFromCtx(c)
          if (!ps?.db) return "Plugin still initializing. Try again in a second."
          dbClear(ps.db)
          return "Index cleared."
        },
      }),
      context_dashboard: tool({
        description: "Open the Context Manager web dashboard. The dashboard runs as a standalone React app connecting via WebSocket to the plugin on port 3567. Shows live multi-project stats, charts, and search. Auto-starts on opencode launch unless CONTEXT_MANAGER_DASHBOARD_AUTO_START=0.",
        args: {},
        async execute(args, c) {
          const ps = projectFromCtx(c)
          const db = ps?.db || state.db
          if (!db) return "Plugin still initializing. Try again in a second."
          const sid = c.sessionID
          let dash = getDashboardState()
          if (!dash.ready) {
            dash = await startDashboard(db, sid)
          }
          recordSearch(sid, "context_dashboard", true)
          if (!dash.ready) return `Dashboard server failed: ${dash.error || "unknown error"}`
          return `Context Manager WebSocket server: ${dash.url}/ws — connect the dashboard app to this URL. API: ${dash.url}/api/projects, ${dash.url}/api/aggregate`
        },
      }),
      context_compression: tool({
        description: "Show real-time compression status and diagnostics. Reports which compression modes are active, session tokens saved, recent events, and runs a self-test.",
        args: {},
        async execute(_args, c) {
          const sid = (c as any)?.sessionID
          const usage = getUsage(sid)
          const measured = measuredSavings(usage)

          const writeCompress = process.env.CONTEXT_MANAGER_COMPRESS_WRITES === "1"
          const outputCompress = process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT === "1"
          const writeThreshold = process.env.CONTEXT_MANAGER_COMPRESS_WRITES_THRESHOLD || "1000"
          const outputThreshold = process.env.CONTEXT_MANAGER_COMPRESS_OUTPUT_THRESHOLD || "500"
          const interceptMode = process.env.CONTEXT_MANAGER_INTERCEPT_MODE || "substitute"

          const recent = getRecentCompressionEvents(5)

          // Self-test: compress + decompress a small text
          const testText = "x".repeat(100)
          const { base64 } = compressGenerativeOutput(testText)
          const wrapped = wrapCompressedOutput("self-test", base64)
          const decompressed = tryDecompressGenerativeOutput(wrapped)
          const selfTestOk = decompressed?.content === testText

          const lines = [
            "Compression Status",
            "━━━━━━━━━━━━━━━━━",
            "",
            "Configuration:",
            `  Write compression (CONTEXT_MANAGER_COMPRESS_WRITES): ${writeCompress ? "ON" : "off"}`,
            `  Write threshold: ${writeThreshold} chars`,
            `  Output compression (CONTEXT_MANAGER_COMPRESS_OUTPUT): ${outputCompress ? "ON" : "off"}`,
            `  Output threshold: ${outputThreshold} chars`,
            `  Intercept mode: ${interceptMode}`,
            "",
            "Session stats:",
            `  Generative compression saved: ~${(usage.generativeCompressionSaved || 0).toLocaleString()} tokens`,
            `  Output compression saved: ~${(usage.outputCompressionSaved || 0).toLocaleString()} tokens`,
            `  Total session savings: ~${measured.toLocaleString()} tokens`,
            "",
            `Self-test: compress + decompress 100 chars`,
            `  Result: ${selfTestOk ? "✅ working" : "❌ failed"} (${testText.length} → ${base64.length} chars)`,
          ]

          if (recent.length > 0) {
            lines.push("", "Recent events:")
            for (const e of recent) {
              const label = e.eventType === "generative_compression" ? "Write" : "Output"
              const age = Math.round((Date.now() - e.ts) / 1000)
              lines.push(`  ${label}: saved ~${e.tokensSaved} tokens (${age}s ago)`)
            }
          }

          return lines.join("\n")
        },
      }),
    },
    async event({ event }) {
      try {
      const props = event.properties as any

      // session.created — register session-to-dir mapping and ensure project
      if (event.type === "session.created" && props?.info) {
        const dir = (props.info as any).directory
        const sid = (props.info as any).id
        if (dir && sid) {
          sessionDir.set(sid, dir)
          if (!projects.has(dir)) {
            ensureProject(dir, false, log).catch(e => log("error", "on-demand project init failed", { error: String(e) }))
          }
        }
        return
      }

      // Resolve the project DB for this event; fall back to primary project
      const eventDb = (() => {
        if (event.type === "message.updated" && props?.info) {
          return projectForSession(props.info.sessionID)?.db || state.db
        }
        if (event.type === "message.part.updated" && props?.part) {
          return projectForSession(props.part.sessionID)?.db || state.db
        }
        if (event.type === "file.edited" || event.type === "file.watcher.updated") {
          const fp = props?.file || ""
          // Find which project directory is a parent of this file
          for (const [pdir] of projects) {
            if (fp.startsWith(pdir + "/") || fp === pdir) return projects.get(pdir)!.db
          }
          return state.db
        }
        return state.db
      })()

      if (!eventDb) return

      if (event.type === "message.updated" && props?.info?.tokens) {
        const info = props.info as any
        const t = info.tokens as { input?: number; output?: number }
        recordTokens(info.sessionID, t.input || 0, t.output || 0)
      }
      if (event.type === "file.edited" && props?.file) {
        editedFilesThisSession.add(props.file)
        debouncedUpdateFile(eventDb, props.file, 500, log)
      }
      if (event.type === "file.watcher.updated" && props?.file) {
        const fp = props.file
        const ev = props.event
        if (ev === "unlink") {
          dbDeleteFile(eventDb, fp)
          log("debug", "removed file from index", { file: fp })
        } else if (ev === "add" || ev === "change") {
          debouncedUpdateFile(eventDb, fp, 500, log)
        }
      }
      if (event.type === "message.part.updated" && props?.part) {
        const part = props.part as any
        if (part.type === "tool" && part.tool) {
          const sid = part.sessionID
          const toolName = part.tool
          const st = part.state as { status?: string; input?: any; output?: string } | undefined
          const input = st?.input || {}

          // Extract filePath from input for project resolution
          const filePath = input.filePath || input.path || input.file || ""
          const cmd = input.command || input.cmd || input.script || (typeof input === "string" ? input : "")

          // For bash, try to extract an absolute path from the command
          let resolvedPath = filePath
          if (!resolvedPath && cmd) {
            const m = /\s(\/[^\s'"]+)/.exec(cmd)
            if (m) resolvedPath = m[1]
          }

          // Store resolvedPath and cmd for this callID so tool.execute.after can use it
          const callID = (part as any).callID || ""
          if (callID) toolCalls.set(callID, { resolvedPath, cmd })

          if (st?.status === "running") {
            if (toolName === "read") {
              recordFileRead(sid, resolvedPath)
            } else if (["context_search", "context_related", "context_impact"].includes(toolName)) {
              const query = input.query || input.symbol || input.files?.join(", ") || toolName
              recordSearch(sid, query, true)
            } else if (["context_analyze", "context_dashboard", "context_stats"].includes(toolName)) {
              const query = input.path || input.query || toolName
              recordSearch(sid, query, true)
            } else if (["bash", "sh", "zsh", "fish", "shell"].includes(toolName)) {
              if (/\b(grep|rg|find|fd)\b/i.test(cmd)) recordNativeSearch(sid, cmd.slice(0, 120), resolvedPath)
              if (/\b(cat|head|tail|less|more|bat)\b/i.test(cmd)) {
                log("info", "read detected in bash", { cmd: cmd.slice(0, 120), match: cmd.match(/\b(cat|head|tail|less|more|bat)\b/i)?.[0] })
                recordFileRead(sid, resolvedPath)
              }
            }
          }

          // On completed: nothing — compression + intercept handled in tool.execute.after
        }
      }
      } catch (e) {
        log("error", "event handler failed", { error: String(e) })
      }
    },
    async "experimental.chat.system.transform"(input, output) {
      try {
      const ps = projectForSession(input.sessionID)
      const psDb = ps?.db || state.db
      const psReady = ps?.ready ?? state.ready
      if (!psDb) {
        output.system.push([
          "<context-manager>",
          "Status: plugin still initializing.",
          "Tell the user the context-manager plugin is loading and will be ready in a moment.",
          "</context-manager>",
        ].join("\n"))
        return
      }
      const prompt = buildSystemPrompt(psDb, psReady, editedFilesThisSession.size > 0)
      if (prompt) output.system.push(prompt)
      } catch (e) {
        log("error", "system.transform failed", { error: String(e) })
      }
    },
    async "experimental.chat.messages.transform"(_input, output) {
      try {
      const msgs = (output as { messages: { info: { role?: string; sessionID?: string }; parts: any[] }[] }).messages
      if (!Array.isArray(msgs) || msgs.length === 0) return
      const sid = msgs[0]?.info?.sessionID
      const direction = (_input as { direction?: string })?.direction || "input"

      if (direction === "input") {
        const fill = getFillRatio(sid)
        const { count: n } = compactMessages(msgs as any, fill)
        if (n > 0) {
          recordCompaction(sid)
          log("info", "compacted old tool outputs", { count: n, fillRatio: fill })
        }
        // Capture user text for smart-read ranking.
        for (const msg of msgs) {
          if (msg.info?.role !== "user") continue
          const text = msg.parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join(" ")
          if (text) conversationContext.addUserText(text)
        }

        // Decompress all compressed messages (assistant writes + compressed history messages).
        for (const msg of msgs) {
          for (const part of msg.parts) {
            if (part.type !== "text" || typeof part.text !== "string") continue
            const decompressed = tryDecompressGenerativeOutput(part.text)
            if (decompressed) {
              part.text = decompressed.content
            }
          }
        }
      }

      if (direction === "output") {
        const outputOpts = getCompressOutputOptions()
        if (outputOpts.enabled) {
          for (const msg of msgs) {
            if (!msg.info?.role) continue
            for (const part of msg.parts) {
              if (part.type !== "text" || typeof part.text !== "string") continue
              if (shouldCompressOutputMessage(part.text, outputOpts.threshold)) {
                const { wrapped, originalChars, compressedChars } = compressMessage(part.text, msg.info.role)
                const saved = Math.max(0, originalChars - compressedChars)
                recordOutputCompression(sid, saved, msg.info.role)
                log("info", "compressed output message", { role: msg.info.role, originalChars, compressedChars, sessionID: sid })
                part.text = wrapped
              }
            }
          }
        }
      }
      } catch (e) {
        log("error", "messages.transform failed", { error: String(e) })
      }
    },
    async "tool.execute.before"(input, output) {
      try {
      const { tool: t, sessionID: sid, callID } = input as { tool: string; sessionID: string; callID: string }
      const args = (output as { args: any }).args
      log("info", "tool.execute.before", { tool: t, sessionID: sid, callID })
      const ps = projectForSession(sid)
      const psDb = ps?.db || state.db
      const psDir = ps ? dbGetMeta(ps.db, "projectRoot") || "" : directory
      if (!psDb) return
      if (dbChunkCount(psDb) === 0) {
        const root = dbGetMeta(psDb, "projectRoot") || psDir || directory
        await ensureIndexed({ db: psDb, projId: ps?.projId || "" }, root)
      }
      if (dbChunkCount(psDb) === 0) return
      const projectRoot = dbGetMeta(psDb, "projectRoot") || psDir || directory
      const candidate = detectInterceptCandidate(psDb, projectRoot, t, args)
      if (candidate) {
        const existing = toolCalls.get(callID)
        toolCalls.set(callID, {
          resolvedPath: candidate.resolvedPath || existing?.resolvedPath || "",
          cmd: existing?.cmd || "",
          candidate,
        })
        log("info", "intercept candidate detected", { tool: t, reason: candidate.reason, substitutable: candidate.substitutable, sessionID: sid })
      }
      } catch (e) {
        log("error", "tool.execute.before failed", { error: String(e) })
      }
    },
    async "tool.execute.after"(input, output) {
      try {
      const t = (input as { tool?: string })?.tool || ""
      const sid = (input as { sessionID?: string })?.sessionID
      const callID = (input as { callID?: string })?.callID || ""
      log("info", "tool.execute.after", { tool: t, sessionID: sid })
      const ps = projectForSession(sid)
      const psDb = ps?.db || state.db
      const psDir = ps ? dbGetMeta(ps.db, "projectRoot") || "" : directory
      const callInfo = toolCalls.get(callID)
      const resolvedPath = callInfo?.resolvedPath || ""
      const cmd = callInfo?.cmd || ""
      const candidate = callInfo?.candidate
      const projectRoot = psDb ? dbGetMeta(psDb, "projectRoot") || psDir || directory : directory

      // Try to replace the native output with a compact index substitute.
      if (candidate && psDb) {
        const cur = (output as { output?: string }).output
        if (typeof cur === "string") {
          const cached = toolOutputCache.get(t, candidate.args, resolvedPath ? dbGetFileHash(psDb, resolvedPath) || undefined : undefined)
          let result: { replaced: boolean; output?: string; tokensSaved?: number; potentialSavings?: number; reason: string }
          if (cached) {
            result = { replaced: true, output: cached.output, tokensSaved: 0, potentialSavings: 0, reason: "cache hit" }
          } else {
            result = tryInterceptOutput(psDb, projectRoot, candidate, cur, conversationContext)
          }
          if (result.replaced && result.output) {
            (output as { output: string }).output = result.output
            if (!cached) {
              toolOutputCache.set(t, candidate.args, result.output, resolvedPath ? dbGetFileHash(psDb, resolvedPath) || undefined : undefined)
            } else {
              recordCacheHit(sid, t, resolvedPath)
            }
            recordIndexSubstitution(sid, result.tokensSaved || 0, t, resolvedPath)
            log("info", "index substitution applied", { tool: t, tokensSaved: result.tokensSaved, reason: result.reason, sessionID: sid })
            if (callID) toolCalls.delete(callID)
            return
          } else {
            recordIndexMiss(sid, t, resolvedPath, result.potentialSavings)
            log("info", "index substitution missed", { tool: t, reason: result.reason, potentialSavings: result.potentialSavings, sessionID: sid })
          }
        }
      }

      if (!isCompressible(t)) {
        if (callID) toolCalls.delete(callID)
        return
      }
      const cur = (output as { output?: string }).output
      if (typeof cur === "string" && cur.length > 0) {
        const compressed = compressToolOutput(t, cur)
        const saved = cur.length - compressed.length
        const semanticSaved = getSemanticCompressionSaved(cur, compressed)
        // Use the real command as the intercept label, not the vague tool name
        const label = cmd ? cmd.slice(0, 120) : t
        if (saved > 0) {
          if (semanticSaved > 0) {
            recordSemanticCompression(sid, semanticSaved, resolvedPath)
          } else {
            recordCompression(sid, saved, resolvedPath)
          }
        }
        if (compressed !== cur) (output as { output: string }).output = compressed
        recordToolIntercept(sid, label, resolvedPath)
      }
      if (callID) toolCalls.delete(callID)
      } catch (e) {
        log("error", "tool.execute.after failed", { error: String(e) })
      }
    },
  }
}

export default ContextManagerPlugin
