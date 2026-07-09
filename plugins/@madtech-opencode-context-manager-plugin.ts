import { tool, type Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { join, isAbsolute, relative, extname } from "path"
import { existsSync, mkdirSync, unlinkSync, copyFileSync } from "fs"
import {
  initSchema, dbInsertChunks, dbDeleteFile, dbSetFileHash, dbSetMeta,
  dbGetMeta, dbChunkCount, dbFileCount, dbSearch, dbClear, dbStatsByLang,
} from "../src/store"
import { indexProject, updateFile, debouncedUpdateFile, getMaxFiles, type LogFn } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"

const _plugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = (level, message, extra) =>
    client?.app?.log({ body: { service: "opencode-context-manager-plugin", level, message, extra } }).catch(() => {})

  const toast = (title: string, message: string, variant: "info" | "success" | "warning" | "error" = "info", duration = 10000) => {
    const fullMessage = `[${title}] ${message}`
    log("info", "toast", { title, message, variant, duration })
    const tryShow = async () => {
      const tui = (client as any)?.tui
      if (!tui) {
        log("warn", "client.tui not available")
        return
      }
      if (typeof tui.showToast === "function") {
        try {
          const r = await tui.showToast({ body: { title, message, variant, duration } })
          log("debug", "showToast result", { result: r })
        } catch (e) {
          log("warn", "showToast failed", { error: String(e) })
        }
      } else if (typeof tui.publish === "function") {
        try {
          const r = await tui.publish({ body: { type: "tui.toast.show", properties: { title, message, variant, duration } } })
          log("debug", "publish toast result", { result: r })
        } catch (e) {
          log("warn", "publish toast failed", { error: String(e) })
        }
      } else {
        log("warn", "no toast API available", { tuiKeys: Object.keys(tui) })
      }
      if (typeof tui.appendPrompt === "function") {
        try {
          await tui.appendPrompt({ body: { text: fullMessage } })
          log("debug", "appended to prompt")
        } catch (e) {
          log("warn", "appendPrompt failed", { error: String(e) })
        }
      }
    }
    tryShow()
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
    try {
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
  })

  return {
    tool: {
      context_analyze: tool({
        description: "Index a project: walk code files, extract functions/classes/interfaces/types/enums, store in a searchable index. Runs automatically on first load. Use this to re-index or index a specific path.",
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
        description: "Search indexed code by keyword or phrase. Use context_analyze first to build the index. Prefer this over reading files blindly to save tokens.",
        args: {
          query: tool.schema.string().describe("Search query (e.g. 'auth handler', 'validate function')"),
          n: tool.schema.number().optional().default(10).describe("Max results (default 10)"),
        },
        async execute(args) {
          if (!state.db) return "Plugin still initializing. Try again in a second."
          if (dbChunkCount(state.db) === 0) return "No index. Run context_analyze first."
          if (args.query.trim().length < 2) return "Query too short. Use at least 2 characters."
          const results = dbSearch(state.db, args.query, args.n || 10)
          if (!results.length) return "No matches found."
          const projectRoot = dbGetMeta(db, "projectRoot") || ""
          return results.map((r) => {
            const rel = relative(projectRoot, r.file)
            return `${r.type} ${r.name} @ ${rel}:${r.line}\n  ${r.content}`
          }).join("\n\n")
        },
      }),
      context_stats: tool({
        description: "Show indexing statistics from the last context_analyze run.",
        args: {},
        async execute() {
          if (!state.db) return "Plugin still initializing. Try again in a second."
          const count = dbChunkCount(state.db)
          if (!count) return "No index. Run context_analyze first."
          const byLang = dbStatsByLang(state.db)
          const lines = [
            `Project: ${dbGetMeta(state.db, "projectRoot")}`,
            `Indexed: ${dbGetMeta(state.db, "indexedAt")}`,
            `Total:   ${count} chunks`,
          ]
          for (const { ext, n } of byLang)
            lines.push(`  ${ext}: ${n}`)
          lines.push(`Files:   ${dbFileCount(state.db)}`)
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
  }
}

export default _plugin