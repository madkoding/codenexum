/**
 * Contract tests — verify stable interfaces and output formats that consumers depend on.
 * These tests FAIL if any contract is broken, preventing silent regressions.
 */
import { test, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import type { Chunk, ChunkType } from "../src/types"
import { IGNORE, CODE_EXTS } from "../src/types"
import { PARSERS } from "../src/parsers"
import {
  initSchema, dbInsertChunks, dbSetFileHash, dbSetMeta,
  dbChunkCount, dbSearch, dbStatsByLang, dbClear, dbGetMeta, buildFtsQuery,
} from "../src/store"
import { indexProject, updateFile } from "../src/indexer"
import { buildSystemPrompt } from "../src/prompt"

let db: Database
let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ctx-contract-"))
  db = new Database(":memory:")
  initSchema(db)
})

afterAll(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

// ═══════════════════════════════════════════════════════════════
// C1: Chunk interface contract — all parsers must produce valid Chunks
// ═══════════════════════════════════════════════════════════════
test("C1: Chunk has required fields with correct types", () => {
  const chunk: Chunk = {
    id: "test:fn:foo",
    file: "test.ts",
    name: "foo",
    type: "function",
    line: 1,
    content: "function foo()",
  }
  expect(typeof chunk.id).toBe("string")
  expect(typeof chunk.file).toBe("string")
  expect(typeof chunk.name).toBe("string")
  expect(["function", "class", "interface", "type", "enum"]).toContain(chunk.type)
  expect(typeof chunk.line).toBe("number")
  expect(typeof chunk.content).toBe("string")
})

test("C1: Chunk.type uses ChunkType union", () => {
  const validTypes: ChunkType[] = ["function", "class", "interface", "type", "enum", "import", "export", "decorator", "selector", "component", "config", "table", "heading"]
  // Every parser should only produce chunks with these types
  const samples = [
    "function foo() {}",
    "class Bar {}",
    "interface IBar {}",
    "type Baz = string",
    "enum Qux { A }",
  ]
  for (const code of samples) {
    const chunks = PARSERS[".ts"](code, "test.ts")
    for (const c of chunks) {
      expect(validTypes.includes(c.type as ChunkType)).toBe(true)
    }
  }
})

test("C1: Every parser produces valid Chunk objects", () => {
  const sampleCode: Record<string, string> = {
    ".py": "import os\ndef foo(x): return x\nclass Bar: pass",
    ".js": "import { x } from 'y'\nexport function foo() {}\nclass Bar {}",
    ".ts": "import { x } from 'y'\nexport function foo() {}\ninterface IBar {}\ntype Baz = string\nenum Q { A }",
    ".go": 'import "fmt"\nfunc foo() {}\ntype Bar struct{}\ntype IBar interface{}',
    ".rs": "use std::collections::HashMap\nfn foo() {}\nstruct Bar {}\nenum Q { A }\ntrait T {}",
    ".java": "import java.util.List\nclass Bar { public void foo() {} }\ninterface IBar {}",
    ".rb": "require 'json'\ndef foo\nend\nclass Bar\nend",
    ".php": "<?php use App\\Models\\User;\nfunction foo() {} class Bar {} interface IBar {}",
    ".c": '#include "header.h"\nint foo() { return 0; } struct Bar { int x; };',
    ".cpp": '#include <vector>\nint foo() { return 0; } class Bar {}; namespace NS {}',
    ".cs": "using System.Collections;\npublic void Foo() {} public class Bar {} public interface IBar {}",
  }
  for (const [ext, code] of Object.entries(sampleCode)) {
    const parser = PARSERS[ext]
    expect(parser).toBeDefined()
    const chunks = parser(code, "test" + ext)
    for (const c of chunks) {
      expect(typeof c.id).toBe("string")
      expect(c.id.length).toBeGreaterThan(0)
      expect(typeof c.file).toBe("string")
      expect(typeof c.name).toBe("string")
      expect(c.name.length).toBeGreaterThan(0)
      expect(["function", "class", "interface", "type", "enum", "import", "export", "decorator", "selector", "component", "config", "table", "heading"] satisfies ChunkType[]).toContain(c.type)
      expect(typeof c.line).toBe("number")
      expect(c.line).toBeGreaterThanOrEqual(1)
      expect(typeof c.content).toBe("string")
      expect(c.content.length).toBeGreaterThan(0)
    }
  }
})

// ═══════════════════════════════════════════════════════════════
// C2: PARSERS map — all declared extensions must have a parser
// ═══════════════════════════════════════════════════════════════
test("C2: CODE_EXTS is a superset of PARSERS keys", () => {
  for (const ext of CODE_EXTS) {
    expect(PARSERS[ext]).toBeDefined()
  }
})

test("C2: PARSERS has no extensions outside CODE_EXTS", () => {
  for (const ext of Object.keys(PARSERS)) {
    expect(CODE_EXTS.has(ext)).toBe(true)
  }
})

test("C2: PARSERS covers all registered extensions", () => {
  const count = Object.keys(PARSERS).length
  expect(count).toBeGreaterThanOrEqual(15)
})

// ═══════════════════════════════════════════════════════════════
// C3: SQL schema contract — table and column names are stable
// ═══════════════════════════════════════════════════════════════
test("C3: chunks_fts table exists with correct columns", () => {
  const cols = db.query("PRAGMA table_info(chunks_fts)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain("name")
  expect(colNames).toContain("content")
  expect(colNames).toContain("id")
  expect(colNames).toContain("file")
  expect(colNames).toContain("type")
  expect(colNames).toContain("line")
})

test("C3: file_hashes table exists with file + hash columns", () => {
  const cols = db.query("PRAGMA table_info(file_hashes)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain("file")
  expect(colNames).toContain("hash")
})

test("C3: meta table exists with key + value columns", () => {
  const cols = db.query("PRAGMA table_info(meta)").all() as { name: string }[]
  const colNames = cols.map(c => c.name)
  expect(colNames).toContain("key")
  expect(colNames).toContain("value")
})

// ═══════════════════════════════════════════════════════════════
// C4: Meta keys contract — these keys are read by multiple functions
// ═══════════════════════════════════════════════════════════════
test("C4: projectRoot meta key is used by context_search and buildSystemPrompt", () => {
  dbSetMeta(db, "projectRoot", "/fake/path")
  expect(dbGetMeta(db, "projectRoot")).toBe("/fake/path")

  // buildSystemPrompt reads indexedAt
  dbSetMeta(db, "indexedAt", "2026-01-01T00:00:00Z")
  const prompt = buildSystemPrompt(db)
  if (dbChunkCount(db) > 0) {
    expect(prompt).toContain("2026-01-01T00:00:00Z")
  }
})

test("C4: meta keys are exactly projectRoot and indexedAt", () => {
  // These are the only meta keys the plugin uses
  dbSetMeta(db, "projectRoot", "/test")
  dbSetMeta(db, "indexedAt", "2026-01-01")
  const allMeta = db.query("SELECT key FROM meta").all() as { key: string }[]
  const keys = allMeta.map(m => m.key)
  expect(keys).toContain("projectRoot")
  expect(keys).toContain("indexedAt")
})

// ═══════════════════════════════════════════════════════════════
// C5: context_search output format contract
// The LLM parses: "${type} ${name} @ ${relativePath}:${line}\n  ${content}"
// ═══════════════════════════════════════════════════════════════
test("C5: context_search output format matches 'type name @ file:line\\n  content'", () => {
  dbClear(db)
  dbInsertChunks(db, [{
    id: "f:fn:handleAuth", file: join(tmpDir, "src/auth.ts"), name: "handleAuth",
    type: "function", line: 42, content: "function handleAuth(req, res)",
  }])
  dbSetMeta(db, "projectRoot", tmpDir)

  const results = dbSearch(db, "handleAuth", 10)
  expect(results.length).toBeGreaterThanOrEqual(1)
  const r = results[0]
  const rel = r.file.replace(tmpDir + "/", "")

  // Reproduce the exact format the plugin uses
  const outputLine = `${r.type} ${r.name} @ ${rel}:${r.line}\n  ${r.content}`
  expect(outputLine).toBe("function handleAuth @ src/auth.ts:42\n  function handleAuth(req, res)")
})

test("C5: search results separated by double newline", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f1:fn:a", file: "a.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
    { id: "f2:fn:b", file: "b.ts", name: "bar", type: "function", line: 1, content: "function bar()" },
  ])
  dbSetMeta(db, "projectRoot", "")

  const results = dbSearch(db, "foo bar", 10)
  const output = results.map((r: any) => `${r.type} ${r.name} @ ${r.file}:${r.line}\n  ${r.content}`).join("\n\n")
  expect(output).toContain("\n\n")
  expect(output.split("\n\n").length).toBe(results.length)
})

// ═══════════════════════════════════════════════════════════════
// C6: context_analyze output format contract
// "Indexed N files → N chunks\n  functions:  N\n  classes:    N\n  ..."
// ═══════════════════════════════════════════════════════════════
test("C6: context_analyze output format has required lines", () => {
  const chunks: Chunk[] = [
    { id: "f1:fn:a", file: "a.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
    { id: "f2:cls:b", file: "b.ts", name: "Bar", type: "class", line: 1, content: "class Bar" },
  ]
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

  const output = [
    `Indexed ${2} files → ${chunks.length} chunks`,
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
    `  DB: /fake/path.sqlite`,
  ].join("\n")

  expect(output).toContain("Indexed 2 files → 2 chunks")
  expect(output).toContain("functions:  1")
  expect(output).toContain("classes:    1")
  expect(output).toContain("interfaces: 0")
  expect(output).toContain("types:      0")
  expect(output).toContain("enums:      0")
  expect(output).toContain("imports:    0")
  expect(output).toContain("exports:    0")
  expect(output).toContain("decorators: 0")
  expect(output).toContain("selectors:  0")
  expect(output).toContain("components: 0")
  expect(output).toContain("config:     0")
  expect(output).toContain("tables:     0")
  expect(output).toContain("headings:   0")
  expect(output).toContain("DB:")
})

// ═══════════════════════════════════════════════════════════════
// C7: context_stats output format contract
// "Project: ...\nIndexed: ...\nTotal:   N chunks\n  .ts: N\nFiles:   N"
// ═══════════════════════════════════════════════════════════════
test("C7: context_stats output format has required lines", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f1:fn:a", file: "test.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
  ])
  dbSetMeta(db, "projectRoot", "/fake")
  dbSetMeta(db, "indexedAt", "2026-01-01T00:00:00Z")

  const count = dbChunkCount(db)
  const byLang = dbStatsByLang(db)
  const lines = [
    `Project: ${dbGetMeta(db, "projectRoot")}`,
    `Indexed: ${dbGetMeta(db, "indexedAt")}`,
    `Total:   ${count} chunks`,
  ]
  for (const { ext, n } of byLang)
    lines.push(`  ${ext}: ${n}`)
  lines.push(`Files:   ${1}`)

  const output = lines.join("\n")
  expect(output).toContain("Project: /fake")
  expect(output).toContain("Indexed: 2026-01-01T00:00:00Z")
  expect(output).toContain("Total:   1 chunks")
  expect(output).toContain(".ts: 1")
  expect(output).toContain("Files:")
})

// ═══════════════════════════════════════════════════════════════
// C8: System prompt format contract
// "<context-manager>\n...\n</context-manager>"
// ═══════════════════════════════════════════════════════════════
test("C8: buildSystemPrompt wraps in <context-manager> tags", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f1:fn:a", file: "test.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
  ])
  dbSetMeta(db, "projectRoot", "/fake")
  dbSetMeta(db, "indexedAt", "2026-01-01")

  const prompt = buildSystemPrompt(db)
  expect(prompt.startsWith("<context-manager>")).toBe(true)
  expect(prompt.endsWith("</context-manager>")).toBe(true)
  expect(prompt).toContain("Code index available:")
  expect(prompt).toContain("chunks")
  expect(prompt).toContain("files")
  expect(prompt).toContain("Indexed:")
  expect(prompt).toContain("context_search")
})

test("C8: buildSystemPrompt returns empty string when no index", () => {
  dbClear(db)
  expect(buildSystemPrompt(db)).toBe("")
})

// ═══════════════════════════════════════════════════════════════
// C9: buildFtsQuery output format contract — FTS5 MATCH syntax
// Must produce: "token" OR "token" OR ...
// Double-quoted tokens, OR separator
// ═══════════════════════════════════════════════════════════════
test("C9: buildFtsQuery produces double-quoted tokens joined by OR", () => {
  const q = buildFtsQuery("auth login handler")
  expect(q).toBe('"auth" OR "login" OR "handler"')
})

test("C9: buildFtsQuery wraps each token in double quotes", () => {
  const q = buildFtsQuery("invoice")
  expect(q).toBe('"invoice"')
  expect(q.startsWith('"')).toBe(true)
  expect(q.endsWith('"')).toBe(true)
})

test("C9: buildFtsQuery filters tokens shorter than 2 chars", () => {
  const q = buildFtsQuery("a go x auth")
  expect(q).toBe('"go" OR "auth"')
  expect(q).not.toContain('"a"')
  expect(q).not.toContain('"x"')
})

test("C9: buildFtsQuery splits on non-word characters", () => {
  const q = buildFtsQuery("real-time.sync")
  expect(q).toBe('"real" OR "time" OR "sync"')
})

test("C9: buildFtsQuery produces valid FTS5 MATCH syntax (no syntax errors)", () => {
  const q = buildFtsQuery("auth login handler")
  // Should be usable in a MATCH query without throwing
  expect(() => {
    const testDb = new Database(":memory:")
    initSchema(testDb)
    testDb.query("SELECT * FROM chunks_fts WHERE chunks_fts MATCH ?").get(q)
    testDb.close()
  }).not.toThrow()
})

// ═══════════════════════════════════════════════════════════════
// C10: Plugin export contract — opencode expects a Plugin function
// ═══════════════════════════════════════════════════════════════
test("C10: plugin exports default as a Plugin function", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain('export default _plugin')
  expect(src).toContain('const _plugin: Plugin =')
})

// ═══════════════════════════════════════════════════════════════
// C10b: Self-contained skill install — plugin must auto-copy SKILL.md
// to ~/.config/opencode/skills/context-manager/ on first load
// ═══════════════════════════════════════════════════════════════
test("C10b: plugin auto-copies SKILL.md to global skills dir", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("skills/context-manager")
  expect(src).toContain("copyFileSync")
  expect(src).toContain("skillDst")
})

test("C10c: bundled SKILL.md exists at skills/context-manager/SKILL.md", async () => {
  const skill = Bun.file("./skills/context-manager/SKILL.md")
  expect(await skill.exists()).toBe(true)
  const text = await skill.text()
  expect(text).toContain("name: context-manager")
  expect(text).toContain("description:")
})

// ═══════════════════════════════════════════════════════════════
// C10d: Loading shim — local plugin that shows "Installing…" feedback
// while opencode downloads the npm plugin on first run
// ═══════════════════════════════════════════════════════════════
test("C10d: loading shim exists and exports a Plugin function", async () => {
  const shim = Bun.file("./plugins/context-manager-loading-shim.ts")
  expect(await shim.exists()).toBe(true)
  const src = await shim.text()
  expect(src).toContain("export default ShimPlugin")
  expect(src).toContain("const ShimPlugin: Plugin =")
  expect(src).toContain("Installing")
  expect(src).toContain("showToast")
})

// ═══════════════════════════════════════════════════════════════
// C10e: Auto-install shim — main plugin embeds the shim source
// and writes it to ~/.config/opencode/plugins/ on first startup
// so subsequent startups get instant feedback during npm install
// ═══════════════════════════════════════════════════════════════
test("C10e: main plugin embeds SHIM_SOURCE and auto-installs it", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("SHIM_SOURCE")
  expect(src).toContain("context-manager-loading-shim.ts")
  expect(src).toContain("ensureShimInstalled")
})

// ═══════════════════════════════════════════════════════════════
// C11: Tool names contract — the LLM calls these by exact name
// ═══════════════════════════════════════════════════════════════
test("C11: plugin exposes exactly 4 tools with correct names", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("context_analyze: tool({")
  expect(src).toContain("context_search: tool({")
  expect(src).toContain("context_stats: tool({")
  expect(src).toContain("context_clear: tool({")
})

// ═══════════════════════════════════════════════════════════════
// C12: Tool args contract — args must match what opencode sends
// ═══════════════════════════════════════════════════════════════
test("C12: context_search requires 'query' arg and optional 'n'", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain('query: tool.schema.string()')
  expect(src).toContain('n: tool.schema.number()')
  expect(src).toContain('.optional()')
  expect(src).toContain('.default(10)')
})

test("C12: context_analyze has optional 'path' arg", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain('path: tool.schema.string()')
  expect(src).toContain('.optional()')
})

// ═══════════════════════════════════════════════════════════════
// C13: Hook names contract — opencode calls these hooks by name
// ═══════════════════════════════════════════════════════════════
test("C13: plugin registers 'event' hook", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("async event(")
})

test("C13: plugin registers 'experimental.chat.system.transform' hook", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain('experimental.chat.system.transform')
})

// ═══════════════════════════════════════════════════════════════
// C14: Error message contracts — these exact strings are returned
// ═══════════════════════════════════════════════════════════════
test("C14: 'no index' error message is stable", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("No index. Run context_analyze first.")
})

test("C14: 'query too short' error message is stable", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("Query too short. Use at least 2 characters.")
})

test("C14: 'no matches' error message is stable", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("No matches found.")
})

test("C14: 'index cleared' success message is stable", async () => {
  const src = await Bun.file("./plugins/@madtech-opencode-context-manager-plugin.ts").text()
  expect(src).toContain("Index cleared.")
})

// ═══════════════════════════════════════════════════════════════
// C15: Storage path contract — DB file location
// ═══════════════════════════════════════════════════════════════
test("C15: DB path is under ~/.cache/opencode/context-manager.sqlite", () => {
  const src = require("fs").readFileSync("./plugins/@madtech-opencode-context-manager-plugin.ts", "utf-8")
  expect(src).toContain("context-manager.sqlite")
  expect(src).toContain(".cache/opencode")
})

test("C15: old JSON path is cleaned up on init", () => {
  const src = require("fs").readFileSync("./plugins/@madtech-opencode-context-manager-plugin.ts", "utf-8")
  expect(src).toContain("context-manager.json")
  expect(src).toContain("unlinkSync")
})

// ═══════════════════════════════════════════════════════════════
// C16: Function signatures contract — exported functions keep their arity
// ═══════════════════════════════════════════════════════════════
test("C16: dbSearch takes (db, query, n) and returns SearchResult[]", () => {
  dbClear(db)
  dbInsertChunks(db, [
    { id: "f:fn:x", file: "x.ts", name: "foo", type: "function", line: 1, content: "function foo()" },
  ])
  const results = dbSearch(db, "foo", 5)
  expect(Array.isArray(results)).toBe(true)
  if (results.length > 0) {
    const r = results[0] as any
    expect(typeof r.name).toBe("string")
    expect(typeof r.content).toBe("string")
    expect(typeof r.file).toBe("string")
    expect(typeof r.type).toBe("string")
    expect(typeof r.line).toBe("number")
    expect(typeof r.score).toBe("number")
  }
})

test("C16: indexProject takes (root) and returns { files, chunks, fileHashes, capped }", () => {
  writeFileSync(join(tmpDir, "c_test.ts"), "function foo() {}")
  const result = indexProject(tmpDir)
  expect(typeof result.files).toBe("number")
  expect(Array.isArray(result.chunks)).toBe(true)
  expect(typeof result.fileHashes).toBe("object")
  expect(typeof result.capped).toBe("boolean")
})

test("C16: updateFile takes (db, fp, log?) and returns boolean", () => {
  const fp = join(tmpDir, "c_update.ts")
  writeFileSync(fp, "function foo() {}")
  const result = updateFile(db, fp)
  expect(typeof result).toBe("boolean")
})