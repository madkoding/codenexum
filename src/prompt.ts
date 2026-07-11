import type { Database } from "bun:sqlite"
import { dbChunkCount, dbFileCount, dbGetMeta, dbStatsByLang, dbTopFiles, dbFindImpacted, dbEdgeCount } from "./store"

export function buildSystemPrompt(db: Database, ready = true): string {
  if (!ready) {
    return [
      `<context-manager>`,
      `Status: indexing the project in the background. The user sees a "Indexing…" toast.`,
      `Tell the user you are still indexing. Suggest they wait a few seconds before asking code questions.`,
      `</context-manager>`,
    ].join("\n")
  }

  const count = dbChunkCount(db)
  if (!count) return ""
  const fileCount = dbFileCount(db)
  const indexedAt = dbGetMeta(db, "indexedAt") || "unknown"
  const langs = dbStatsByLang(db)
    .slice(0, 5)
    .map(({ ext, n }) => `${ext}:${n}`)
    .join(" ")
  const topFiles = dbTopFiles(db, 5)
    .map(({ file, n }) => `- ${file} (${n})`)
    .join("\n")

  // Find the most "loaded" files (many dependents) to warn the agent about.
  const loadedFiles = dbFindLoadedFiles(db, 5)
    .map(({ file, n }) => `- ${file} (${n} dependents)`)
    .join("\n")

  return [
    `<context-manager>`,
    `Index: ${count} chunks / ${fileCount} files @ ${indexedAt}.`,
    `Languages: ${langs}`,
    `Edges: ${dbEdgeCount(db)}`,
    ``,
    `Project map (top files by symbol count):`,
    topFiles,
    ``,
    `Hot files (most dependents — be careful editing):`,
    loadedFiles || "- none",
    ``,
    `Tools:`,
    `- context_search <query> [n] [snippet=N] — find symbols; results include file range + body snippet.`,
    `- context_search class:Name / function:name / file:path / lang:ext — filter by type, file, or language.`,
    `- context_related <file.ts:symbol> — callers, callees, imports, extends, implements.`,
    `- context_impact <file1> [<file2> ...] — files/symbols that depend on the given files.`,
    `- context_analyze [path] — re-index project or subdirectory.`,
    `- context_stats — show index statistics.`,
    ``,
    `Workflow:`,
    `1. ALWAYS use context_search before reading files.`,
    `2. If the snippet is enough, answer directly without opening the file.`,
    `3. Before changing a hot file, run context_impact to see what could break.`,
    `4. For tracing a symbol, use context_related.`,
    `</context-manager>`,
  ].join("\n")
}

// Files that are imported/extended/called by the most other files.
function dbFindLoadedFiles(db: Database, limit = 5): { file: string; n: number }[] {
  const rows = queryAll(
    db,
    "SELECT target_file, count(DISTINCT source_file) as n FROM edges GROUP BY target_file ORDER BY n DESC LIMIT ?",
    limit,
  ) as { target_file: string; n: number }[]
  return rows.map(({ target_file, n }) => ({ file: target_file, n }))
}

// Bun's sqlite types are strict about parameter binding. We cast the db handle
// for run/query calls because the runtime API accepts positional arguments,
// while the generated types only accept template-literal style bindings.
/* eslint-disable @typescript-eslint/no-explicit-any */
function queryAll(db: Database, sql: string, ...args: any[]): any[] {
  return (db as any).query(sql).all(...args)
}
