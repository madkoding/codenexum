import { tool, type Plugin } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { join, isAbsolute, relative, extname } from "path"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import {
  initSchema, dbInsertChunks, dbDeleteFile, dbSetFileHash, dbSetMeta,
  dbGetMeta, dbChunkCount, dbFileCount, dbSearch, dbClear, dbStatsByLang,
} from "../src/store"
import { indexProject, updateFile, debouncedUpdateFile, type LogFn } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"

const _plugin: Plugin = async ({ client, directory }) => {
  const log: LogFn = (level, message, extra) =>
    client?.app?.log({ body: { service: "context-manager", level, message, extra } }).catch(() => {})

  log("info", "plugin initialized", { directory })

  const HOME = process.env.HOME || "/tmp"
  const dbDir = join(HOME, ".cache/opencode")
  const dbPath = join(dbDir, "context-manager.sqlite")
  const oldJsonPath = join(dbDir, "context-manager.json")

  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
  if (existsSync(oldJsonPath)) { try { unlinkSync(oldJsonPath) } catch {} }

  const db = new Database(dbPath)
  initSchema(db)

  if (dbChunkCount(db) === 0) {
    log("info", "auto-analyzing project", { directory })
    const { files, chunks, fileHashes } = indexProject(directory)
    dbInsertChunks(db, chunks)
    for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
    dbSetMeta(db, "projectRoot", directory)
    dbSetMeta(db, "indexedAt", new Date().toISOString())
    log("info", "auto-analyzed project", { files, chunks: chunks.length })
  }

  return {
    tool: {
      context_analyze: tool({
        description: "Index a project: walk code files, extract functions/classes/interfaces/types/enums, store in a searchable index. Runs automatically on first load. Use this to re-index or index a specific path.",
        args: {
          path: tool.schema.string().optional().describe("Project path. Default: current session directory."),
        },
        async execute(args, c) {
          const root = args.path ? (isAbsolute(args.path) ? args.path : join(c.directory, args.path)) : c.directory
          const { files, chunks, fileHashes } = indexProject(root)
          dbClear(db)
          dbInsertChunks(db, chunks)
          for (const [fp, h] of Object.entries(fileHashes)) dbSetFileHash(db, fp, h)
          dbSetMeta(db, "projectRoot", root)
          dbSetMeta(db, "indexedAt", new Date().toISOString())
          log("info", "indexed project", { files, chunks: chunks.length, root })
          const fns = chunks.filter(x => x.type === "function").length
          const cls = chunks.filter(x => x.type === "class").length
          const ifs = chunks.filter(x => x.type === "interface").length
          const types = chunks.filter(x => x.type === "type").length
          const enums = chunks.filter(x => x.type === "enum").length
          return [
            `Indexed ${files} files → ${chunks.length} chunks`,
            `  functions:  ${fns}`,
            `  classes:    ${cls}`,
            `  interfaces: ${ifs}`,
            `  types:      ${types}`,
            `  enums:      ${enums}`,
            `  DB: ${dbPath}`,
          ].join("\n")
        },
      }),
      context_search: tool({
        description: "Search indexed code by keyword or phrase. Use context_analyze first to build the index. Prefer this over reading files blindly to save tokens.",
        args: {
          query: tool.schema.string().describe("Search query (e.g. 'auth handler', 'validate function')"),
          n: tool.schema.number().optional().default(10).describe("Max results (default 10)"),
        },
        async execute(args) {
          if (dbChunkCount(db) === 0) return "No index. Run context_analyze first."
          if (args.query.trim().length < 2) return "Query too short. Use at least 2 characters."
          const results = dbSearch(db, args.query, args.n || 10)
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
          const count = dbChunkCount(db)
          if (!count) return "No index. Run context_analyze first."
          const byLang = dbStatsByLang(db)
          const lines = [
            `Project: ${dbGetMeta(db, "projectRoot")}`,
            `Indexed: ${dbGetMeta(db, "indexedAt")}`,
            `Total:   ${count} chunks`,
          ]
          for (const { ext, n } of byLang)
            lines.push(`  ${ext}: ${n}`)
          lines.push(`Files:   ${dbFileCount(db)}`)
          return lines.join("\n")
        },
      }),
      context_clear: tool({
        description: "Delete the local code index.",
        args: {},
        async execute() {
          dbClear(db)
          return "Index cleared."
        },
      }),
    },
    async event({ event }) {
      if (event.type === "file.edited" && event.properties?.file) {
        debouncedUpdateFile(db, event.properties.file, 500, log)
      }
      if (event.type === "file.watcher.updated" && event.properties?.file) {
        const fp = event.properties.file
        const ev = event.properties.event
        if (ev === "unlink") {
          dbDeleteFile(db, fp)
          log("debug", "removed file from index", { file: fp })
        } else if (ev === "add" || ev === "change") {
          debouncedUpdateFile(db, fp, 500, log)
        }
      }
    },
    async "experimental.chat.system.transform"(_input, output) {
      const prompt = buildSystemPrompt(db)
      if (prompt) output.system.push(prompt)
    },
  }
}

export default { id: "@madkoding/context-manager", server: _plugin }