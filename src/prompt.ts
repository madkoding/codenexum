import type { Database } from "bun:sqlite"
import { dbChunkCount, dbFileCount, dbGetMeta, dbStatsByLang, dbTopFiles } from "./store"

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

  return [
    `<context-manager>`,
    `Index: ${count} chunks / ${fileCount} files @ ${indexedAt}.`,
    `Languages: ${langs}`,
    `Top files by symbol count:`,
    topFiles,
    ``,
    `Tools:`,
    `- context_search <query> [n] [snippet=N] — find symbols; results include file range + body snippet.`,
    `- context_search class:Name / function:name / file:path / lang:ext — filter by type, file, or language.`,
    `- context_analyze [path] — re-index project or subdirectory.`,
    `- context_stats — show index statistics.`,
    ``,
    `Use context_search before reading files. When the snippet is enough to answer, do not open the file.`,
    `</context-manager>`,
  ].join("\n")
}
