/**
 * Token-savings benchmark using the plugin's own tokenizer.
 * Prefers gpt-tokenizer (cl100k_base) when installed; otherwise falls back
 * silently to the ~4 chars/token heuristic.  No external Python process.
 *
 * Run: bun test/benchmark.ts
 */
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { initSchema, dbInsertChunks, dbSearch, dbClear } from "../src/store"
import { indexProject } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"
import { compressToolOutput } from "../src/compress"
import { compactMessages } from "../src/compact"
import { estimateTokens, getTokenizerMode } from "../src/tokens"
import type { Chunk } from "../src/types"

function tokens(s: string): number {
  return estimateTokens(s)
}

// ── synthetic project generator ─────────────────────────────────────────
function genProject(dir: string, nFiles: number): void {
  for (let i = 0; i < nFiles; i++) {
    const fns = Array.from({ length: 5 }, (_, j) =>
      `export function fn${i}_${j}(a: number, b: string, c: boolean): { id: string; data: number[] } {\n  return { id: \`\${a}-\${b}\`, data: [a, a+1, a+2] }\n}`
    ).join("\n\n")
    const classes = Array.from({ length: 2 }, (_, j) =>
      `export class Service${i}_${j} extends Base implements IRepo {\n  constructor(private db: Database) {}\n  async get(id: string): Promise<Result> { return null as any }\n  private validate(x: unknown): x is Foo { return true }\n}`
    ).join("\n\n")
    const imports = `import { Database } from "bun:sqlite"\nimport type { IRepo, Result, Foo } from "./types"\nimport { Base } from "./base"\n`
    writeFileSync(join(dir, `mod${i}.ts`), `${imports}\n${fns}\n${classes}\n`)
  }
  writeFileSync(join(dir, "types.ts"),
    `export interface IRepo { get(id: string): unknown }\nexport type Result = { id: string }\nexport type Foo = { x: number }\nexport class Base {}\n`)
}

function pct(before: number, after: number): string {
  if (before === 0) return "0%"
  return (((before - after) / before) * 100).toFixed(1) + "%"
}

// ── benchmark suites ────────────────────────────────────────────────────
async function benchSearch(db: Database) {
  dbClear(db)
  const tmp = mkdtempSync(join(tmpdir(), "bm-search-"))
  genProject(tmp, 20)
  const { chunks } = indexProject(tmp)
  dbInsertChunks(db, chunks)
  const queries = ["fn", "Service", "get", "validate", "Database", "IRepo", "Base", "import"]
  let before = 0, after = 0
  for (const q of queries) {
    const results = dbSearch(db, q, 10)
    const full = results.map(r => `${r.type} ${r.name} @ ${r.file}:${r.line}\n  ${r.content}`).join("\n\n")
    const compact = results.map(r => `${r.type} ${r.name} @ ${r.file}:${r.line}`).join("\n\n")
    before += tokens(full)
    after += tokens(compact)
  }
  rmSync(tmp, { recursive: true })
  return { before: Math.round(before / queries.length), after: Math.round(after / queries.length) }
}

async function benchTruncate(db: Database) {
  dbClear(db)
  const longContents = Array.from({ length: 100 }, (_, i) => {
    const names = Array.from({ length: 20 }, (_, j) => `Name${i}_${j}`).join(", ")
    return `import { ${names} } from "some/deep/path/module${i}"`
  })
  let rawTotal = 0, truncatedTotal = 0
  for (const content of longContents) {
    rawTotal += tokens(content)
    truncatedTotal += tokens(content.length <= 200 ? content : content.slice(0, 200) + "…")
  }
  // dedup effect
  const dupRaw = tokens(Array.from({ length: 20 }, () => "FROM orders").join("\n"))
  const dupDedup = tokens("FROM orders")
  return { before: rawTotal + dupRaw, after: truncatedTotal + dupDedup }
}

async function benchCompress() {
  const readOut = Array.from({ length: 800 }, (_, i) => `${i}: line of code ${i} with some content here`).join("\n")
  const bashOut = Array.from({ length: 500 }, (_, i) => `result line ${i}`).join("\n")
  const grepOut = Array.from({ length: 300 }, (_, i) => `src/file${i}.ts:42:match found here`).join("\n")
  const globOut = Array.from({ length: 400 }, (_, i) => `src/mod${i}/file.ts`).join("\n")
  const outs = [{ t: "read", o: readOut }, { t: "bash", o: bashOut }, { t: "grep", o: grepOut }, { t: "glob", o: globOut }]
  let before = 0, after = 0
  for (const { t, o } of outs) {
    before += tokens(o)
    after += tokens(compressToolOutput(t, o))
  }
  return { before, after }
}

async function benchCompact() {
  const mkMsg = (tool: string, output: string, input?: Record<string, unknown>) => ({
    info: { role: "assistant" },
    parts: [{ type: "tool", tool, state: { status: "completed", output, input, time: { start: 0, end: 1 } } }],
  })
  const longOut = (n: number) => Array.from({ length: n }, (_, i) => `line ${i} content`).join("\n")
  const msgs = [
    mkMsg("read", longOut(400), { path: "src/a.ts" }),
    mkMsg("bash", longOut(300), { command: "npm test" }),
    mkMsg("read", longOut(500), { path: "src/b.ts" }),
    mkMsg("grep", longOut(250), { pattern: "TODO" }),
    mkMsg("read", longOut(200), { path: "src/c.ts" }),
    mkMsg("bash", longOut(100), { command: "ls" }),
  ]
  let before = 0
  for (const m of msgs) before += tokens(m.parts[0].state!.output!)
  const msgsCopy = JSON.parse(JSON.stringify(msgs))
  compactMessages(msgsCopy as any, 0.85)
  let after = 0
  for (const m of msgsCopy as any[]) after += tokens(m.parts[0].state.output)
  return { before, after }
}

async function benchPrompt(db: Database) {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f:fn:a", file: "test.ts", name: "foo", type: "function", line: 1, lineEnd: 1, content: "function foo()", body: "function foo() {}", lang: "typescript" },
  ])
  const after = buildSystemPrompt(db)
  const before = [
    `<context-manager>`,
    `Code index available: 1 chunks across 1 files.`,
    `Indexed: 2026-01-01`,
    ``,
    `IMPORTANT: Use the context_search tool to find code locations BEFORE reading files.`,
    `This saves tokens — search returns function/class names with line numbers,`,
    `so you can read only the specific file and section you need.`,
    `</context-manager>`,
  ].join("\n")
  return { before: tokens(before), after: tokens(after) }
}

async function benchToolDescs() {
  const before = [
    "Index a project: walk code files, extract functions/classes/interfaces/types/enums, store in a searchable index. Runs automatically on first load. Use this to re-index or index a specific path.",
    "Search indexed code by keyword or phrase. Use context_analyze first to build the index. Prefer this over reading files blindly to save tokens.",
    "Show indexing statistics from the last context_analyze run.",
    "Delete the local code index.",
  ].join(" ")
  const after = [
    "Re-index the project. Walks code files, extracts symbols, stores in SQLite. Runs automatically on first load.",
    "Search indexed code by keyword. Prefer this over reading files blindly. Returns type name @ file:line ranked by BM25.",
    "Show index stats: project root, timestamp, chunk counts by language, context fill %.",
    "Delete the local code index.",
  ].join(" ")
  return { before: tokens(before), after: tokens(after) }
}

// ── runner ──────────────────────────────────────────────────────────────
async function main() {
  const db = new Database(":memory:")
  initSchema(db)

  const mode = getTokenizerMode()
  console.log("\n╔══════════════════════════════════════════════════════════════════╗")
  console.log("║  Context Manager — Token Savings Benchmark                       ║")
  console.log(`║  Tokenizer: ${(mode === "tiktoken" ? "gpt-tokenizer cl100k_base (real)" : "heuristic 4 chars/token").padEnd(58)} ║`)
  console.log("╚══════════════════════════════════════════════════════════════════╝\n")

  const suites = [
    { name: "P4: context_search (compact vs full)", run: () => benchSearch(db) },
    { name: "P5: truncate content + dedup", run: () => benchTruncate(db) },
    { name: "P1: tool.execute.after compression", run: benchCompress },
    { name: "P2: compactMessages history", run: benchCompact },
    { name: "P7: system prompt (old vs new)", run: () => benchPrompt(db) },
    { name: "P6: tool descriptions (old vs new)", run: benchToolDescs },
  ]

  let totalBefore = 0, totalAfter = 0
  console.log("┌──────────────────────────────────────────────────┬────────┬───────┬───────┬────────┐")
  console.log("│ Suite                                            │  saved │ before│ after │   %    │")
  console.log("├──────────────────────────────────────────────────┼────────┼───────┼───────┼────────┤")
  for (const s of suites) {
    const { before, after } = await s.run()
    const saved = before - after
    totalBefore += before
    totalAfter += after
    const name = s.name.padEnd(48).slice(0, 48)
    console.log(`│ ${name} │ ${String(saved).padStart(6)} │ ${String(before).padStart(5)} │ ${String(after).padStart(5)} │ ${pct(before, after).padStart(6)} │`)
  }
  console.log("├──────────────────────────────────────────────────┼────────┼───────┼───────┼────────┤")
  console.log(`│ ${"TOTAL".padEnd(48)} │ ${String(totalBefore - totalAfter).padStart(6)} │ ${String(totalBefore).padStart(5)} │ ${String(totalAfter).padStart(5)} │ ${pct(totalBefore, totalAfter).padStart(6)} │`)
  console.log("└──────────────────────────────────────────────────┴────────┴───────┴───────┴────────┘")

  const ptBefore = (await benchToolDescs()).before + (await benchPrompt(db)).before
  const ptAfter = (await benchToolDescs()).after + (await benchPrompt(db)).after
  console.log(`\nConstant per-turn savings (P6+P7): ${ptBefore - ptAfter} tokens/turn`)
  console.log(`Over 20 turns: ${(ptBefore - ptAfter) * 20} tokens saved\n`)

  db.close()
}

main()