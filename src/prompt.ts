import type { Database } from "bun:sqlite"
import { dbChunkCount, dbFileCount, dbGetMeta, dbStatsByLang, dbTopFiles, dbFindLoadedFiles, dbEdgeCount } from "./store"
import { getGenerativeCompressionOptions, buildGenerativeCompressionInstruction } from "./generative-compress"

export function isVerbosePrompt(): boolean {
  return process.env.CONTEXT_MANAGER_VERBOSE_PROMPT === "1"
}

export function buildSystemPrompt(db: Database, ready = true, hasEditedFiles = false): string {
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
  const verbose = isVerbosePrompt()
  const topLimit = verbose ? 5 : 3
  const hotLimit = verbose ? 5 : 3

  const langs = dbStatsByLang(db)
    .slice(0, 5)
    .map(({ ext, n }) => `${ext}:${n}`)
    .join(" ")
  const topFiles = dbTopFiles(db, topLimit)
    .map(({ file, n }) => `- ${file} (${n})`)
    .join("\n")

  const lines = [
    `<context-manager>`,
    `Index: ${count} chunks / ${fileCount} files @ ${indexedAt}.`,
    `Languages: ${langs}`,
    `Edges: ${dbEdgeCount(db)}`,
    ``,
    `Project map (top files by symbol count):`,
    topFiles,
  ]

  // Only warn about hot files if the user has actually edited something this
  // session; otherwise this section is mostly noise.
  if (hasEditedFiles || verbose) {
    const loadedFiles = dbFindLoadedFiles(db, hotLimit)
      .map(({ file, n }) => `- ${file} (${n} dependents)`)
      .join("\n")
    lines.push(
      "",
      `Hot files (most dependents — be careful editing):`,
      loadedFiles || "- none",
    )
  }

  lines.push(
    "",
    `CRITICAL — context_search REPLACES grep, rg, find, git grep, read, and glob for code search:`,
    `- Do NOT call those tools for code search. Use context_search instead. Every native search bypasses the index and wastes ~50 extra tokens.`,
    `- context_search is faster, uses fewer tokens, and returns file ranges + body snippets.`,
    `- If the snippet is enough, answer directly without reading the full file.`,
    "",
    `Tools:`,
    `- context_search <query> [n] [snippet=N] — find symbols; results include file range + body snippet.`,
    `- context_search class:Name / function:name / file:path / lang:ext — filter by type, file, or language.`,
    `- context_related <file.ts:symbol> — callers, callees, imports, extends, implements.`,
    `- context_impact <file1> [<file2> ...] — files/symbols that depend on the given files.`,
    `- context_analyze [path] — re-index project or subdirectory.`,
    `- context_stats — show index statistics.`,
    `- context_dashboard — open the local web dashboard (http://127.0.0.1:3567).`,
    `- context_compression — show real-time compression status, session savings, and run a self-test.`,
    "",
    `Workflow:`,
    `1. If the snippet is enough, answer directly without opening the file.`,
    `2. Before changing a hot file, run context_impact to see what could break.`,
    `3. For tracing a symbol, use context_related.`,
    `4. For a live overview, run context_dashboard.`,
    "",
  )

  const genOpts = getGenerativeCompressionOptions()
  if (genOpts.enabled) {
    lines.push(buildGenerativeCompressionInstruction(genOpts.threshold))
    lines.push("")
  }

  lines.push(
    `When spawning a subagent via task(), include in its description: "Use context_search (not grep/rg/find/read/glob) for code search. The project has a pre-built code index with ~${count} chunks across ${fileCount} files."`,
  )

  lines.push(`</context-manager>`)

  return lines.join("\n")
}
