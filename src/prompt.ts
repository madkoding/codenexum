import type { Database } from "bun:sqlite"
import { dbChunkCount, dbFileCount, dbGetMeta } from "./store"

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
  return [
    `<context-manager>`,
    `Code index available: ${count} chunks across ${fileCount} files.`,
    `Indexed: ${indexedAt}`,
    ``,
    `IMPORTANT: Use the context_search tool to find code locations BEFORE reading files.`,
    `This saves tokens — search returns function/class names with line numbers,`,
    `so you can read only the specific file and section you need.`,
    `</context-manager>`,
  ].join("\n")
}