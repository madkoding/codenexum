import { tool, type Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { join, isAbsolute, relative, extname } from "path"
import { existsSync, mkdirSync, unlinkSync, copyFileSync, writeFileSync, readFileSync } from "fs"
import {
  initSchema, dbInsertChunks, dbDeleteFile, dbSetFileHash, dbSetMeta,
  dbGetMeta, dbChunkCount, dbFileCount, dbSearch, dbClear, dbStatsByLang,
} from "../src/store"
import { indexProject, updateFile, debouncedUpdateFile, getMaxFiles, type LogFn } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"
import { compressToolOutput } from "../src/compress"
import { recordTokens, getFillRatio, clearSession } from "../src/budget"
import { compactMessages } from "../src/compact"

const SHIM_SOURCE = `import type { Plugin } from "@opencode-ai/plugin"

const ShimPlugin: Plugin = async ({ client }) => {
  const log = (level: string, message: string, extra?: Record<string, unknown>) =>
    client?.app?.log({ body: { service: "context-manager-shim", level, message, extra } }).catch(() => {})

  const toast = (title: string, message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 8000) => {
    const tui = (client as any)?.tui
    if (tui?.showToast) tui.showToast({ body: { title, message, variant, duration } }).catch(() => {})
    else if (tui?.publish) tui.publish({ body: { type: "tui.toast.show", properties: { title, message, variant, duration } } }).catch(() => {})
    else if (tui?.appendPrompt) tui.appendPrompt({ body: { text: \`[\${title}] \${message}\` } }).catch(() => {})
  }

  log("info", "shim loaded — main plugin is being installed/downloaded")
  toast("Context Manager", "Installing plugin…", "info", 30000)

  setTimeout(() => toast("Context Manager", "Still loading… (first install can take 30-60s)", "info", 30000), 15000)
  setTimeout(() => toast("Context Manager", "If the TUI is still blank, the main plugin is still downloading. Please wait.", "info", 30000), 45000)

  return {}
}

export default ShimPlugin
`

async function ensureShimInstalled(HOME: string, client: any, log: LogFn) {
  const shimDir = join(HOME, ".config/opencode/plugins")
  const shimPath = join(shimDir, "context-manager-loading-shim.ts")
  try {
    if (!existsSync(shimDir)) mkdirSync(shimDir, { recursive: true })

    let stillConfigured = true
    try {
      const cfg = await Promise.race([
        client?.config?.get?.(),
        new Promise<null>(r => setTimeout(() => r(null), 2000)),
      ])
      if (cfg) {
        const plugins = (cfg as any)?.plugin
        stillConfigured = Array.isArray(plugins) && plugins.some((p: string) => p.includes("@madtech/opencode-context-manager-plugin"))
      }
    } catch {}

    if (!stillConfigured) {
      if (existsSync(shimPath)) {
        try { unlinkSync(shimPath); log("info", "shim removed (plugin no longer in config)") } catch {}
      }
      return
    }

    if (existsSync(shimPath)) {
      const existing = readFileSync(shimPath, "utf-8")
      if (existing === SHIM_SOURCE) return
    }
    writeFileSync(shimPath, SHIM_SOURCE, "utf-8")
    log("info", "shim auto-installed", { file: shimPath })
  } catch (e) {
    log("warn", "shim auto-install failed", { error: String(e) })
  }
}

const _plugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = (level, message, extra) =>
    client?.app?.log({ body: { service: "opencode-context-manager-plugin", level, message, extra } }).catch(() => {})

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p.then(v => v, () => null), new Promise<null>(r => setTimeout(() => r(null), ms))])

  const toast = async (title: string, message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 10000) => {
    const fullMessage = `[${title}] ${message}`
    log("info", "toast", { title, message, variant, duration })
    const tui = (client as any)?.tui
    if (!tui) {
      log("warn", "client.tui not available")
      return
    }
    if (typeof tui.showToast === "function") {
      const r = await withTimeout(tui.showToast({ body: { title, message, variant, duration } }), 3000)
      if (r !== null) { log("debug", "showToast result", { result: r }); return }
      log("warn", "showToast timed out")
    }
    if (typeof tui.publish === "function") {
      const r = await withTimeout(tui.publish({ body: { type: "tui.toast.show", properties: { title, message, variant, duration } } }), 3000)
      if (r !== null) { log("debug", "publish toast result", { result: r }); return }
      log("warn", "publish toast timed out")
    }
    if (typeof tui.appendPrompt === "function") {
      const r = await withTimeout(tui.appendPrompt({ body: { text: fullMessage } }), 3000)
      if (r !== null) { log("debug", "appended to prompt"); return }
      log("warn", "appendPrompt timed out")
    } else {
      log("warn", "no toast API available", { tuiKeys: Object.keys(tui) })
    }
  }

  const HOME = process.env.HOME || "/tmp"
  const dbDir = join(HOME, ".cache/opencode")
  const dbPath = join(dbDir, "context-manager.sqlite")
  const oldJsonPath = join(dbDir, "context-manager.json")

  let db: Database | null = null
  let ready = false
  const state = { get db() { return db }, get ready() { return ready } }

  log("info", "plugin initialized", { directory })
  toast("Context Manager", "Indexing codebase in background…", "info", 15000)

  setImmediate(() => {
    (async () => {
      try {
        await ensureShimInstalled(HOME, client, log)
        if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
      if (existsSync(oldJsonPath)) { try { unlinkSync(oldJsonPath) } catch {} }

      db = new Database(dbPath)
      initSchema(db)

      const skillDstDir = join(HOME, ".config/opencode/skills/context-manager")
      const skillDst = join(skillDstDir, "SKILL.md")
      if (!existsSync(skillDst)) {
        const skillSrc = join(import.meta.dir, "..", "skills", "context-manager", "SKILL.md")
        if (existsSync(skillSrc)) {
          try {
            mkdirSync(skillDstDir, { recursive: true })
            copyFileSync(skillSrc, skillDst)
            log("info", "skill auto-installed", { file: skillDst })
          } catch (e) {
            log("warn", "skill auto-install failed", { error: String(e) })
          }
        }
      }

      if (db && dbChunkCount(db) === 0) {
        const maxFiles = getMaxFiles()
        log("info", "auto-indexing project in worker (background)", { directory, maxFiles })
        const workerPath = join(import.meta.dir, "worker-indexer.ts")
        try {
          const worker = new Worker(workerPath, { type: "module" })
          worker.postMessage({ root: directory, maxFiles })
          worker.onmessage = (e: MessageEvent<{ files: number; chunks: any[]; fileHashes: Record<string, string>; capped: boolean }>) => {
            try {
              if (!db) return
              const { files, chunks, fileHashes, capped } = e.data
              if (chunks.length === 0) {
                toast("Context Manager", "No code files found in this directory", "warning", 10000)
              } else if (capped) {
                toast("Index capped", `Indexed ${chunks.length} chunks (hit cap at ${files} files). Pass a narrower path to context_analyze.`, "warning", 15000)
              } else {
                toast("Index ready", `Indexed ${chunks.length} chunks from ${files} files`, "success", 8000)
              }
              dbInsertChunks(db, chunks)
              for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
              dbSetMeta(db, "projectRoot", directory)
              dbSetMeta(db, "indexedAt", new Date().toISOString())
              log("info", "auto-indexed project", { files, chunks: chunks.length, capped })
              ready = true
              worker.terminate()
            } catch (err) {
              log("error", "failed to save auto-index", { error: String(err) })
              ready = true
              worker.terminate()
            }
          }
          worker.onerror = (err) => {
            log("error", "index worker failed", { error: String(err) })
            toast("Context Manager", "Index worker failed — run context_analyze manually", "error", 15000)
            ready = true
            worker.terminate()
          }
        } catch (e) {
          log("error", "could not start index worker", { error: String(e) })
          toast("Context Manager", "Could not start index worker", "error", 15000)
          ready = true
        }
      } else {
        ready = true
      }
    } catch (e) {
      log("error", "plugin init failed", { error: String(e) })
      toast("Context Manager", `Init failed: ${String(e)}`, "error", 15000)
      ready = true
    }
    })()
  })

  return {
    tool: {
      context_analyze: tool({
        description: "Re-index the project. Walks code files, extracts symbols, stores in SQLite. Runs automatically on first load.",
        args: {
          path: tool.schema.string().optional().describe("Project path. Default: current session directory."),
        },
        async execute(args, c) {
          if (!state.db) return "Plugin still initializing. Try again in a second."
          const root = args.path ? (isAbsolute(args.path) ? args.path : join(c.directory, args.path)) : c.directory
          const { files, chunks, fileHashes, capped } = indexProject(root)
          dbClear(state.db)
          dbInsertChunks(state.db, chunks)
          for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(state.db, fp, h)
          dbSetMeta(state.db, "projectRoot", root)
          dbSetMeta(state.db, "indexedAt", new Date().toISOString())
          log("info", "indexed project", { files, chunks: chunks.length, root, capped })
          if (capped) {
            toast("Index capped", `Indexed ${chunks.length} chunks (hit cap at ${files} files). Pass a narrower path.`, "warning", 15000)
          } else {
            toast("Index ready", `Indexed ${chunks.length} chunks from ${files} files`, "success", 8000)
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
            `  functions:  ${fns}`,
            `  classes:    ${cls}`,
            `  interfaces: ${ifs}`,
            `  types:      ${types}`,
            `  enums:      ${enums}`,
            `  imports:    ${imp}`,
            `  exports:    ${exp}`,
            `  decorators: ${dec}`,
            `  selectors:  ${sel}`,
            `  components: ${cmp}`,
            `  config:     ${cfg}`,
            `  tables:     ${tbl}`,
            `  headings:   ${hdg}`,
            `  DB: ${dbPath}`,
          ].filter(Boolean).join("\n")
        },
      }),
      context_search: tool({
        description: "Search indexed code by keyword. Prefer this over reading files blindly. Returns type name @ file:line ranked by BM25.",
        args: {
          query: tool.schema.string().describe("Search query (e.g. 'auth handler', 'validate function')"),
          n: tool.schema.number().optional().default(10).describe("Max results (default 10)"),
          compact: tool.schema.boolean().optional().describe("Omit content, return only 'type name @ file:line' per result. Defaults to true when n>5."),
        },
        async execute(args) {
          if (!state.db) return "Plugin still initializing. Try again in a second."
          if (dbChunkCount(state.db) === 0) return "No index. Run context_analyze first."
          if (args.query.trim().length < 2) return "Query too short. Use at least 2 characters."
          const limit = args.n || 10
          const results = dbSearch(state.db, args.query, limit)
          if (!results.length) return "No matches found."
          const projectRoot = dbGetMeta(db, "projectRoot") || ""
          const isCompact = args.compact ?? limit > 5
          return results.map((r) => {
            const rel = relative(projectRoot, r.file)
            return isCompact
              ? `${r.type} ${r.name} @ ${rel}:${r.line}`
              : `${r.type} ${r.name} @ ${rel}:${r.line}\n  ${r.content}`
          }).join("\n\n")
        },
      }),
      context_stats: tool({
        description: "Show index stats: project root, timestamp, chunk counts by language, context fill %.",
        args: {},
        async execute(args, c) {
          if (!state.db) return "Plugin still initializing. Try again in a second."
          const count = dbChunkCount(state.db)
          if (!count) return "No index. Run context_analyze first."
          const byLang = dbStatsByLang(state.db)
          const sid = (c as any)?.sessionID
          const fill = getFillRatio(sid)
          const lines = [
            `Project: ${dbGetMeta(state.db, "projectRoot")}`,
            `Indexed: ${dbGetMeta(state.db, "indexedAt")}`,
            `Total:   ${count} chunks`,
          ]
          for (const { ext, n } of byLang)
            lines.push(`  ${ext}: ${n}`)
          lines.push(`Files:   ${dbFileCount(state.db)}`)
          lines.push(`Context fill: ${(fill * 100).toFixed(0)}%`)
          return lines.join("\n")
        },
      }),
      context_clear: tool({
        description: "Delete the local code index.",
        args: {},
        async execute() {
          if (!state.db) return "Plugin still initializing. Try again in a second."
          dbClear(state.db)
          return "Index cleared."
        },
      }),
    },
    async event({ event }) {
      if (!state.db) return
      if (event.type === "message.updated" && event.properties?.tokens) {
        const t = event.properties.tokens as { input?: number; output?: number }
        recordTokens(event.properties.sessionID, t.input || 0, t.output || 0)
      }
      if (event.type === "file.edited" && event.properties?.file) {
        debouncedUpdateFile(state.db, event.properties.file, 500, log)
      }
      if (event.type === "file.watcher.updated" && event.properties?.file) {
        const fp = event.properties.file
        const ev = event.properties.event
        if (ev === "unlink") {
          dbDeleteFile(state.db, fp)
          log("debug", "removed file from index", { file: fp })
        } else if (ev === "add" || ev === "change") {
          debouncedUpdateFile(state.db, fp, 500, log)
        }
      }
    },
    async "experimental.chat.system.transform"(_input, output) {
      if (!state.db) {
        output.system.push([
          "<context-manager>",
          "Status: plugin still initializing.",
          "Tell the user the context-manager plugin is loading and will be ready in a moment.",
          "</context-manager>",
        ].join("\n"))
        return
      }
      const prompt = buildSystemPrompt(state.db, state.ready)
      if (prompt) output.system.push(prompt)
    },
    async "experimental.chat.messages.transform"(_input, output) {
      const msgs = (output as { messages: { info: { role?: string; sessionID?: string }; parts: any[] }[] }).messages
      if (!Array.isArray(msgs) || msgs.length === 0) return
      const sid = msgs[0]?.info?.sessionID
      const fill = getFillRatio(sid)
      const n = compactMessages(msgs as any, fill)
      if (n > 0) log("info", "compacted old tool outputs", { count: n, fillRatio: fill })
    },
    async "tool.execute.after"(input, output) {
      const t = (input as { tool?: string })?.tool || ""
      if (!["read", "bash", "grep", "glob"].includes(t)) return
      const cur = (output as { output?: string }).output
      if (typeof cur === "string" && cur.length > 0) {
        const compressed = compressToolOutput(t, cur)
        if (compressed !== cur) (output as { output: string }).output = compressed
      }
    },
  }
}

export default _plugin